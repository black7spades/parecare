import { z } from 'zod';
import { db } from '../config/database';
import type { Account, CareAccess, CareCircleMember, CareProfile } from '../types';
import { parseZonedTime, formatInZone } from '../lib/timezone';
import { matchProfileNames, type NameCandidate } from '../lib/nameMatch';
import { drawDownOnHand, perDoseDrawdown } from './medicationSupply';
import { resolveConditionCatalogueId } from '../routes/conditionCatalogue';
import { resolveSubstanceCatalogueId, SUBSTANCE_CLASSES } from '../routes/substanceCatalogue';
import { SUBSTANCE_STATUSES, SUBSTANCE_ROUTES } from '../routes/substanceUse';
import { resolveSymptomCatalogueId } from '../routes/symptomCatalogue';
import { resolveNeurotypeAttributeCatalogueId, ATTRIBUTE_KINDS } from '../routes/neurotypeAttributeCatalogue';
import { linkAddressToProfile, syncProfileResidence, RESIDENCE_KIND } from './addresses';

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

const addSubstanceSchema = z.object({
  type: z.literal('add_substance'),
  substance: z.string().min(1).max(255),
  substance_class: z.enum(SUBSTANCE_CLASSES).optional().nullable(),
  status: z.enum(SUBSTANCE_STATUSES).optional().nullable(),
  route: z.enum(SUBSTANCE_ROUTES).optional().nullable(),
  quantity: z.string().max(100).optional().nullable(),
  quantity_unit: z.string().max(60).optional().nullable(),
  frequency: z.string().max(120).optional().nullable(),
  started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  quit_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

const updateSubstanceSchema = z.object({
  type: z.literal('update_substance'),
  substance: z.string().min(1).max(255),
  status: z.enum(SUBSTANCE_STATUSES).optional().nullable(),
  route: z.enum(SUBSTANCE_ROUTES).optional().nullable(),
  quantity: z.string().max(100).optional().nullable(),
  quantity_unit: z.string().max(60).optional().nullable(),
  frequency: z.string().max(120).optional().nullable(),
  quit_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

const removeSubstanceSchema = z.object({
  type: z.literal('remove_substance'),
  substance: z.string().min(1).max(255),
});

// Neurotype traits, needs and supports: what a neurodivergence actually looks
// like for this person. neurotype_name matches a recorded neurotype (e.g.
// "Autism"); kind is trait, need or support; label is the item itself.
const addNeurotypeAttributeSchema = z.object({
  type: z.literal('add_neurotype_attribute'),
  neurotype_name: z.string().min(1).max(255),
  kind: z.enum(ATTRIBUTE_KINDS),
  label: z.string().min(1).max(255),
  notes: z.string().max(2000).optional().nullable(),
});

const removeNeurotypeAttributeSchema = z.object({
  type: z.literal('remove_neurotype_attribute'),
  neurotype_name: z.string().min(1).max(255),
  kind: z.enum(ATTRIBUTE_KINDS),
  label: z.string().min(1).max(255),
});

// The acute illness tracker: record a symptom on a condition, or move an
// existing symptom's severity up or down as things progress.
const addSymptomSchema = z.object({
  type: z.literal('add_symptom'),
  condition_name: z.string().min(1).max(255),
  symptom_name: z.string().min(1).max(255),
  severity: z.number().int().min(1).max(10).default(5),
});

const updateSymptomSchema = z.object({
  type: z.literal('update_symptom'),
  symptom_name: z.string().min(1).max(255),
  condition_name: z.string().max(255).optional().nullable(),
  severity: z.number().int().min(1).max(10).optional().nullable(),
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

const linkProviderSchema = z.object({
  type: z.literal('link_provider'),
  // The name of an existing provider in the account's directory to attach to
  // this profile, the same way providers can be shared across people.
  name: z.string().min(1).max(255),
});

const linkAddressSchema = z.object({
  type: z.literal('link_address'),
  // Text to find an existing address in the account's book by: its label, its
  // one-line form, or a street line. Linking it records where they live.
  address: z.string().min(1).max(500),
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
  // A pet's owner, named as a person already in the account (a care profile).
  owner_name: z.string().max(255).optional().nullable(),
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
  addSubstanceSchema,
  updateSubstanceSchema,
  removeSubstanceSchema,
  addNeurotypeAttributeSchema,
  removeNeurotypeAttributeSchema,
  resolveConditionSchema,
  addSymptomSchema,
  updateSymptomSchema,
  addTreatmentSchema,
  raiseQuestionSchema,
  setCarePhaseSchema,
  addProviderSchema,
  updateProviderSchema,
  linkProviderSchema,
  linkAddressSchema,
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

export interface ExtractedActions<T = AssistantAction> {
  /** The reply with action blocks removed. */
  cleanedReply: string;
  actions: T[];
  parseErrors: string[];
}

// Any fenced code block: ``` or ~~~ (three or more), an optional info string,
// then a body, then a matching closing fence. Model-agnostic on purpose —
// the action is carried by the JSON inside, not by a single exact fence.
const FENCE_RE = /(`{3,}|~{3,})[ \t]*([^\n]*?)[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*\1[ \t]*(?=\r?\n|$)/g;

// An info string that explicitly marks a PareCare action, tolerating the ways
// models spell it: parecare-action, parecare_action, "parecare action".
const ACTION_INFO_RE = /parecare[\s_-]*action/i;

// Which generic (non-action-labelled) fences we are willing to read as
// actions when their JSON validates: an unlabelled block or a json block.
const GENERIC_INFO_RE = /^(json|json5|jsonc)?$/i;

/**
 * The index just past a balanced JSON value that starts at `start` (on a `{`
 * or `[`), respecting strings and escapes, or -1 if it never closes. Used to
 * lift a bare JSON action out of prose when a model forgets the code fence.
 */
function jsonSpanEnd(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/**
 * Lift bare, unfenced JSON actions out of a reply. Some models narrate the
 * confirmation and drop the code fence entirely; without this, the action
 * would silently not happen. Only spans that parse and fully validate as
 * actions are consumed, so ordinary prose and non-action JSON are untouched.
 */
function scanBareActions<T>(
  text: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  actions: T[],
): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    // A JSON action always begins with an object or array whose first key is
    // a quote; anything else is prose and is copied through untouched.
    if ((c === '{' || c === '[') && /["[{]/.test(text.slice(i + 1).trimStart()[0] ?? '')) {
      const end = jsonSpanEnd(text, i);
      if (end > i) {
        const candidate = text.slice(i, end);
        try {
          const parsed = JSON.parse(candidate);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          if (items.length > 0 && items.every((it) => schema.safeParse(it).success)) {
            for (const it of items) actions.push(schema.parse(it));
            i = end;
            continue;
          }
        } catch {
          // Not valid JSON: fall through and treat as ordinary text.
        }
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Validate one candidate against the schema, collecting the action or an error. */
function takeCandidate<T>(
  raw: unknown,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  actions: T[],
  parseErrors: string[],
): boolean {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    actions.push(parsed.data);
    return true;
  }
  const attempted =
    String((raw as { type?: unknown; action?: unknown })?.type ?? (raw as { action?: unknown })?.action ?? '')
      .replace(/_/g, ' ') || 'take an unrecognised action';
  const first = parsed.error.issues[0];
  const where = first?.path?.length ? ` (problem with "${first.path.join('.')}": ${first.message.toLowerCase()})` : '';
  console.warn('Assistant action validation failed:', attempted, parsed.error.format());
  parseErrors.push(
    `Pare tried to ${attempted} but that action could not be validated${where}, so it was not carried out. Try asking again in different words.`,
  );
  return false;
}

/**
 * Pull every action the assistant proposed out of a reply and validate it
 * against the given schema. Shared by the profile-level assistant and the
 * dashboard assistant, which understand different action sets.
 *
 * This is deliberately tolerant of how a model fences its action JSON, so
 * that swapping the AI provider or model does not silently stop actions from
 * being carried out. It accepts:
 *   - an explicit fence whose info string names a parecare action, in any of
 *     its spellings (the block is always consumed, and a bad one reports why);
 *   - a plain ```json or unlabelled fence whose entire contents validate as
 *     one action or an array of actions (consumed only when it validates, so
 *     ordinary example JSON is left in the reply untouched).
 * A single block may carry one action object or an array of them.
 */
export function extractActionBlocks<T>(reply: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): ExtractedActions<T> {
  const actions: T[] = [];
  const parseErrors: string[] = [];

  let out = '';
  let cursor = 0;
  for (const m of reply.matchAll(FENCE_RE)) {
    const whole = m[0];
    const info = (m[2] ?? '').trim();
    const body = (m[3] ?? '').trim();
    const start = m.index ?? 0;

    const isActionFence = ACTION_INFO_RE.test(info);
    const isGenericFence = GENERIC_INFO_RE.test(info);
    if (!isActionFence && !isGenericFence) {
      // A fenced block that is clearly something else (e.g. ```sql): leave it.
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      if (isActionFence) {
        out += reply.slice(cursor, start);
        cursor = start + whole.length;
        parseErrors.push('Pare suggested an action that could not be read, so it was not carried out.');
      }
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    if (isActionFence) {
      // An explicit action block is always consumed; each item is validated.
      out += reply.slice(cursor, start);
      cursor = start + whole.length;
      for (const c of candidates) takeCandidate(c, schema, actions, parseErrors);
    } else {
      // A generic block is only treated as actions when everything in it
      // validates; otherwise it is ordinary content and stays in the reply.
      const allValid = candidates.length > 0 && candidates.every((c) => schema.safeParse(c).success);
      if (allValid) {
        out += reply.slice(cursor, start);
        cursor = start + whole.length;
        for (const c of candidates) takeCandidate(c, schema, actions, parseErrors);
      }
    }
  }
  out += reply.slice(cursor);

  // Some models drop the code fence and leave the action JSON bare in prose.
  // Lift out any that fully validate, so a change of model cannot silently
  // stop actions from being carried out.
  let cleanedReply = scanBareActions(out, schema, actions);

  // A reply cut off mid-action (provider token limit) leaves an opening fence
  // with no closing one, so the loop above never matched it. Never show the
  // half-written JSON; say plainly that nothing was recorded for it.
  const dangling = cleanedReply.search(/(`{3,}|~{3,})[ \t]*[^\n]*parecare[\s_-]*action/i);
  if (dangling !== -1) {
    cleanedReply = cleanedReply.slice(0, dangling);
    parseErrors.push('The reply was cut off before this could be recorded, so nothing was saved. Please ask again.');
  }
  // A model sometimes fakes the app's own confirmation lines ("✔ Logged ...")
  // in its prose. Those are never the model's to write, and the real ones are
  // appended by the route after execution, so drop any the model invented.
  cleanedReply = cleanedReply.replace(/^[ \t]*[✔✓☑].*(?:\n|$)/gm, '');
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
const normDose = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function recordOneMedication(
  entry: MedicationEntry,
  profileId: string,
  account: Account,
  timeZone: string | null | undefined,
  // Medication rows already recorded this turn, so several doses of a drug
  // that exists at more than one strength land on the different strengths
  // instead of piling onto the first one.
  usedMedIds?: Set<string>
): Promise<string> {
  const matches = await db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where({ 'm.care_profile_id': profileId, 'm.active': true })
    .whereRaw('lower(c.name) = lower(?)', [entry.medication_name.trim()])
    .select('m.*', 'c.name as name', 'c.form as form')
    .orderBy([{ column: 'm.created_at', order: 'asc' }, { column: 'm.id', order: 'asc' }]);
  if (matches.length === 0) {
    return `Could not record the dose: no active medication called "${entry.medication_name}" is on the list.`;
  }
  // The same drug can be listed at two strengths (e.g. Escitalopram 20mg and
  // 10mg). Prefer a row whose dose matches what was said; otherwise take the
  // next one not already used this turn, so "record all" hits each strength.
  let med = matches[0];
  if (matches.length > 1) {
    const want = normDose(entry.dose_given);
    const byDose = want
      ? matches.filter((m) => {
          const sig = normDose(m.dose) || normDose(`${m.dose_amount ?? ''}${m.dose_unit ?? ''}`);
          return sig && (sig === want || sig.includes(want) || want.includes(sig));
        })
      : [];
    const pool = byDose.length > 0 ? byDose : matches;
    med = pool.find((m) => !usedMedIds?.has(m.id)) ?? pool[0];
  }
  usedMedIds?.add(med.id);
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
  timeZone: string | null | undefined,
  // Shared across a turn so repeated doses of a multi-strength drug spread
  // across its rows rather than all landing on the first.
  usedMedIds?: Set<string>
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
      return recordOneMedication(action, profileId, account, timeZone, usedMedIds ?? new Set());
    }
    case 'record_medications': {
      // One dose failing to record must not stop the rest of the batch. A
      // shared set spreads repeated doses of a multi-strength drug across its
      // rows within this batch.
      const used = usedMedIds ?? new Set<string>();
      const results: string[] = [];
      for (const entry of action.entries) {
        try {
          results.push(await recordOneMedication(entry, profileId, account, timeZone, used));
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
    case 'add_substance': {
      const name = action.substance.trim();
      const catalogueId = await resolveSubstanceCatalogueId(name, action.substance_class, account.id).catch(() => null);
      if (!catalogueId) return `Could not record ${name}.`;
      try {
        await db('substance_use').insert({
          care_profile_id: profileId,
          substance_catalogue_id: catalogueId,
          status: action.status ?? 'active',
          route: action.route ?? null,
          quantity: action.quantity ?? null,
          quantity_unit: action.quantity_unit ?? null,
          frequency: action.frequency ?? null,
          started_on: action.started_on ?? null,
          quit_on: action.quit_on ?? null,
          notes: action.notes ?? null,
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return `${name} is already recorded for this person. Use update_substance to change it.`;
        throw err;
      }
      await audit(profileId, account.id, 'substance_use', `added substance ${name}`);
      return `Recorded ${name} under substance use.`;
    }
    case 'update_substance': {
      const record = await db('substance_use as su')
        .join('substance_catalogue as sc', 'su.substance_catalogue_id', 'sc.id')
        .where('su.care_profile_id', profileId)
        .whereRaw('lower(sc.name) = lower(?)', [action.substance.trim()])
        .select('su.id', 'sc.name as name')
        .first();
      if (!record) return `No substance called "${action.substance}" is recorded for this person.`;
      const updates: Record<string, unknown> = {};
      if (action.status !== undefined) updates['status'] = action.status;
      if (action.route !== undefined) updates['route'] = action.route;
      if (action.quantity !== undefined) updates['quantity'] = action.quantity;
      if (action.quantity_unit !== undefined) updates['quantity_unit'] = action.quantity_unit;
      if (action.frequency !== undefined) updates['frequency'] = action.frequency;
      if (action.quit_on !== undefined) updates['quit_on'] = action.quit_on;
      if (action.notes !== undefined) updates['notes'] = action.notes;
      if (Object.keys(updates).length === 0) return `No changes to make to ${record.name}.`;
      await db('substance_use').where({ id: record.id }).update({ ...updates, updated_at: db.fn.now() });
      await audit(profileId, account.id, 'substance_use', `updated substance ${record.name}`);
      return `Updated ${record.name}.`;
    }
    case 'remove_substance': {
      const record = await db('substance_use as su')
        .join('substance_catalogue as sc', 'su.substance_catalogue_id', 'sc.id')
        .where('su.care_profile_id', profileId)
        .whereRaw('lower(sc.name) = lower(?)', [action.substance.trim()])
        .select('su.id', 'sc.name as name')
        .first();
      if (!record) return `No substance called "${action.substance}" is recorded for this person.`;
      await db('substance_use').where({ id: record.id }).del();
      await audit(profileId, account.id, 'substance_use', `removed substance ${record.name}`);
      return `Removed ${record.name} from substance use.`;
    }
    case 'add_neurotype_attribute': {
      const condition = await db('medical_conditions')
        .where({ care_profile_id: profileId, category: 'neurotype' })
        .whereRaw('lower(name) = lower(?)', [action.neurotype_name.trim()])
        .first();
      if (!condition) return `No neurotype called "${action.neurotype_name}" is on the record, so the ${action.kind} was not added.`;
      const catalogueId = await resolveNeurotypeAttributeCatalogueId(action.kind, action.label.trim(), {
        neurotype: condition.neurotype ?? null,
        accountId: account.id,
      }).catch(() => null);
      if (!catalogueId) return `Could not record that ${action.kind}.`;
      try {
        await db('neurotype_attributes').insert({
          condition_id: condition.id,
          catalogue_id: catalogueId,
          notes: action.notes ?? null,
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return `"${action.label}" is already recorded as a ${action.kind} for ${condition.name}.`;
        throw err;
      }
      await audit(profileId, account.id, 'conditions', `added ${action.kind} "${action.label}" to ${condition.name}`);
      return `Recorded "${action.label}" as a ${action.kind} for ${condition.name}.`;
    }
    case 'remove_neurotype_attribute': {
      const record = await db('neurotype_attributes as na')
        .join('neurotype_attribute_catalogue as nac', 'na.catalogue_id', 'nac.id')
        .join('medical_conditions as mc', 'mc.id', 'na.condition_id')
        .where('mc.care_profile_id', profileId)
        .where('nac.kind', action.kind)
        .whereRaw('lower(mc.name) = lower(?)', [action.neurotype_name.trim()])
        .whereRaw('lower(nac.label) = lower(?)', [action.label.trim()])
        .select('na.id', 'nac.label as label', 'mc.name as condition_name')
        .first();
      if (!record) return `No ${action.kind} called "${action.label}" is recorded for ${action.neurotype_name}.`;
      await db('neurotype_attributes').where({ id: record.id }).del();
      await audit(profileId, account.id, 'conditions', `removed ${action.kind} "${record.label}" from ${record.condition_name}`);
      return `Removed "${record.label}" from ${record.condition_name}.`;
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
      return `Recorded the symptom ${action.symptom_name} (severity ${action.severity}/10) on ${condition.name}.`;
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
    case 'link_provider': {
      const profile = await db('care_profiles').where({ id: profileId }).select('account_id').first();
      if (!profile) return `Could not find this profile.`;
      const provider = await db('providers')
        .where({ account_id: profile.account_id })
        .whereRaw('lower(name) = lower(?)', [action.name.trim()])
        .select('id', 'name')
        .first();
      if (!provider) return `Could not find a provider called "${action.name}" in the directory. Add them first, then link.`;
      const already = await db('care_profile_providers').where({ care_profile_id: profileId, provider_id: provider.id }).first();
      if (already) return `${provider.name} is already linked to this profile.`;
      await db('care_profile_providers').insert({ care_profile_id: profileId, provider_id: provider.id });
      await audit(profileId, account.id, 'providers', `linked provider ${provider.name}`);
      return `Linked ${provider.name} to this profile.`;
    }
    case 'link_address': {
      const profile = await db('care_profiles').where({ id: profileId }).select('account_id').first();
      if (!profile) return `Could not find this profile.`;
      const needle = action.address.trim().toLowerCase();
      const candidates = await db('addresses').where({ account_id: profile.account_id });
      const field = (row: Record<string, unknown>, k: string) => String(row[k] ?? '').toLowerCase();
      const match =
        candidates.find((a) => field(a, 'formatted') === needle || field(a, 'label') === needle) ??
        candidates.find(
          (a) =>
            (field(a, 'formatted') && field(a, 'formatted').includes(needle)) ||
            (field(a, 'label') && field(a, 'label').includes(needle)) ||
            (field(a, 'address_line1') && field(a, 'address_line1').includes(needle))
        );
      if (!match) return `Could not find an address matching "${action.address}" in the directory. Add it first, then link.`;
      const already = await db('care_profile_addresses').where({ care_profile_id: profileId, address_id: match.id }).first();
      await linkAddressToProfile(profileId, match.id, RESIDENCE_KIND);
      await syncProfileResidence(profileId, match);
      await audit(profileId, account.id, 'addresses', `linked address ${match.formatted ?? match.label ?? ''}`);
      const where = match.formatted ?? match.label ?? 'the address';
      return already ? `${where} is now set as where they live.` : `Linked ${where} as where they live.`;
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
      let ownerNote = '';
      if (action.owner_name !== undefined) {
        const target = await db('care_profiles').where({ id: profileId }).select('account_id', 'kind').first();
        if (!action.owner_name) {
          fields['owner_profile_id'] = null;
          ownerNote = ' Cleared the owner.';
        } else {
          const owner = await db('care_profiles')
            .where({ account_id: target?.account_id, kind: 'person', archived: false })
            .whereRaw('lower(full_name) = lower(?)', [action.owner_name.trim()])
            .select('id', 'full_name')
            .first();
          if (!owner) return `Could not find a person called "${action.owner_name}" to set as the owner. Add them to People first.`;
          if (owner.id === profileId) return `A profile cannot be its own owner.`;
          fields['owner_profile_id'] = owner.id;
          ownerNote = ` Set the owner to ${owner.full_name}.`;
        }
      }
      await db('care_profiles').where({ id: profileId }).update(fields);
      await audit(profileId, account.id, 'care_profiles', 'updated profile details');
      return `Updated the profile details.${ownerNote}`;
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
  // One set for the whole turn, so several "Escitalopram" doses across
  // separate actions still spread across its strengths.
  const usedMedIds = new Set<string>();
  for (const action of actions) {
    try {
      const outcome = await executeOne(action, profileId, account, access, timeZone, usedMedIds);
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
  // Per-profile record of medication rows used this turn, so repeated doses of
  // a multi-strength drug spread across its strengths.
  const usedByProfile = new Map<string, Set<string>>();

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
        let used = usedByProfile.get(target.profileId);
        if (!used) { used = new Set<string>(); usedByProfile.set(target.profileId, used); }
        const outcome = await executeOne(toSingleProfileAction(action, entry), target.profileId, account, target.access, timeZone, used);
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
