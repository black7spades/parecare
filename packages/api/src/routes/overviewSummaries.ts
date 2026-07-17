import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

/**
 * Stored AI summaries for the overview cards of a care profile. A summary
 * is generated once (on demand or on the card's first load), kept in
 * overview_card_summaries, and only rewritten when someone regenerates it
 * or edits the text and saves. Viewers can read; writes are blocked for
 * them by the shared blockViewerWrites middleware.
 */

export const overviewSummariesRouter = Router({ mergeParams: true });

const CARD_KEYS = ['neurotypes', 'health', 'log'] as const;
type CardKey = (typeof CARD_KEYS)[number];

const isCardKey = (v: string): v is CardKey => (CARD_KEYS as readonly string[]).includes(v);

overviewSummariesRouter.get('/', requireAuth, async (req, res) => {
  const summaries = await db('overview_card_summaries')
    .where({ care_profile_id: req.params['id'] })
    .select('card_key', 'content', 'source', 'generated_at', 'updated_at');
  res.json({ summaries });
});

async function careNameOf(profileId: string): Promise<string> {
  const profile = await db('care_profiles').where({ id: profileId }).first();
  return profile?.preferred_name ?? profile?.first_name ?? profile?.full_name ?? 'This person';
}

/**
 * The facts the model is allowed to summarise, per card. Everything is
 * pulled fresh from the tables so the summary reflects the current record.
 */
async function buildContext(cardKey: CardKey, profileId: string, careName: string): Promise<string | null> {
  if (cardKey === 'neurotypes') {
    const neurotypes = await db('medical_conditions')
      .where({ care_profile_id: profileId, category: 'neurotype' })
      .orderBy('name', 'asc');
    if (neurotypes.length === 0) return null;
    const ids = neurotypes.map((n) => n.id as string);
    const [functions, symptoms, docs] = await Promise.all([
      db('condition_functions').whereIn('condition_id', ids),
      db('condition_symptoms').whereIn('condition_id', ids).whereNull('resolved_at'),
      db('documents').whereIn(
        'id',
        neurotypes.map((n) => n.diagnosis_document_id as string).filter(Boolean)
      ),
    ]);
    const lines = neurotypes.map((n) => {
      const doc = docs.find((d) => d.id === n.diagnosis_document_id);
      const fns = functions
        .filter((f) => f.condition_id === n.id)
        .map((f) => `${f.domain}: ${f.limitation_level}${f.impact_on_activities ? ` (${f.impact_on_activities})` : ''}`);
      const syms = symptoms.filter((s) => s.condition_id === n.id).map((s) => s.name);
      return [
        `- ${n.name}`,
        n.neurotype ? `  type: ${n.neurotype}` : null,
        n.diagnosis_status ? `  diagnosis status: ${n.diagnosis_status}` : null,
        n.diagnosis_date ? `  diagnosed: ${String(n.diagnosis_date).slice(0, 10)}` : null,
        n.diagnosing_provider ? `  diagnosed by: ${n.diagnosing_provider}` : null,
        n.severity ? `  severity: ${n.severity}` : null,
        n.notes ? `  notes: ${n.notes}` : null,
        doc ? `  diagnosis document on file: "${doc.label}"` : null,
        fns.length > 0 ? `  affected areas of daily life: ${fns.join('; ')}` : null,
        syms.length > 0 ? `  current symptoms: ${syms.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    });
    return `Neurotypes recorded for ${careName}:\n${lines.join('\n')}`;
  }

  if (cardKey === 'health') {
    const statuses = await db('health_statuses')
      .where({ care_profile_id: profileId })
      .whereNot('status', 'resolved')
      .orderBy('onset_date', 'desc');
    if (statuses.length === 0) return null;
    const symptoms = await db('health_status_symptoms')
      .whereIn('health_status_id', statuses.map((s) => s.id as string))
      .whereNull('resolved_at');
    const lines = statuses.map((s) => {
      const syms = symptoms.filter((x) => x.health_status_id === s.id).map((x) => x.name);
      return [
        `- ${s.name} (${s.category}, ${s.status}, since ${String(s.onset_date).slice(0, 10)})`,
        s.is_contagious ? '  contagious' : null,
        s.isolation_required ? '  isolation required' : null,
        syms.length > 0 ? `  current symptoms: ${syms.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    });
    return `Current health issues for ${careName}:\n${lines.join('\n')}`;
  }

  // cardKey === 'log'
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const entries = await db('care_log_entries')
    .where({ care_profile_id: profileId })
    .where('occurred_at', '>=', since)
    .orderBy('occurred_at', 'desc')
    .limit(50);
  if (entries.length === 0) return null;
  const lines = entries.map(
    (e) => `- ${String(e.occurred_at).slice(0, 10)} [${e.entry_type}] ${e.title}${e.body ? `: ${String(e.body).slice(0, 200)}` : ''}`
  );
  return `Care log entries for ${careName} over the last 30 days, newest first:\n${lines.join('\n')}`;
}

const CARD_INSTRUCTIONS: Record<CardKey, string> = {
  neurotypes:
    'Summarise the key findings of the diagnosis and, most importantly, what needs and supports the person has. ' +
    'Write 2 to 4 sentences.',
  health:
    'Summarise the current health picture: what is going on, what carers should watch for, and anything urgent. ' +
    'Write 2 to 3 sentences.',
  log:
    'Summarise what has been happening lately based on the care log: patterns, notable events and anything a carer ' +
    'picking up a shift should know. Write 2 to 4 sentences.',
};

async function upsertSummary(
  profileId: string,
  cardKey: CardKey,
  content: string,
  source: 'ai' | 'edited',
  accountId: string
) {
  const [row] = await db('overview_card_summaries')
    .insert({
      care_profile_id: profileId,
      card_key: cardKey,
      content,
      source,
      ...(source === 'ai' ? { generated_at: db.fn.now() } : {}),
      updated_by: accountId,
    })
    .onConflict(['care_profile_id', 'card_key'])
    .merge({
      content,
      source,
      ...(source === 'ai' ? { generated_at: db.fn.now() } : {}),
      updated_by: accountId,
      updated_at: db.fn.now(),
    })
    .returning(['card_key', 'content', 'source', 'generated_at', 'updated_at']);
  return row;
}

overviewSummariesRouter.post('/:cardKey/generate', requireAuth, async (req, res) => {
  const cardKey = String(req.params['cardKey']);
  if (!isCardKey(cardKey)) {
    res.status(400).json({ error: 'Unknown overview card', code: 'VALIDATION_ERROR' });
    return;
  }
  const { isAiConfigured, complete } = await import('../services/aiProvider');
  if (!isAiConfigured()) {
    res.status(503).json({ error: 'AI assistant is not configured', code: 'AI_NOT_CONFIGURED' });
    return;
  }
  const profileId = String(req.params['id']);
  const careName = await careNameOf(profileId);
  const context = await buildContext(cardKey, profileId, careName);
  if (!context) {
    res.status(404).json({ error: 'Nothing recorded to summarise yet', code: 'NOT_FOUND' });
    return;
  }
  const systemPrompt =
    'You are Pare, the assistant of a care coordination platform, writing a short summary for a card on a ' +
    "care profile's overview page. Your readers are family members and carers, not clinicians: plain, warm, " +
    'factual language, no jargon, no markdown, no headings, no lists. Never invent facts that are not in the ' +
    `context. ${CARD_INSTRUCTIONS[cardKey]}`;
  try {
    const result = await complete(systemPrompt, [{ role: 'user', content: context }], 1024, 'chat');
    const content = result.text.trim();
    if (!content) {
      res.status(502).json({ error: 'The assistant returned an empty summary', code: 'AI_ERROR' });
      return;
    }
    const summary = await upsertSummary(profileId, cardKey, content, 'ai', req.account!.id);
    res.json({ summary });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502;
    res.status(status).json({ error: 'Could not generate the summary', code: 'AI_ERROR' });
  }
});

const editSchema = z.object({ content: z.string().min(1).max(5000) });

overviewSummariesRouter.patch('/:cardKey', requireAuth, async (req, res) => {
  const cardKey = String(req.params['cardKey']);
  if (!isCardKey(cardKey)) {
    res.status(400).json({ error: 'Unknown overview card', code: 'VALIDATION_ERROR' });
    return;
  }
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const summary = await upsertSummary(
    String(req.params['id']),
    cardKey,
    parsed.data.content.trim(),
    'edited',
    req.account!.id
  );
  res.json({ summary });
});
