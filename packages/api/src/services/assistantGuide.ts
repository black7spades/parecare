/**
 * How an assistant should keep records in PareCare, written once and served
 * everywhere an assistant might read it: the connector's start-up
 * instructions, its get_recording_guide tool, its ready-made prompts, and
 * the standing instructions and skill file people copy from Connected apps.
 *
 * It is provider agnostic on purpose. Claude, ChatGPT, Gemini, a model in
 * Open WebUI: whatever the person talks to, it keeps records the same way,
 * and the records hold up when someone later needs them for a review, an
 * appointment or a claim.
 *
 * It describes good record keeping, never medical, legal or claims advice.
 */

export const RECORDING_GUIDE = `# Keeping records in PareCare

PareCare holds the care records for the people (and pets) this person looks after, and often for themselves. You are helping them keep those records while they talk to you. They are usually tired, often worried, and rarely at a desk. Make it easy: ask little, save accurately, and say plainly what was saved.

## The basics
- Work out who it is about. "Me", "Mum", "Dad" and real names all work; if a name could be more than one person, ask which.
- Save what they said, in their words, tidied but not embellished. Never invent a time, a dose, a symptom or a detail. If something important is missing, ask one short question, then save.
- Use the time it happened, not the time they told you, when they say it ("this morning", "at 2", "yesterday").
- After saving, say in one line what was saved and where. If a save failed, say so plainly and what to do next.
- Changes to a medication list are previewed first. Read the preview back and only confirm once they agree.

## Daily check-ins: how they are going
When they tell you how a day went, log it as an observation in the care log. A useful entry covers, where they mentioned it:
- how they felt, in their words;
- what they could not do, or could only do with help or with difficulty, and who helped;
- how long it lasted, and what made it better or worse;
- sleep, pain, energy, mood, appetite;
- anything new or unusual.
If they track a condition or symptom, also record a reading against it (severity 0 to 10) so it can be compared week to week. Do not turn a check-in into a questionnaire: one gentle follow-up at most.

## Appointments
- Before: book it with the date, time, place and who it is with. If the practitioner works at a clinic, name both; PareCare files them together.
- After: log what was said, any change to medication or treatment, questions still open, referrals, and the next step. Raise an open question for anything still undecided.
- Costs: record what it cost, who pays or reimburses it (NDIS, Medicare, private health, a government program, or themselves) and whether it has been claimed.

## Notes that hold up for a claim or review
Assessments for support, funding or payments generally look at how a condition affects everyday life over time, not just the diagnosis. Notes are most useful when they are:
- dated and specific: "Could not shower without help this morning; Sam helped for 20 minutes", not "bad day";
- about function: personal care, moving around, cooking, shopping, getting to appointments, work or study, concentration, social contact;
- consistent: a short note most days beats a long one now and then;
- honest: record good days too. They make the hard days believable.
Link costs to their funding source as they happen, and keep letters, reports and receipts in Documents.

When they need to prepare for a review, claim or appointment, use get_records_between for the period, then summarise it: what happened, how often, what help was needed, what it cost, and what is still unresolved. Quote their own entries with dates. Do not draw medical conclusions or say what they are entitled to; point them to the agency or a practitioner for that.

## Providers
Doctors, specialists, clinics and pharmacies live in one shared directory. "Add Dr Carly Examplename to Health Hub Morayfield" files the practitioner at the clinic, sharing its address. Any kind of provider can be named in plain words: Neurologist, Dentist, Physiotherapist.

## Privacy
These are health records. Use them only to help with what was asked. Do not repeat sensitive details back unless they are needed.`;

/** The guide as an Agent Skill file, for assistants that load skills. */
export function recordingSkill(connectionAddress: string): string {
  return `---
name: parecare-records
description: Keep care records in PareCare while talking. Use whenever the person mentions how they or someone they care for is going, an appointment, a symptom, a medication, a cost, a provider, or asks to log, file, record or summarise anything in PareCare, or to prepare notes for a claim, review or appointment.
---

${RECORDING_GUIDE}

## Connecting
These instructions need the PareCare connector. Its address is ${connectionAddress}. Add it to your assistant as a remote MCP connector, sign in on the PareCare screen that opens, and click Allow.
`;
}

/** The guide as plain standing instructions, for any assistant's custom instructions box. */
export function recordingInstructions(connectionAddress: string): string {
  return `${RECORDING_GUIDE}

## Connecting
Use the PareCare connector (${connectionAddress}) for all of the above. If it is not connected, say so and ask me to connect it rather than pretending something was saved.`;
}

export interface GuidePrompt {
  name: string;
  title: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
  render: (args: Record<string, string>) => string;
}

/** Ready-made starting points, offered by assistants that show connector prompts. */
export const GUIDE_PROMPTS: GuidePrompt[] = [
  {
    name: 'daily_check_in',
    title: 'Daily check-in',
    description: 'Log how today went, in a way that holds up for reviews and claims.',
    arguments: [{ name: 'person', description: 'Who it is about, e.g. "me" or "Mum".', required: false }],
    render: (a) =>
      `I want to log how today went${a['person'] ? ` for ${a['person']}` : ''}. Ask me how the day was, with at most one gentle follow-up about what was hard or what help was needed, then save it in PareCare as an observation following the PareCare recording guide. Record a symptom reading too if I mention one that is tracked.`,
  },
  {
    name: 'after_appointment',
    title: 'After an appointment',
    description: 'Record what happened at an appointment, any changes, costs and next steps.',
    arguments: [
      { name: 'person', description: 'Who the appointment was for.', required: false },
      { name: 'provider', description: 'Who it was with, e.g. "Dr Carly Examplename".', required: false },
    ],
    render: (a) =>
      `I have just been to an appointment${a['provider'] ? ` with ${a['provider']}` : ''}${a['person'] ? ` for ${a['person']}` : ''}. Help me record it in PareCare following the recording guide: what was said, any medication or treatment changes (preview those first), questions still open, the next step, and the cost and who pays it.`,
  },
  {
    name: 'prepare_for_claim_or_review',
    title: 'Prepare for a claim or review',
    description: 'Summarise a period of records for a claim, funding review or appointment.',
    arguments: [
      { name: 'person', description: 'Who it is about.', required: true },
      { name: 'from', description: 'Start date, YYYY-MM-DD.', required: true },
      { name: 'to', description: 'End date, YYYY-MM-DD. Defaults to today.', required: false },
      { name: 'purpose', description: 'What it is for, e.g. "NDIS plan review".', required: false },
    ],
    render: (a) =>
      `Use get_records_between for ${a['person']} from ${a['from']} to ${a['to'] || 'today'} and summarise it${a['purpose'] ? ` for ${a['purpose']}` : ''}, following the PareCare recording guide: what happened and how often, how daily life was affected and what help was needed, symptoms over time, appointments and outcomes, costs and their claim status, and what is still unresolved. Quote my entries with their dates. Do not draw medical conclusions or say what I am entitled to.`,
  },
];
