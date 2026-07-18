import { complete, isAiConfigured } from './aiProvider';

/**
 * A safety net for weak models. Some models, especially small local ones,
 * describe what they are about to record in prose but never emit the action
 * block, so nothing is carried out even though the reply reads as if it were.
 *
 * When a reply clearly means to record something yet produced no valid action,
 * we make one more, tightly scoped call that asks for ONLY the JSON block for
 * that request. A minimal prompt is far easier for a weak model to follow than
 * the full system prompt, so the block usually comes back the second time. The
 * completion function is injectable so the repair loop can be tested without a
 * live model.
 */

export type CompleteFn = typeof complete;

// A reply "means to act" when it talks about recording, logging, updating,
// adding, noting, removing or scheduling something.
const ACT_INTENT_RE =
  /\b(log(ged|ging)?|record(ed|ing)?|updat(e|ed|ing)|add(ed|ing)?|not(e|ed|ing)|remov(e|ed|ing)|set(ting)?|schedul(e|ed|ing)|restock(ed|ing)?|mark(ed|ing)?)\b/i;
// Or it faked a confirmation tick or a "Logged: / Updated:" style line.
const FAKE_CONFIRM_RE = /(^|\n)\s*(✔|✓|\[x\]|done[:.]|logged\b|updated\b|recorded\b)/i;

/** Whether a reply looks like it intended to record something. */
export function replyIntendsToAct(reply: string): boolean {
  return ACT_INTENT_RE.test(reply) || FAKE_CONFIRM_RE.test(reply);
}

/** Compact action reference for the profile assistant's repair prompt. */
export const PROFILE_ACTION_REFERENCE = [
  '- {"type":"log_event","entry_type":"visit|medication|medical_appointment|phone_call|decision_made|concern_raised|observation|handover","title":optional,"body":required,"occurred_at":optional ISO}',
  '- {"type":"record_medication","medication_name":exact name,"status":"given|refused|omitted|held|self_administered","dose_given":optional,"notes":optional,"administered_at":optional ISO}',
  '- {"type":"add_task","title":required,"body":optional,"due_at":ISO,"repeat":"once|daily|weekly|monthly"}',
  '- {"type":"add_medication","medication_name":required,"dose":optional,"schedule_times":optional ["HH:MM"],"supply":optional,"packs_on_hand":optional}',
  '- {"type":"update_medication","medication_name":exact name, then any of "dose","schedule_times",["HH:MM"],"supply","supply_remaining","packs_on_hand"}',
  '- {"type":"restock_medication","medication_name":exact name,"packs_on_hand":optional,"units_remaining":optional} when a new pack or repeat is picked up',
  '- {"type":"add_allergy","substance":required,"reaction":optional}',
  '- {"type":"add_condition","name":required,"status":optional,"notes":optional}',
  '- {"type":"raise_question","title":required,"body":optional}',
  '- {"type":"add_provider","provider_type":"gp|specialist|pharmacy|care_facility|allied_health|other","name":required,"phone":optional}',
  '- {"type":"add_substance","substance":required,"status":optional,"frequency":optional}',
].join('\n');

/** Compact reference for the dashboard assistant, which wraps per profile. */
export function dashboardActionReference(openProfileName: string | null): string {
  return [
    '- {"type":"cross_profile_log","entries":[{"profile_name":"exact person name","entry_type":"observation|visit|medication|medical_appointment|phone_call|decision_made|concern_raised|handover","title":optional,"body":required,"occurred_at":optional ISO}]}',
    '- {"type":"cross_profile_medications","entries":[{"profile_name":"exact person name","medication_name":"exact name","status":"given|refused|omitted|held|self_administered","dose_given":optional,"notes":required unless given or self_administered,"administered_at":optional ISO}]}',
    '- {"type":"profile_actions","entries":[{"profile_name":"exact person name","action":{ one single-profile action }}]} where a single-profile action is any of:',
    PROFILE_ACTION_REFERENCE.replace(/^/gm, '    '),
    openProfileName
      ? `When the request does not name anyone, the person is ${openProfileName}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Ask the model for only the action block(s) for a request. Returns the raw
 * text (to be run back through extractActionBlocks), or '' when the assistant
 * is unavailable or errors, in which case the caller simply carries on.
 */
export async function repairActionText(
  userMessage: string,
  reference: string,
  opts: { completion?: CompleteFn } = {}
): Promise<string> {
  // The real completion path needs a configured assistant; an injected one
  // (used in tests) always runs.
  if (!opts.completion && !isAiConfigured()) return '';
  const completion = opts.completion ?? complete;
  const system = [
    'You convert one care instruction into the exact JSON action block that carries it out, and nothing else.',
    'Reply with a single fenced block in exactly this form:',
    '```parecare-action',
    '{ ...one action object... }',
    '```',
    'Emit one block per record (several records mean several blocks). If the instruction is a question or is not something to record, reply with the single word NONE.',
    'Never add prose, explanation, apology, or a confirmation line. Only the block, or NONE.',
    '',
    'The actions and their fields:',
    reference,
  ].join('\n');
  try {
    const { text } = await completion(system, [{ role: 'user', content: userMessage }], 700, 'chat');
    return text;
  } catch {
    return '';
  }
}
