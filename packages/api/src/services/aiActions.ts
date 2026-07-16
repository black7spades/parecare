import { z } from 'zod';
import { db } from '../config/database';
import type { Account, CareAccess, CareCircleMember, CareProfile } from '../types';
import { parseZonedTime, formatInZone } from '../lib/timezone';
import { matchProfileNames, type NameCandidate } from '../lib/nameMatch';
import { drawDownOnHand, perDoseDrawdown } from './medicationSupply';
import { resolveConditionCatalogueId } from '../routes/conditionCatalogue';
import { resolveSymptomCatalogueId } from '../routes/symptomCatalogue';

/**
 * Actions the assistant can carry out on the user's behalf: logging a care
 * event, recording a medication dose, or adding a task. The model emits a
 * fenced ```parecare-action``` block containing one JSON action; the server
 * validates it against these schemas and executes it with the SAME
 * permission rules as the equivalent API endpoint (viewers cannot write).
 * Every action lands in the audit log like any other change.
 */

export const LOG_ENTRY_TYPES = [
  'visit',
  'medication',
  'medical_appointment',
  'phone_call',
  'decision_made',
  'concern_raised',
  'observation',
  'handover',
] as const;

const MEDICATION_STATUSES = ['given', 'refused', 'omitted', 'held', 'self_administered'] as const;

const logEventSchema = z.object({
  type: z.literal('log_event'),
  entry_type: z.enum(LOG_ENTRY_TYPES),
  title: z.string().max(255).optional().nullable(),
  body: z.string().min(1),
  occurred_at: z.string().optional().nullable(),
});

const recordMedicationSchema = z.object({
  type: z.literal('record_medication'),
  medication_name: z.string().min(1),
  status: z.enum(MEDICATION_STATUSES).default('given'),
  dose_given: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
  administered_at: z.string().optional().nullable(),
});

const recordMedicationBatchSchema = z.object({
  type: z.literal('record_medications'),
  entries: z
    .array(
      z.object({
        medication_name: z.string().min(1),
        status: z.enum(MEDICATION_STATUSES).default('self_administered'),
        dose_given: z.string().max(255).optional().nullable(),
        notes: z.string().optional().nullable(),
        administered_at: z.string().optional().nullable(),
      })
    )
    .min(1)
    .max(20),
});

const addTaskSchema = z.object({
  type: z.literal('add_task'),
  title: z.string().min(1).max(255),
  body: z.string().optional().nullable(),
  due_at: z.string(),
  repeat: z.enum(['once', 'daily', 'weekly', 'monthly']).default('once'),
});

const CARE_PHASES = [
  'early_concern',
  'home_with_support',
  'increased_dependency',
  'transition_to_residential',
  'residential_ongoing',
  'end_of_life',
] as const;

const PROVIDER_TYPES = [
  'gp',
  'specialist',
  'psychologist',
  'pharmacy',
  'care_facility',
  'allied_health',
  'legal',
  'financial',
  'social_worker',
  'other',
] as const;

const addMedicationSchema = z.object({
  type: z.literal('add_medication'),
  medication_name: z.string().min(1).max(255),
  dose: z.string().max(255).optional().nullable(),
  route: z.string().max(100).optional().nullable(),
  form: z.string().max(100).optional().nullable(),
  frequency: z.string().max(255).optional().nullable(),
  schedule_times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(12).optional().nullable(),
  instructions: z.string().optional().nullable(),
  units_per_dose: z.number().nonnegative().optional().nullable(),
  supply: z.number().nonnegative().optional().nullable(),
  packs_on_hand: z.number().nonnegative().optional().nullable(),
  with_food: z.boolean().optional(),
  as_needed: z.boolean().optional(),
  critical: z.boolean().optional(),
});

const updateMedicationSchema = z.object({
  type: z.literal('update_medication'),
  medication_name: z.string().min(1).max(255),
  dose: z.string().max(255).optional().nullable(),
  route: z.string().max(100).optional().nullable(),
  frequency: z.string().max(255).optional().nullable(),
  schedule_times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(12).optional().nullable(),
  instructions: z.string().optional().nullable(),
  units_per_dose: z.number().nonnegative().optional().nullable(),
  supply: z.number().nonnegative().optional().nullable(),
  supply_remaining: z.number().nonnegative().optional().nullable(),
  packs_on_hand: z.number().nonnegative().optional().nullable(),
  with_food: z.boolean().optional(),
  as_needed: z.boolean().optional(),
  critical: z.boolean().optional(),
});

// "Picked up two packs of Perindopril": set what is on hand after a restock.
const restockMedicationSchema = z.object({
  type: z.literal('restock_medication'),
  medication_name: z.string().min(1).max(255),
  packs_on_hand: z.number().nonnegative().optional().nullable(),
  units_remaining: z.number().nonnegative().optional().nullable(),
});

const stopMedicationSchema = z.object({
  type: z.literal('stop_medication'),
  medication_name: z.string().min(1).max(255),
});

const addAllergySchema = z.object({
  type: z.literal('add_allergy'),
  substance: z.string().min(1).max(255),
  reaction: z.string().optional().nullable(),
});

const removeAllergySchema = z.object({
  type: z.literal('remove_allergy'),
  substance: z.string().min(1).max(255),
});

const CONDITION_CATEGORIES = [
  'illness',
  'injury',
  'post_operative',
  'recovery',
  'mental_health',
  'chronic_flare',
  'acute_illness',
  'disability',
  'other',
] as const;

const CONDITION_STATUSES = ['active', 'improving', 'managed', 'resolved'] as const;

const CONDITION_SEVERITIES = ['mild', 'moderate', 'severe', 'critical'] as const;

const addConditionSchema = z.object({
  type: z.literal('add_condition'),
  name: z.string().min(1).max(255),
  category: z.enum(CONDITION_CATEGORIES).optional().nullable(),
  severity: z.enum(CONDITION_SEVERITIES).optional().nullable(),
  status: z.enum(CONDITION_STATUSES).optional().nullable(),
  started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const removeConditionSchema = z.object({
  type: z.literal('remove_condition'),
  name: z.string().min(1).max(255),
});

const resolveConditionSchema = z.object({
  type: z.literal('resolve_condition'),
  name: z.string().min(1).max(255),
  resolved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

// The acute illness tracker: record a symptom on a condition, or move an
// existing symptom's severity up or down as things progress.
const addSymptomSchema = z.object({
  type: z.literal('add_symptom'),
  condition_name: z.string().min(1).max(255),
  symptom_name: z.string().min(1).max(255),
  severity: z.number().int().min(1).max(5).default(3),
});

const updateSymptomSchema = z.object({
  type: z.literal('update_symptom'),
  symptom_name: z.string().min(1).max(255),
  condition_name: z.string().max(255).optional().nullable(),
  severity: z.number().int().min(1).max(5).optional().nullable(),
  resolved: z.boolean().optional().nullable(),
});

const TREATMENT_CATEGORIES = [
  'device',
  'therapy',
  'exercise',
  'wound_care',
  'diet',
  'surgery',
  'lifestyle',
  'assistive_device',
  'other',
] as const;

const addTreatmentSchema = z.object({
  type: z.literal('add_treatment'),
  name: z.string().min(1).max(255),
  category: z.enum(TREATMENT_CATEGORIES).default('other'),
  condition_name: z.string().max(255).optional().nullable(),
});

const raiseQuestionSchema = z.object({
  type: z.literal('raise_question'),
  title: z.string().min(1).max(255),
  body: z.string().optional().nullable(),
});

const setCarePhaseSchema = z.object({
  type: z.literal('set_care_phase'),
  phase: z.enum(CARE_PHASES),
});

const addProviderSchema = z.object({
  type: z.literal('add_provider'),
  provider_type: z.enum(PROVIDER_TYPES),
  name: z.string().min(1).max(255),
  organisation: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  booking_link: z.string().url().optional().nullable(),
  directions_link: z.string().url().optional().nullable(),
});

const updateProviderSchema = z.object({
  type: z.literal('update_provider'),
  name: z.string().min(1).max(255),
  provider_type: z.enum(PROVIDER_TYPES).optional(),
  organisation: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  booking_link: z.string().url().optional().nullable(),
  directions_link: z.string().url().optional().nullable(),
});

const updateCarePlanSchema = z.object({
  type: z.literal('update_care_plan'),
  dietary_requirements: z.array(z.string()).max(50).optional().nullable(),
  mobility_aids: z.array(z.string()).max(50).optional().nullable(),
  // A list of discrete needs; the GP lives in providers (use the provider
  // actions to change it).
  communication_needs: z.array(z.string()).max(50).optional().nullable(),
  advance_care_directive: z.boolean().optional().nullable(),
  advance_care_directive_location: z.string().optional().nullable(),
});

const updateProfileSchema = z.object({
  type: z.literal('update_profile'),
  preferred_name: z.string().max(100).optional().nullable(),
  pronouns: z.string().max(50).optional().nullable(),
  primary_language: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
});

export const actionSchema = z.discriminatedUnion('type', [
  logEventSchema,
  recordMedicationSchema,
  recordMedicationBatchSchema,
  addTaskSchema,
  addMedicationSchema,
  updateMedicationSchema,
  stopMedicationSchema,
  restockMedicationSchema,
  addAllergySchema,
  removeAllergySchema,
  addConditionSchema,
  removeConditionSchema,
  resolveConditionSchema,
  addSymptomSchema,
  updateSymptomSchema,
  addTreatmentSchema,
  raiseQuestionSchema,
  setCarePhaseSchema,
  addProviderSchema,
  updateProviderSchema,
  updateCarePlanSchema,
  updateProfileSchema,
]);
export type AssistantAction = z.infer<typeof actionSchema>;

/**
 * Actions the dashboard assistant can take across more than one care
 * profile at once. Each entry names its target profile, so one sentence
 * ("we took both cats to the vet") can land on every relevant record.
 */
const crossProfileLogSchema = z.object({
  type: z.literal('cross_profile_log'),
  entries: z
    .array(
      z.object({
        profile_name: z.string().min(1),
        entry_type: z.enum(LOG_ENTRY_TYPES),
        title: z.string().max(255).optional().nullable(),
        body: z.string().min(1),
        occurred_at: z.string().optional().nullable(),
      })
    )
    .min(1)
    .max(20),
});

const crossProfileTaskSchema = z.object({
  type: z.literal('cross_profile_task'),
  entries: z
    .array(
      z.object({
        profile_name: z.string().min(1),
        title: z.string().min(1).max(255),
        body: z.string().optional().nullable(),
        due_at: z.string(),
        repeat: z.enum(['once', 'daily', 'weekly', 'monthly']).default('once'),
      })
    )
    .min(1)
    .max(20),
});

const crossProfileMedicationSchema = z.object({
  type: z.literal('cross_profile_medications'),
  entries: z
    .array(
      z.object({
        profile_name: z.string().min(1),
        medication_name: z.string().min(1),
        status: z.enum(MEDICATION_STATUSES).default('self_administered'),
        dose_given: z.string().max(255).optional().nullable(),
        notes: z.string().optional().nullable(),
        administered_at: z.string().optional().nullable(),
      })
    )
    .min(1)
    .max(20),
});

/**
 * The general dashboard action: run any single-profile action against a
 * named profile. This is what lets Pare do, from one conversation, anything
 * that can be done by hand on a person's record: change a medication
 * schedule, add an allergy, resolve a question, move a care phase, and so
 * on, without a bespoke cross-profile wrapper for each.
 */
const profileActionsSchema = z.object({
  type: z.literal('profile_actions'),
  entries: z
    .array(
      z.object({
        profile_name: z.string().min(1),
        action: actionSchema,
      })
    )
    .min(1)
    .max(20),
});

export const crossProfileActionSchema = z.discriminatedUnion('type', [
  crossProfileLogSchema,
  crossProfileTaskSchema,
  crossProfileMedicationSchema,
  profileActionsSchema,
]);
export type CrossProfileAction = z.infer<typeof crossProfileActionSchema>;

const ACTION_BLOCK_RE = /```parecare-action\s*\n([\s\S]*?)```/g;

export interface ExtractedActions<T = AssistantAction> {
  /** The reply with action blocks removed. */
  cleanedReply: string;
  actions: T[];
  parseErrors: string[];
}

/**
 * Pull every fenced parecare-action block out of a reply and validate it
 * against the given schema. Shared by the profile-level assistant and the
 * dashboard assistant, which understand different action sets.
 */
export function extractActionBlocks<T>(reply: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): ExtractedActions<T> {
  const actions: T[] = [];
  const parseErrors: string[] = [];
  let cleanedReply = reply.replace(ACTION_BLOCK_RE, (_whole, json: string) => {
    try {
      const raw = JSON.parse(json);
      const parsed = schema.safeParse(raw);
      if (parsed.success) actions.push(parsed.data);
      else {
        const attempted = String(raw?.type ?? raw?.action ?? '').replace(/_/g, ' ') || 'take an unrecognised action';
        // Name the field that failed, so the user (and Pare, on the next
        // turn) can see exactly what was wrong instead of a dead end.
        const first = parsed.error.issues[0];
        const where = first?.path?.length ? ` (problem with "${first.path.join('.')}": ${first.message.toLowerCase()})` : '';
        console.warn('Assistant action validation failed:', attempted, parsed.error.format());
        parseErrors.push(
          `Pare tried to ${attempted} but that action could not be validated${where}, so it was not carried out. Try asking again in different words.`
        );
      }
    } catch {
      parseErrors.push('Pare suggested an action that could not be read, so it was not carried out.');
    }
    return '';
  });
  // A reply cut off mid-action (provider token limit) leaves an opening
  // fence with no closing one. Never show the half-written JSON to the
  // user, and say plainly that nothing was recorded for it.
  const dangling = cleanedReply.indexOf('```parecare-action');
  if (dangling !== -1) {
    cleanedReply = cleanedReply.slice(0, dangling);
    parseErrors.push('The reply was cut off before this could be recorded, so nothing was saved. Please ask again.');
  }
  cleanedReply = cleanedReply.replace(/\n{3,}/g, '\n\n').trim();
  return { cleanedReply, actions, parseErrors };
}

export function extractActions(reply: string): ExtractedActions {
  return extractActionBlocks(reply, actionSchema);
}

/**
 * Turn an assistant-supplied time into a UTC instant. A naive wall-clock
 * time ("2026-07-10T11:00:00") is read in the user's own time zone, so
 * "11am this morning" is stored as 11am where they are, not 11am UTC.
 */
function parseWhen(value: string | null | undefined, timeZone: string | null | undefined): Date {
  if (!value) return new Date();
  const d = parseZonedTime(value, timeZone);
  if (!d) return new Date();
  // Never record anything in the future; clamp to now (same rule as the MAR).
  return d.getTime() > Date.now() + 60_000 ? new Date() : d;
}

async function audit(profileId: string, accountId: string, entityType: string, summary: string): Promise<void> {
  await db('audit_log')
    .insert({ care_profile_id: profileId, actor_account_id: accountId, action: 'created', entity_type: entityType, summary: summary.slice(0, 255) })
    .catch(() => {});
}

const GIVEN = new Set(['given', 'self_administered']);

interface MedicationEntry {
  medication_name: string;
  status: (typeof MEDICATION_STATUSES)[number];
  dose_given?: string | null;
  notes?: string | null;
  administered_at?: string | null;
}

/**
 * Record one medication administration: look the medication up on the
 * profile's active list, insert the MAR row, draw down the supply and audit.
 * Shared by the singular and batch actions.
 */
async function recordOneMedication(
  entry: MedicationEntry,
  profileId: string,
  account: Account,
  timeZone: string | null | undefined
): Promise<string> {
  const med = await db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where({ 'm.care_profile_id': profileId, 'm.active': true })
    .whereRaw('lower(c.name) = lower(?)', [entry.medication_name.trim()])
    .select('m.*', 'c.name as name', 'c.form as form')
    .first();
  if (!med) {
    return `Could not record the dose: no active medication called "${entry.medication_name}" is on the list.`;
  }
  if (!GIVEN.has(entry.status) && !entry.notes?.trim()) {
    return `Could not record the ${entry.status} dose of ${med.name}: a note explaining why is required.`;
  }
  const administeredAt = parseWhen(entry.administered_at, timeZone);
  await db('medication_administrations').insert({
    medication_id: med.id,
    care_profile_id: profileId,
    administered_at: administeredAt,
    administered_by_account_id: account.id,
    administered_by_name: account.display_name,
    status: entry.status,
    dose_given: entry.dose_given ?? med.dose ?? null,
    route_given: med.route ?? null,
    notes: [entry.notes?.trim(), 'Recorded through the PareCare assistant.'].filter(Boolean).join(' '),
    right_patient: true,
    right_medication: true,
    right_documentation: true,
    // Dose, route and time must be verified by a person at the point of
    // care; a conversational log cannot confirm them.
    right_dose: false,
    right_route: false,
    right_time: false,
  });
  if (GIVEN.has(entry.status)) {
    // Draw supply down by units taken each time; the dose volume only counts
    // for measured, liquid-style forms. Shared with the REST record path.
    await drawDownOnHand(med.id, perDoseDrawdown(med));
  }
  await audit(profileId, account.id, 'medications', `${med.name} ${entry.status}`);
  const at = formatInZone(administeredAt, timeZone);
  return `Recorded ${med.name}${entry.dose_given ?? med.dose ? ` ${entry.dose_given ?? med.dose}` : ''} as ${entry.status.replace(/_/g, ' ')} at ${at}.`;
}

async function executeOne(
  action: AssistantAction,
  profileId: string,
  account: Account,
  access: CareAccess,
  timeZone: string | null | undefined
): Promise<string | string[]> {
  switch (action.type) {
    case 'log_event': {
      const occurredAt = parseWhen(action.occurred_at, timeZone);
      await db('care_log_entries').insert({
        care_profile_id: profileId,
        author_member_id: access.member?.id ?? null,
        entry_type: action.entry_type,
        title: action.title ?? null,
        body: action.body,
        occurred_at: occurredAt,
      });
      await audit(profileId, account.id, 'log', action.title ?? action.body);
      return `Logged a ${action.entry_type.replace(/_/g, ' ')} entry${action.title ? `: ${action.title}` : ''} at ${formatInZone(occurredAt, timeZone)}.`;
    }
    case 'record_medication': {
      return recordOneMedication(action, profileId, account, timeZone);
    }
    case 'record_medications': {
      // One dose failing to record must not stop the rest of the batch.
      const results: string[] = [];
      for (const entry of action.entries) {
        try {
          results.push(await recordOneMedication(entry, profileId, account, timeZone));
        } catch (err) {
          console.warn('Assistant batch medication entry failed:', (err as Error).message);
          results.push(`Could not record ${entry.medication_name}. Please record it directly in the app.`);
        }
      }
      return results;
    }
    case 'add_task': {
      const due = parseZonedTime(action.due_at, timeZone);
      if (!due) {
        return `Could not add the task "${action.title}": the due time was unclear.`;
      }
      await db('reminders').insert({
        care_profile_id: profileId,
        title: action.title,
        body: action.body ?? null,
        reminder_type: action.repeat,
        next_due_at: due,
      });
      await audit(profileId, account.id, 'reminders', action.title);
      return `Added the task "${action.title}" due ${formatInZone(due, timeZone)}.`;
    }
    case 'add_medication': {
      const name = action.medication_name.trim();
      let cat = await db('medication_catalogue').whereRaw('lower(name) = lower(?)', [name]).first();
      if (!cat) {
        [cat] = await db('medication_catalogue')
          .insert({ name, form: action.form ?? null, created_by_account_id: account.id })
          .returning('*');
      }
      await db('medications').insert({
        care_profile_id: profileId,
        medication_catalogue_id: cat.id,
        dose: action.dose ?? null,
        route: action.route ?? null,
        frequency: action.frequency ?? null,
        schedule_times: action.schedule_times ? JSON.stringify(action.schedule_times) : null,
        instructions: action.instructions ?? null,
        units_per_dose: action.units_per_dose ?? null,
        supply: action.supply ?? null,
        supply_remaining: action.supply ?? null,
        packs_on_hand: action.packs_on_hand ?? null,
        with_food: action.with_food ?? false,
        as_needed: action.as_needed ?? false,
        critical: action.critical ?? false,
        active: true,
      });
      await audit(profileId, account.id, 'medications', `added ${name}`);
      return `Added ${name}${action.dose ? ` ${action.dose}` : ''} to the medication list.`;
    }
    case 'update_medication': {
      const med = await db('medications as m')
        .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
        .where({ 'm.care_profile_id': profileId, 'm.active': true })
        .whereRaw('lower(c.name) = lower(?)', [action.medication_name.trim()])
        .select('m.*', 'c.name as name')
        .first();
      if (!med) return `Could not find an active medication called "${action.medication_name}".`;
      const patch: Record<string, unknown> = { updated_at: db.fn.now() };
      if (action.dose !== undefined) patch['dose'] = action.dose;
      if (action.route !== undefined) patch['route'] = action.route;
      if (action.frequency !== undefined) patch['frequency'] = action.frequency;
      if (action.schedule_times !== undefined)
        patch['schedule_times'] = action.schedule_times ? JSON.stringify(action.schedule_times) : null;
      if (action.instructions !== undefined) patch['instructions'] = action.instructions;
      if (action.units_per_dose !== undefined) patch['units_per_dose'] = action.units_per_dose;
      if (action.supply !== undefined) {
        patch['supply'] = action.supply;
        if (action.supply_remaining === undefined) patch['supply_remaining'] = action.supply;
      }
      if (action.supply_remaining !== undefined) patch['supply_remaining'] = action.supply_remaining;
      if (action.packs_on_hand !== undefined) patch['packs_on_hand'] = action.packs_on_hand;
      if (action.with_food !== undefined) patch['with_food'] = action.with_food;
      if (action.as_needed !== undefined) patch['as_needed'] = action.as_needed;
      if (action.critical !== undefined) patch['critical'] = action.critical;
      await db('medications').where({ id: med.id }).update(patch);
      await audit(profileId, account.id, 'medications', `updated ${med.name}`);
      const when = action.schedule_times ? ` Scheduled at ${action.schedule_times.join(', ')}.` : '';
      return `Updated ${med.name}.${when}`;
    }
    case 'stop_medication': {
      const med = await db('medications as m')
        .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
        .where({ 'm.care_profile_id': profileId, 'm.active': true })
        .whereRaw('lower(c.name) = lower(?)', [action.medication_name.trim()])
        .select('m.id', 'c.name as name')
        .first();
      if (!med) return `Could not find an active medication called "${action.medication_name}".`;
      await db('medications').where({ id: med.id }).update({ active: false, updated_at: db.fn.now() });
      await audit(profileId, account.id, 'medications', `stopped ${med.name}`);
      return `Stopped ${med.name}. It is no longer on the active medication list.`;
    }
    case 'restock_medication': {
      if (action.packs_on_hand == null && action.units_remaining == null) {
        return `Could not restock ${action.medication_name}: say how many packs or units are now on hand.`;
      }
      const med = await db('medications as m')
        .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
        .where({ 'm.care_profile_id': profileId, 'm.active': true })
        .whereRaw('lower(c.name) = lower(?)', [action.medication_name.trim()])
        .select('m.id', 'm.supply', 'c.name as name')
        .first();
      if (!med) return `Could not find an active medication called "${action.medication_name}".`;
      const patch: Record<string, unknown> = { updated_at: db.fn.now() };
      if (action.packs_on_hand != null) patch['packs_on_hand'] = action.packs_on_hand;
      if (action.units_remaining != null) patch['supply_remaining'] = action.units_remaining;
      // Restocking packs alone, with nothing loose recorded, starts the count
      // from zero loose units so the total reads exactly what was picked up.
      await db('medications').where({ id: med.id }).update(patch);
      // A restock clears any "out of stock" acknowledgement, same as the app.
      await db('attention_dismissals').where({ item_key: `out_of_stock:${med.id}` }).delete();
      await audit(profileId, account.id, 'medications', `restocked ${med.name}`);
      const parts = [
        action.packs_on_hand != null ? `${action.packs_on_hand} ${action.packs_on_hand === 1 ? 'pack' : 'packs'}` : null,
        action.units_remaining != null ? `${action.units_remaining} units in the open pack` : null,
      ].filter(Boolean);
      return `Updated ${med.name}'s supply: ${parts.join(' and ')} on hand.`;
    }
    case 'add_allergy': {
      await db('allergies').insert({
        care_profile_id: profileId,
        substance: action.substance.trim(),
        reaction: action.reaction ?? null,
      });
      await audit(profileId, account.id, 'allergies', `added allergy ${action.substance}`);
      return `Recorded an allergy to ${action.substance}${action.reaction ? ` (${action.reaction})` : ''}.`;
    }
    case 'remove_allergy': {
      const n = await db('allergies')
        .where({ care_profile_id: profileId })
        .whereRaw('lower(substance) = lower(?)', [action.substance.trim()])
        .del();
      if (!n) return `No allergy to "${action.substance}" was on the record.`;
      await audit(profileId, account.id, 'allergies', `removed allergy ${action.substance}`);
      return `Removed the allergy to ${action.substance}.`;
    }
    case 'add_condition': {
      const name = action.name.trim();
      // The shared catalogue keeps one entry per condition across the
      // instance, same as adding it by hand.
      const catalogueId = await resolveConditionCatalogueId(name, account.id).catch(() => null);
      await db('medical_conditions').insert({
        care_profile_id: profileId,
        condition_catalogue_id: catalogueId,
        name,
        category: action.category ?? null,
        severity: action.severity ?? null,
        status: action.status ?? 'active',
        started_on: action.started_on ?? null,
        notes: action.notes ?? null,
      });
      await audit(profileId, account.id, 'conditions', `added condition ${name}`);
      return `Added the condition ${name}${action.category ? ` (${action.category.replace(/_/g, ' ')})` : ''}.`;
    }
    case 'remove_condition': {
      const n = await db('medical_conditions')
        .where({ care_profile_id: profileId })
        .whereRaw('lower(name) = lower(?)', [action.name.trim()])
        .del();
      if (!n) return `No condition called "${action.name}" was on the record.`;
      await audit(profileId, account.id, 'conditions', `removed condition ${action.name}`);
      return `Removed the condition ${action.name}.`;
    }
    case 'resolve_condition': {
      const resolvedOn = action.resolved_on ?? new Date().toISOString().slice(0, 10);
      const [row] = await db('medical_conditions')
        .where({ care_profile_id: profileId })
        .whereRaw('lower(name) = lower(?)', [action.name.trim()])
        .update({ status: 'resolved', resolved_on: resolvedOn, updated_at: db.fn.now() })
        .returning('name');
      if (!row) return `No condition called "${action.name}" was on the record.`;
      await audit(profileId, account.id, 'conditions', `resolved ${action.name}`);
      return `Marked ${row.name} as resolved on ${resolvedOn}.`;
    }
    case 'add_symptom': {
      const condition = await db('medical_conditions')
        .where({ care_profile_id: profileId })
        .whereRaw('lower(name) = lower(?)', [action.condition_name.trim()])
        .first();
      if (!condition) return `No condition called "${action.condition_name}" was on the record, so the symptom was not added.`;
      const catalogueId = await resolveSymptomCatalogueId(action.symptom_name.trim(), account.id).catch(() => null);
      const [symptom] = await db('condition_symptoms')
        .insert({
          condition_id: condition.id,
          symptom_catalogue_id: catalogueId,
          name: action.symptom_name.trim(),
          severity: action.severity,
        })
        .returning('*');
      await db('condition_symptom_readings').insert({
        symptom_id: symptom.id,
        severity: symptom.severity,
        recorded_at: symptom.noted_at,
      });
      await audit(profileId, account.id, 'conditions', `symptom ${action.symptom_name} on ${condition.name}`);
      return `Recorded the symptom ${action.symptom_name} (severity ${action.severity}/5) on ${condition.name}.`;
    }
    case 'update_symptom': {
      let query = db('condition_symptoms as s')
        .join('medical_conditions as mc', 's.condition_id', 'mc.id')
        .where('mc.care_profile_id', profileId)
        .whereRaw('lower(s.name) = lower(?)', [action.symptom_name.trim()])
        .whereNull('s.resolved_at');
      if (action.condition_name) {
        query = query.whereRaw('lower(mc.name) = lower(?)', [action.condition_name.trim()]);
      }
      const matches = await query.select('s.*', 'mc.name as condition_name');
      if (matches.length === 0) {
        return `No open symptom called "${action.symptom_name}" was found${action.condition_name ? ` on ${action.condition_name}` : ''}.`;
      }
      if (matches.length > 1) {
        return `"${action.symptom_name}" is tracked on more than one condition (${matches.map((m) => m.condition_name).join(', ')}). Say which condition you mean.`;
      }
      const symptom = matches[0];
      const patch: Record<string, unknown> = { updated_at: db.fn.now() };
      const said: string[] = [];
      if (action.severity != null && action.severity !== symptom.severity) {
        patch['severity'] = action.severity;
        // Every severity change is a dated reading in the symptom's course.
        await db('condition_symptom_readings').insert({ symptom_id: symptom.id, severity: action.severity });
        said.push(`severity ${symptom.severity} to ${action.severity}`);
      }
      if (action.resolved) {
        patch['resolved_at'] = db.fn.now();
        said.push('marked resolved');
      }
      if (said.length === 0) return `Nothing to change on the symptom ${symptom.name}.`;
      await db('condition_symptoms').where({ id: symptom.id }).update(patch);
      await audit(profileId, account.id, 'conditions', `symptom ${symptom.name} updated`);
      return `Updated ${symptom.name} on ${symptom.condition_name}: ${said.join(', ')}.`;
    }
    case 'add_treatment': {
      let conditionId: string | null = null;
      if (action.condition_name) {
        const condition = await db('medical_conditions')
          .where({ care_profile_id: profileId })
          .whereRaw('lower(name) = lower(?)', [action.condition_name.trim()])
          .first();
        if (!condition) return `No condition called "${action.condition_name}" was on the record, so the treatment was not added.`;
        conditionId = condition.id;
      }
      await db('treatments').insert({
        care_profile_id: profileId,
        medical_condition_id: conditionId,
        name: action.name.trim(),
        category: action.category,
        current_status: 'active',
      });
      await audit(profileId, account.id, 'treatments', `added treatment ${action.name}`);
      return `Added the treatment ${action.name}${action.condition_name ? ` for ${action.condition_name}` : ''}.`;
    }
    case 'raise_question': {
      await db('open_questions').insert({
        care_profile_id: profileId,
        title: action.title.trim(),
        body: action.body ?? null,
        status: 'open',
      });
      await audit(profileId, account.id, 'questions', `raised ${action.title}`);
      return `Raised the question "${action.title}" for the care circle.`;
    }
    case 'set_care_phase': {
      await db('care_profiles').where({ id: profileId }).update({ current_phase: action.phase, updated_at: db.fn.now() });
      await audit(profileId, account.id, 'care_profiles', `phase set to ${action.phase}`);
      return `Set the care phase to ${action.phase.replace(/_/g, ' ')}.`;
    }
    case 'add_provider': {
      const [provider] = await db('providers')
        .insert({
          account_id: account.id,
          provider_type: action.provider_type,
          name: action.name.trim(),
          organisation: action.organisation ?? null,
          phone: action.phone ?? null,
          email: action.email ?? null,
          booking_link: action.booking_link ?? null,
          directions_link: action.directions_link ?? null,
        })
        .returning('id');
      await db('care_profile_providers').insert({
        care_profile_id: profileId,
        provider_id: provider.id,
      });
      await audit(profileId, account.id, 'providers', `added provider ${action.name}`);
      return `Added ${action.name} to the providers list.`;
    }
    case 'update_provider': {
      const provider = await db('care_profile_providers as cpp')
        .join('providers as p', 'cpp.provider_id', 'p.id')
        .where({ 'cpp.care_profile_id': profileId })
        .whereRaw('lower(p.name) = lower(?)', [action.name.trim()])
        .select('p.id')
        .first();
      if (!provider) return `Could not find a provider called "${action.name}" on this profile.`;
      const updates: Record<string, unknown> = {};
      if (action.provider_type) updates.provider_type = action.provider_type;
      if (action.organisation !== undefined) updates.organisation = action.organisation;
      if (action.phone !== undefined) updates.phone = action.phone;
      if (action.email !== undefined) updates.email = action.email;
      if (action.booking_link !== undefined) updates.booking_link = action.booking_link;
      if (action.directions_link !== undefined) updates.directions_link = action.directions_link;
      if (Object.keys(updates).length === 0) return `No changes to make to ${action.name}.`;
      await db('providers').where({ id: provider.id }).update(updates);
      await audit(profileId, account.id, 'providers', `updated provider ${action.name}`);
      return `Updated ${action.name}'s details.`;
    }
    case 'update_care_plan': {
      // updated_by references a care circle member, not an account, so use
      // the acting member when there is one (owners act without a membership).
      const fields: Record<string, unknown> = { updated_at: db.fn.now(), updated_by: access.member?.id ?? null };
      if (action.dietary_requirements !== undefined) fields['dietary_requirements'] = action.dietary_requirements ?? [];
      if (action.mobility_aids !== undefined) fields['mobility_aids'] = action.mobility_aids ?? [];
      if (action.communication_needs !== undefined) fields['communication_needs'] = JSON.stringify(action.communication_needs ?? []);
      if (action.advance_care_directive !== undefined) fields['advance_care_directive'] = action.advance_care_directive ?? false;
      if (action.advance_care_directive_location !== undefined)
        fields['advance_care_directive_location'] = action.advance_care_directive_location;
      const existing = await db('care_plans').where({ care_profile_id: profileId }).first();
      if (existing) await db('care_plans').where({ care_profile_id: profileId }).update(fields);
      else await db('care_plans').insert({ care_profile_id: profileId, ...fields });
      await audit(profileId, account.id, 'care_plans', 'updated care plan');
      return `Updated the care plan.`;
    }
    case 'update_profile': {
      const fields: Record<string, unknown> = { updated_at: db.fn.now() };
      if (action.preferred_name !== undefined) fields['preferred_name'] = action.preferred_name;
      if (action.pronouns !== undefined) fields['pronouns'] = action.pronouns;
      if (action.primary_language !== undefined) fields['primary_language'] = action.primary_language;
      if (action.notes !== undefined) fields['notes'] = action.notes;
      if (action.date_of_birth !== undefined) fields['date_of_birth'] = action.date_of_birth || null;
      await db('care_profiles').where({ id: profileId }).update(fields);
      await audit(profileId, account.id, 'care_profiles', 'updated profile details');
      return `Updated the profile details.`;
    }
  }
}

export async function executeActions(
  actions: AssistantAction[],
  profileId: string,
  account: Account,
  access: CareAccess,
  timeZone?: string | null
): Promise<string[]> {
  if (actions.length === 0) return [];
  if (access.level === 'viewer') {
    return ['No changes were made: you have view-only access to this care profile.'];
  }
  const results: string[] = [];
  for (const action of actions) {
    try {
      const outcome = await executeOne(action, profileId, account, access, timeZone);
      results.push(...(Array.isArray(outcome) ? outcome : [outcome]));
    } catch (err) {
      console.warn('Assistant action failed:', (err as Error).message);
      results.push('One of the requested changes could not be saved. Please try it directly in the app.');
    }
  }
  return results;
}

interface ResolvedProfile {
  profileId: string;
  /** The profile's display name, for confirmation lines. */
  name: string;
  access: CareAccess;
}

interface NameCandidateRow extends NameCandidate {
  membership: CareCircleMember | null;
}

/** Every care profile the account can reach, with the name parts needed to match on. */
async function reachableProfiles(accountId: string): Promise<NameCandidateRow[]> {
  const [owned, shared] = await Promise.all([
    db<CareProfile>('care_profiles').where({ account_id: accountId, archived: false }),
    db('care_profiles')
      .join('care_circle_members', 'care_profiles.id', 'care_circle_members.care_profile_id')
      .where({
        'care_circle_members.account_id': accountId,
        'care_circle_members.invite_accepted': true,
        'care_profiles.archived': false,
      })
      .whereNot('care_profiles.account_id', accountId)
      .select(
        'care_profiles.id',
        'care_profiles.full_name',
        'care_profiles.preferred_name',
        'care_profiles.first_name',
        'care_profiles.middle_name',
        'care_profiles.last_name',
        db.raw('row_to_json(care_circle_members.*) as membership')
      ),
  ]);
  return [
    ...owned.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      preferred_name: p.preferred_name,
      first_name: p.first_name,
      middle_name: p.middle_name,
      last_name: p.last_name,
      membership: null,
    })),
    ...(shared as NameCandidateRow[]),
  ];
}

function accessFor(membership: CareCircleMember | null): CareAccess {
  return membership
    ? { level: membership.permission === 'viewer' ? 'viewer' : 'contributor', member: membership }
    : { level: 'owner', member: null };
}

/**
 * Find the one care profile the account can reach that the spoken name
 * identifies, using fuzzy matching so "Chris Rattray" resolves to "Mr
 * Christian Paul Rattray". Anything other than exactly one match returns
 * null: several matches means the assistant must ask which person, and no
 * match means it should say so rather than guess.
 */
export async function resolveProfileByName(name: string, accountId: string): Promise<ResolvedProfile | null> {
  if (!name.trim()) return null;
  const candidates = await reachableProfiles(accountId);
  const matchedIds = matchProfileNames(name, candidates);
  if (matchedIds.length !== 1) return null;
  const hit = candidates.find((c) => c.id === matchedIds[0])!;
  return { profileId: hit.id, name: hit.full_name, access: accessFor(hit.membership) };
}

/**
 * The names of every profile whose surname (or other name word) could be
 * what the user meant, for the assistant to offer as a short choice when a
 * name is ambiguous. Narrowed to the same fuzzy candidates, so it never
 * suggests an unrelated profile.
 */
export async function candidateProfileNames(name: string, accountId: string): Promise<string[]> {
  if (!name.trim()) return [];
  const candidates = await reachableProfiles(accountId);
  const matchedIds = new Set(matchProfileNames(name, candidates));
  return candidates.filter((c) => matchedIds.has(c.id)).map((c) => c.full_name);
}

/** Map one cross-profile entry onto the matching single-profile action. */
function toSingleProfileAction(action: CrossProfileAction, entry: CrossProfileAction['entries'][number]): AssistantAction {
  if (action.type === 'cross_profile_log') {
    const e = entry as z.infer<typeof crossProfileLogSchema>['entries'][number];
    return { type: 'log_event', entry_type: e.entry_type, title: e.title, body: e.body, occurred_at: e.occurred_at };
  }
  if (action.type === 'cross_profile_task') {
    const e = entry as z.infer<typeof crossProfileTaskSchema>['entries'][number];
    return { type: 'add_task', title: e.title, body: e.body, due_at: e.due_at, repeat: e.repeat };
  }
  if (action.type === 'cross_profile_medications') {
    const e = entry as z.infer<typeof crossProfileMedicationSchema>['entries'][number];
    return {
      type: 'record_medication',
      medication_name: e.medication_name,
      status: e.status,
      dose_given: e.dose_given,
      notes: e.notes,
      administered_at: e.administered_at,
    };
  }
  // profile_actions: the entry already carries a full single-profile action.
  return (entry as z.infer<typeof profileActionsSchema>['entries'][number]).action;
}

/**
 * Carry out cross-profile actions from the dashboard. Each entry names its
 * target profile; the name is resolved to a profile the account can reach,
 * write access is checked per profile, and the entry runs through the same
 * execution path as the single-profile assistant. A name that cannot be
 * resolved fails that entry only; the rest still run.
 */
export async function executeCrossProfileActions(
  actions: CrossProfileAction[],
  account: Account,
  timeZone?: string | null
): Promise<string[]> {
  if (actions.length === 0) return [];
  const results: string[] = [];
  const resolved = new Map<string, ResolvedProfile | null>();

  for (const action of actions) {
    for (const entry of action.entries) {
      const key = entry.profile_name.trim().toLowerCase();
      if (!resolved.has(key)) {
        resolved.set(key, await resolveProfileByName(entry.profile_name, account.id));
      }
      const target = resolved.get(key)!;
      if (!target) {
        // Say whether nothing matched or several did, and name the narrowed
        // candidates, so the assistant can ask rather than guess.
        const candidates = await candidateProfileNames(entry.profile_name, account.id);
        if (candidates.length > 1) {
          results.push(
            `${entry.profile_name}: nothing was recorded, because that could be more than one person: ${candidates.join(
              ' or '
            )}. Tell me which one.`
          );
        } else {
          results.push(
            `${entry.profile_name}: nothing was recorded, because no one in your care matches that name.`
          );
        }
        continue;
      }
      if (target.access.level === 'viewer') {
        results.push(`${target.name}: nothing was recorded, because you have view-only access to this care profile.`);
        continue;
      }
      try {
        const outcome = await executeOne(toSingleProfileAction(action, entry), target.profileId, account, target.access, timeZone);
        for (const line of Array.isArray(outcome) ? outcome : [outcome]) {
          results.push(`${target.name}: ${line}`);
        }
      } catch (err) {
        console.warn('Cross-profile assistant action failed:', (err as Error).message);
        results.push(`${target.name}: one of the requested changes could not be saved. Please try it directly in the app.`);
      }
    }
  }
  return results;
}
