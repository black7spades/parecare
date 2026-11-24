import { complete, isAiConfigured } from './aiProvider';
import { getAiConfig } from '../config/settings';

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
  '- {"type":"record_medication","medication_name":exact name,"status":"given|refused|omitted|held|self_administered|not_in_stock","dose_given":optional,"notes":optional,"reason":optional,"administered_at":optional ISO}',
  '- {"type":"add_task","title":required,"body":optional,"due_at":"ISO, or YYYY-MM-DD for any time that day","repeat":"once|daily|weekly|fortnightly|monthly|three_monthly|six_monthly|yearly","with":optional who it is with,"with_type":optional,"with_phone":optional their number,"kind":optional,"for_condition":optional,"assign_to":optional,"documents":optional names}',
  '- {"type":"add_medication","medication_name":required,"dose":optional,"schedule_times":optional ["HH:MM"],"supply":optional,"packs_on_hand":optional,"prescriber":optional who writes the script,"started_at_appointment":optional visit title,"course_ends_on":optional YYYY-MM-DD,"repeats_left":optional,"reason":optional}',
  '- {"type":"update_medication","medication_name":exact name, then any of "dose","schedule_times",["HH:MM"],"supply","supply_remaining","packs_on_hand","prescriber","started_at_appointment","course_ends_on","repeats_left","reason","changed_on"}',
  '- {"type":"stop_medication","medication_name":exact name,"stopped_on":optional YYYY-MM-DD,"stop_reason":optional finished|side_effects|not_working|changed|doctor_stopped|no_longer_needed|other,"stop_notes":optional}',
  '- {"type":"restock_medication","medication_name":exact name,"packs_on_hand":optional,"units_remaining":optional} when a new pack or repeat is picked up',
  '- {"type":"add_allergy","substance":required,"reaction":optional,"severity":optional mild|moderate|severe|life_threatening}',
  '- {"type":"confirm_no_allergies"} only when told they have no known allergies',
  '- {"type":"set_id_numbers", any of "medicare_number","medicare_irn","medicare_valid_to":YYYY-MM,"ihi_number","dva_number","dva_card_colour":"gold|white|orange","ndis_number","health_fund_name","health_fund_member_number","my_aged_care_number","nhs_number","nhi_number","pps_number","medical_card_number","health_card_province","health_card_number","health_card_version","medicare_mbi","medicaid_number"} using only the numbers their country uses',
  '- {"type":"add_condition","name":required,"status":optional,"notes":optional,"treated_by":optional who treats it}',
  '- {"type":"update_condition","name":exact name, then any of "treated_by","treated_by_type","severity","status","notes"}',
  '- {"type":"set_emergency_contact","name":"me, a circle person or a contact","relationship":optional,"phone":optional,"first":optional true,"remove":optional true}',
  '- {"type":"raise_question","title":required,"body":optional,"ask":optional who to ask,"ask_at":optional visit title}',
  '- {"type":"answer_question","title":the question as raised,"answer":required}',
  '- {"type":"add_provider","kind":"organisation or person, optional","provider_type":"gp|specialist|legal|social_worker for a professional, practice|clinic|pharmacy|care_facility for an organisation, or plain words such as Neurologist or Government department","name":required,"organisation":"the organisation they are based at, optional","phone":optional,"after_hours_phone":optional,"fax":optional,"main":optional true for their main GP or pharmacy}',
  '- {"type":"add_substance","substance":required,"status":optional,"frequency":optional}',
  '- {"type":"book_appointment","title":required,"appointment_type":"consultation|test|procedure|therapy|review|vaccination|other","provider_name":optional,"location":optional,"starts_at":ISO,"ends_at":optional ISO,"notes":optional,"cost_estimate":optional number,"for_next_step":optional open task title,"no_set_time":optional true,"repeat":optional,"telehealth_link":optional,"interpreter_language":optional,"going":optional names,"driver":optional,"preparation":optional,"documents_to_bring":optional names,"with_phone":optional} for an appointment being made, never a log entry',
  '- {"type":"update_appointment","title":its current title, then any of "new_title","provider_name","location","starts_at" (to move it),"ends_at","status":"scheduled|completed|cancelled|missed","notes","cost_actual"}',
  '- {"type":"complete_task","title":the open task title,"completion_note":optional}',
  '- {"type":"reschedule_task","title":the open task title,"due_at":"ISO, or YYYY-MM-DD for any time that day","repeat":optional "once|daily|weekly|fortnightly|monthly|three_monthly|six_monthly|yearly"}',
  '- {"type":"record_cost","amount":number,"spent_on":optional YYYY-MM-DD,"description":optional,"funding_source":optional "self|ndis|private_health|medicare|government|other"}',
  '- {"type":"record_reading","treatment_name":exact name,"observed_at":optional ISO,"status":"completed|partial|skipped|refused","notes":required unless completed,"values":[{"metric_name":exact measure name,"value_number":number}]}',
  '- {"type":"record_hospital_stay","hospital":required,"admitted_on":YYYY-MM-DD,"discharged_on":optional,"ward":optional,"treating_team":optional,"reason":optional}',
  '- {"type":"record_discharge","discharged_on":YYYY-MM-DD,"follow_up_days":optional number,"follow_up_with":optional name}',
  '- {"type":"record_result","test_name":required,"collected_on":optional,"reported_on":optional,"summary":optional,"doctor_view":"normal|follow_up|not_seen","ordered_by":optional,"lab":optional,"for_appointment":optional title,"values":[{"name":measure,"value_number":number,"unit":optional,"range_low":optional,"range_high":optional,"flag":"low|high|normal"}]}',
  '- {"type":"set_funding_plan","scheme":"ndis|support_at_home|home_care_package|other","starts_on":optional,"ends_on":optional,"review_on":optional,"management":"agency|plan|self","plan_manager":optional,"support_coordinator":optional,"local_area_coordinator":optional,"budgets":[{"name","amount":number}]}',
  '- {"type":"record_move_into_care","care_home":required,"entry_on":optional,"agreement_signed_on":optional,"payment_choice":"lump_sum|daily|mix","notice_given_on":optional,"room":optional}',
].join('\n');

/** Compact reference for the dashboard assistant, which wraps per profile. */
export function dashboardActionReference(openProfileName: string | null): string {
  return [
    '- {"type":"cross_profile_log","entries":[{"profile_name":"exact person name","entry_type":"observation|visit|medication|medical_appointment|phone_call|decision_made|concern_raised|handover","title":optional,"body":required,"occurred_at":optional ISO}]}',
    '- {"type":"cross_profile_medications","entries":[{"profile_name":"exact person name","medication_name":"exact name","status":"given|refused|omitted|held|self_administered|not_in_stock","dose_given":optional,"notes":required when refused, omitted or held,"reason":optional,"administered_at":optional ISO}]}',
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
  // This second call is the fallback for models that describe an action in
  // prose but never emit it. Constrained providers cannot do that, so this
  // should never fire for them; logging every time it does lets us confirm
  // that before removing the safety net in a later change.
  if (!opts.completion) {
    console.warn(`[actionRepair] second-pass action repair fired for provider="${getAiConfig().provider}"`);
  }
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
