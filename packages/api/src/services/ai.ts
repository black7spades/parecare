import { db } from '../config/database';
import { env } from '../config/env';
import { getAiConfig } from '../config/settings';
import { complete, isAiConfigured } from './aiProvider';
import type { Account, CareProfile, CareCircleMember } from '../types';

function ensureConfigured(): void {
  if (!isAiConfigured()) {
    // 503, not 402 — a missing provider is a server configuration issue,
    // and 402 makes the web app show the subscription upgrade prompt.
    throw Object.assign(
      new Error('AI assistant is not configured. Set the AI provider and its API key (or a local model) in the settings screen.'),
      { status: 503, code: 'AI_NOT_CONFIGURED' }
    );
  }
}

function getTokenLimit(account: Account): number {
  if (env.SELF_HOSTED) return -1;
  const cfg = getAiConfig();
  const tier = account.subscription_tier;
  if (tier === 'professional') return cfg.tokensProfessional;
  if (tier === 'family') return cfg.tokensFamily;
  return cfg.tokensFree;
}

export async function checkTokenBudget(account: Account): Promise<void> {
  if (env.SELF_HOSTED) return;

  const limit = getTokenLimit(account);
  if (limit === 0) {
    throw Object.assign(
      new Error('AI assistant is not available on the free plan. Upgrade to access it.'),
      { status: 402, code: 'SUBSCRIPTION_REQUIRED', feature: 'ai_access' }
    );
  }
  if (limit === -1) return;

  const now = new Date();
  if (new Date(account.ai_tokens_reset_at) < now) {
    await db('accounts').where({ id: account.id }).update({
      ai_tokens_used: 0,
      ai_tokens_reset_at: db.raw("NOW() + INTERVAL '1 month'"),
      updated_at: db.fn.now(),
    });
    account.ai_tokens_used = 0;
  }

  if (account.ai_tokens_used >= limit) {
    throw Object.assign(
      new Error('AI token limit reached for this billing period. It will reset next month.'),
      { status: 402, code: 'AI_TOKEN_LIMIT' }
    );
  }
}

export async function recordTokenUsage(
  accountId: string,
  conversationId: string | null,
  tokensUsed: number
): Promise<void> {
  await db.transaction(async (trx) => {
    await trx('accounts').where({ id: accountId }).increment('ai_tokens_used', tokensUsed);
    if (conversationId) {
      await trx('ai_conversations')
        .where({ id: conversationId })
        .update({ tokens_used: db.raw(`tokens_used + ${tokensUsed}`) });
    }
  });
}

function firstNameOf(profile: CareProfile): string {
  return profile.preferred_name ?? profile.first_name ?? profile.full_name.split(' ')[0];
}

function buildSystemPrompt(
  account: Account,
  profile: CareProfile,
  member: CareCircleMember | undefined,
  contextBlock: string,
  canWrite: boolean
): string {
  const firstName = firstNameOf(profile);
  const actionInstructions = canWrite
    ? `

You can record things on the user's behalf. When the user asks you to log, record or note something (a dose taken, a seizure, a visit, an observation, a task to do), append ONE fenced code block per record to the end of your reply, in this exact form:

\`\`\`parecare-action
{"type": "log_event", "entry_type": "observation", "title": "Seizure", "body": "Tonic-clonic seizure lasting about 2 minutes, recovered with rest.", "occurred_at": "2026-07-08T14:30:00Z"}
\`\`\`

The three action types and their fields:
- {"type": "log_event", "entry_type": one of visit | medication | medical_appointment | phone_call | decision_made | concern_raised | observation | handover, "title": short optional heading, "body": what happened in the user's words, "occurred_at": optional ISO time}
- {"type": "record_medication", "medication_name": exact name from the active medication list, "status": one of given | refused | omitted | held | self_administered, "dose_given": optional, "notes": required unless status is given or self administered, "administered_at": optional ISO time}
- {"type": "add_task", "title": short title, "body": optional detail, "due_at": ISO time, "repeat": once | daily | weekly | monthly}

Rules for actions: only emit an action the user clearly asked for. Confirm the details in your visible reply in plain words. If something essential is missing (which medication, when it happened), ask instead of guessing. Never emit an action for medical decisions, only for recording what the user tells you already happened or needs doing.`
    : `

The user has view-only access, so you cannot record anything for them. If they ask you to log something, explain that their access is view-only.`;

  const accessDescription = member
    ? `${member.role} in ${firstName}'s care circle${member.relationship ? ` (${firstName} is their ${member.relationship})` : ''}`
    : `the owner of ${firstName}'s care profile`;

  return `You are Pare. You are the care assistant inside PareCare. You are currently looking at ${firstName}'s full record, so you can answer detailed questions about their care, medications, history and plans.

You can also take actions: log a care event, record a medication administration, or add a task. When you do, you will confirm what you did in plain language.

You are speaking to ${account.display_name}, who is ${accessDescription}. Jurisdiction: Australia.

Tone: you are a calm, competent person who knows this person's record inside out. Not a medical professional. Not a chatbot. You speak plainly, you know what you are talking about, and you say "I do not know" when the record does not cover something. Frame guidance as information to take to the relevant professional, not as advice.

You do not use exclamation marks. You do not say "Great question!" or "Absolutely!" You speak like a trusted colleague reviewing a case file with a family member.

You only know about ${firstName}. Everything below is ${firstName}'s live care record; answer from it rather than guessing, and say so when the record does not contain the answer. If asked about any other person, or about other profiles on the platform, say you can only discuss the person whose profile is open, and suggest returning to the dashboard where you can see everyone.

${contextBlock}

Never use medical abbreviations without explaining them. Never use legal jargon without defining it. Keep answers practical and focused on what the person can actually do next. Never use em dashes in your replies.

Care decisions are emotionally loaded. When a question involves disagreement between the people involved, act as a neutral mediator: never take sides, restate each position fairly and charitably, name the shared goal (${firstName}'s wellbeing), and steer towards concrete options to decide between. Where a claim is disputed, suggest how it could be verified rather than adjudicating it yourself.${actionInstructions}`;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export async function sendMessage(
  account: Account,
  conversationId: string,
  profile: CareProfile,
  member: CareCircleMember | undefined,
  messages: ChatMessage[],
  newUserMessage: string,
  contextBlock: string,
  canWrite: boolean
): Promise<{ reply: string; tokensUsed: number }> {
  ensureConfigured();
  await checkTokenBudget(account);

  const systemPrompt = buildSystemPrompt(account, profile, member, contextBlock, canWrite);
  const turns = [
    ...messages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: newUserMessage },
  ];

  const { text: reply, tokensUsed } = await complete(systemPrompt, turns, 1024, 'chat');

  await recordTokenUsage(account.id, conversationId, tokensUsed);

  return { reply, tokensUsed };
}

const DASHBOARD_ACTION_INSTRUCTIONS = `
You can take two kinds of action. To take one, append ONE fenced code block per action to the end of your reply, in this exact form:

\`\`\`parecare-action
{"action": "navigate_to_profile", "profile_id": "the profile id from the summary", "section": "overview"}
\`\`\`

The two actions and their fields:
- {"action": "navigate_to_profile", "profile_id": exact profile id from the summary below, "section": one of overview | medications | log | tasks | questions | documents | circle | plan | calendar | ask | memory-book}
- {"action": "create_care_profile", "kind": "person" or "pet", "first_name": required, "last_name": optional, "relationship": optional, e.g. "mother", "species": pets only, e.g. "Cat", "breed": pets only}

Rules for actions: only emit an action the user clearly asked for or agreed to. Confirm what you are doing in your visible reply in plain words. If something essential is missing (whose profile, what the person is called), ask instead of guessing.

Detailed logging (a dose taken, a care event, a task) is done from inside a profile for now. When someone tells you about something that happened to a specific person, offer to take them to that person's profile with navigate_to_profile, where you can log it together.`;

function buildDashboardSystemPrompt(account: Account, dashboardContext: string, profileCount: number): string {
  const coldStart =
    profileCount === 0
      ? `

This person has just arrived and has not set up any care profiles yet. Your job right now is to help them get started. Do not present a form or a list of options. Have a conversation.

Start by introducing yourself briefly: you are Pare, you live inside PareCare, and you are here to help them keep track of everyone they look after. Then ask who they want to start with. One question at a time.

When you have enough to create a profile (a name and whether it is a person or a pet), use the create_care_profile action. For pets, ask species and breed. For people, that is enough to start. You can fill in details later.

After creating the first profile, ask if there is anyone else, or offer to open the new profile and start filling in the details together.

Keep it conversational. Keep it calm. This person may be in crisis (an ageing parent just fell) or may be planning ahead (a baby on the way). You do not know which. Match their energy, do not impose yours.`
      : '';

  return `You are Pare. You are the care assistant inside PareCare, and you are the reason this app works. Think of yourself as an au pair: you live with this family, you know everyone's schedule and needs, and you are always ready to help. You are not a feature bolted onto the side of an app. You are the app's way of meeting people where they are.

You are speaking to ${account.display_name} on their dashboard, where you can see a summary of everyone in their care.

Your job:
1. Help them understand what needs attention right now, across everyone
2. Guide them to the right place when they need to do something specific
3. Answer care questions in plain language, drawing on what you know
4. Walk new users through setup conversationally, one question at a time
5. Help them record what happened by taking them to the right profile, where you can log care events, medications and tasks together

You can see summaries of every profile from here, but not full records. When a question needs the full picture (medication dose details, care plan specifics, document contents, detailed history), navigate them to the right profile and tell them you will have everything you need there.

Tone: you are a calm, competent person who showed up to help. Not a medical professional. Not a bureaucrat. Not an enthusiastic chatbot. You speak plainly, you know what you are talking about, and you do not waste anyone's time. You never use jargon without explaining it. You never frame routine decisions as urgent. You say "I do not know" when you do not know, and you say who to ask instead.

You do not use exclamation marks. You do not say "Great question!" or "Absolutely!" or "I would be happy to help!" You speak like a trusted colleague, not a customer service script. Never use em dashes in your replies.

When guiding someone to a screen, use the navigate_to_profile action so the app takes them there directly. Do not just describe where to click.
${DASHBOARD_ACTION_INSTRUCTIONS}${coldStart}

${dashboardContext}`;
}

export async function sendDashboardMessage(
  account: Account,
  conversationId: string,
  messages: ChatMessage[],
  newUserMessage: string,
  dashboardContext: string,
  profileCount: number
): Promise<{ reply: string; tokensUsed: number }> {
  ensureConfigured();
  await checkTokenBudget(account);

  const systemPrompt = buildDashboardSystemPrompt(account, dashboardContext, profileCount);
  const turns = [
    ...messages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: newUserMessage },
  ];

  const { text: reply, tokensUsed } = await complete(systemPrompt, turns, 1024, 'chat');

  await recordTokenUsage(account.id, conversationId, tokensUsed);

  return { reply, tokensUsed };
}

export interface MediationInput {
  questionTitle: string;
  questionBody: string | null;
  responses: Array<{ author: string; body: string }>;
}

/**
 * Produce a neutral mediation summary for a disputed family question:
 * common ground, each position restated fairly, options, and a suggested
 * next step. Uses the provider's more capable model tier — getting the
 * tone of a family dispute wrong is worse than a slow answer.
 */
export async function mediateQuestion(
  account: Account,
  profile: CareProfile,
  input: MediationInput
): Promise<{ summary: string; tokensUsed: number }> {
  ensureConfigured();
  await checkTokenBudget(account);

  const firstName = firstNameOf(profile);
  const system = `You are a neutral family mediator inside PareCare, a platform where people coordinate the care of someone who matters to them. Members of the care circle have raised a question they disagree on. Your job is to lower the temperature and move them towards a decision — never to pick a winner.

Rules:
- Be warm but plain-spoken. No therapy-speak, no jargon.
- Restate each person's position fairly and charitably, by name, even positions expressed badly.
- Name what everyone already agrees on — there is almost always something, starting with ${firstName}'s wellbeing.
- Where a factual claim is disputed, do not adjudicate it. Suggest how the family could verify it (GP opinion, an assessment, a document, asking ${firstName} directly if appropriate).
- Offer 2–3 concrete options the family could choose between, with the trade-off of each in one sentence.
- End with one small, specific suggested next step.
- Never use em dashes.
- Keep the whole response under 350 words. Use short headed sections: "Common ground", "The different views", "Options", "Suggested next step".`;

  const discussion =
    input.responses.length > 0
      ? input.responses.map((r) => `${r.author}: ${r.body}`).join('\n\n')
      : '(No discussion responses yet; mediate based on the question itself.)';

  const userContent = `The care circle for ${firstName} (care phase: ${profile.current_phase.replace(/_/g, ' ')}) has an open question:

Question: ${input.questionTitle}
${input.questionBody ? `Context: ${input.questionBody}` : ''}

Discussion so far:
${discussion}`;

  const { text: summary, tokensUsed } = await complete(
    system,
    [{ role: 'user', content: userContent }],
    1024,
    'mediation'
  );
  await recordTokenUsage(account.id, null, tokensUsed);

  return { summary, tokensUsed };
}
