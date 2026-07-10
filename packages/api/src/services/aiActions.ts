import { z } from 'zod';
import { db } from '../config/database';
import type { Account, CareAccess, CareCircleMember, CareProfile } from '../types';

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

export const actionSchema = z.discriminatedUnion('type', [
  logEventSchema,
  recordMedicationSchema,
  recordMedicationBatchSchema,
  addTaskSchema,
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

export const crossProfileActionSchema = z.discriminatedUnion('type', [
  crossProfileLogSchema,
  crossProfileTaskSchema,
  crossProfileMedicationSchema,
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
      const parsed = schema.safeParse(JSON.parse(json));
      if (parsed.success) actions.push(parsed.data);
      else parseErrors.push('The assistant suggested an action that was not valid, so it was not carried out.');
    } catch {
      parseErrors.push('The assistant suggested an action that could not be read, so it was not carried out.');
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

function parseWhen(value: string | null | undefined): Date {
  if (!value) return new Date();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date();
  // Never record anything in the future; clamp to now (same rule as the MAR).
  return d.getTime() > Date.now() + 60_000 ? new Date() : d;
}

async function audit(profileId: string, accountId: string, entityType: string, summary: string): Promise<void> {
  await db('audit_log')
    .insert({ care_profile_id: profileId, actor_account_id: accountId, action: 'created', entity_type: entityType, summary: summary.slice(0, 255) })
    .catch(() => {});
}

const GIVEN = new Set(['given', 'self_administered']);

function doseAmount(dose: string | null | undefined): number {
  const n = parseFloat(String(dose ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

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
async function recordOneMedication(entry: MedicationEntry, profileId: string, account: Account): Promise<string> {
  const med = await db('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .where({ 'm.care_profile_id': profileId, 'm.active': true })
    .whereRaw('lower(c.name) = lower(?)', [entry.medication_name.trim()])
    .select('m.*', 'c.name as name')
    .first();
  if (!med) {
    return `Could not record the dose: no active medication called "${entry.medication_name}" is on the list.`;
  }
  if (!GIVEN.has(entry.status) && !entry.notes?.trim()) {
    return `Could not record the ${entry.status} dose of ${med.name}: a note explaining why is required.`;
  }
  const administeredAt = parseWhen(entry.administered_at);
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
    const amount = doseAmount(entry.dose_given ?? med.dose);
    if (amount > 0) {
      await db('medications')
        .where({ id: med.id })
        .whereNotNull('supply_remaining')
        .update({ supply_remaining: db.raw('GREATEST(0, supply_remaining - ?)', [amount]) });
    }
  }
  await audit(profileId, account.id, 'medications', `${med.name} ${entry.status}`);
  return `Recorded ${med.name}${entry.dose_given ?? med.dose ? ` ${entry.dose_given ?? med.dose}` : ''} as ${entry.status.replace(/_/g, ' ')}.`;
}

async function executeOne(
  action: AssistantAction,
  profileId: string,
  account: Account,
  access: CareAccess
): Promise<string | string[]> {
  switch (action.type) {
    case 'log_event': {
      const occurredAt = parseWhen(action.occurred_at);
      await db('care_log_entries').insert({
        care_profile_id: profileId,
        author_member_id: access.member?.id ?? null,
        entry_type: action.entry_type,
        title: action.title ?? null,
        body: action.body,
        occurred_at: occurredAt,
      });
      await audit(profileId, account.id, 'log', action.title ?? action.body);
      return `Logged a ${action.entry_type.replace(/_/g, ' ')} entry${action.title ? `: ${action.title}` : ''}.`;
    }
    case 'record_medication': {
      return recordOneMedication(action, profileId, account);
    }
    case 'record_medications': {
      // One dose failing to record must not stop the rest of the batch.
      const results: string[] = [];
      for (const entry of action.entries) {
        try {
          results.push(await recordOneMedication(entry, profileId, account));
        } catch (err) {
          console.warn('Assistant batch medication entry failed:', (err as Error).message);
          results.push(`Could not record ${entry.medication_name}. Please record it directly in the app.`);
        }
      }
      return results;
    }
    case 'add_task': {
      const due = new Date(action.due_at);
      if (Number.isNaN(due.getTime())) {
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
      return `Added the task "${action.title}" due ${due.toISOString().replace('T', ' ').slice(0, 16)} UTC.`;
    }
  }
}

export async function executeActions(
  actions: AssistantAction[],
  profileId: string,
  account: Account,
  access: CareAccess
): Promise<string[]> {
  if (actions.length === 0) return [];
  if (access.level === 'viewer') {
    return ['No changes were made: you have view-only access to this care profile.'];
  }
  const results: string[] = [];
  for (const action of actions) {
    try {
      const outcome = await executeOne(action, profileId, account, access);
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

/**
 * Find the one care profile the account can reach whose name matches what
 * the user called it. Matches case-insensitively against the full name
 * first, then the preferred name, then the first name. Anything other than
 * exactly one match returns null: guessing between two Kiyomis would put
 * care records on the wrong person.
 */
export async function resolveProfileByName(name: string, accountId: string): Promise<ResolvedProfile | null> {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;

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
        db.raw('row_to_json(care_circle_members.*) as membership')
      ),
  ]);

  interface Candidate {
    id: string;
    full_name: string;
    preferred_name: string | null;
    first_name: string | null;
    membership: CareCircleMember | null;
  }
  const candidates: Candidate[] = [
    ...owned.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      preferred_name: p.preferred_name,
      first_name: p.first_name,
      membership: null,
    })),
    ...(shared as Array<Candidate & { membership: CareCircleMember }>),
  ];

  const matchField = (field: 'full_name' | 'preferred_name' | 'first_name') =>
    candidates.filter((c) => (c[field] ?? '').trim().toLowerCase() === needle);

  const matches = [matchField('full_name'), matchField('preferred_name'), matchField('first_name')].find(
    (m) => m.length > 0
  );
  if (!matches || matches.length !== 1) return null;

  const hit = matches[0]!;
  const access: CareAccess = hit.membership
    ? { level: hit.membership.permission === 'viewer' ? 'viewer' : 'contributor', member: hit.membership }
    : { level: 'owner', member: null };
  return { profileId: hit.id, name: hit.full_name, access };
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

/**
 * Carry out cross-profile actions from the dashboard. Each entry names its
 * target profile; the name is resolved to a profile the account can reach,
 * write access is checked per profile, and the entry runs through the same
 * execution path as the single-profile assistant. A name that cannot be
 * resolved fails that entry only; the rest still run.
 */
export async function executeCrossProfileActions(actions: CrossProfileAction[], account: Account): Promise<string[]> {
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
        results.push(
          `${entry.profile_name}: nothing was recorded, because no single profile in your care matches that name.`
        );
        continue;
      }
      if (target.access.level === 'viewer') {
        results.push(`${target.name}: nothing was recorded, because you have view-only access to this care profile.`);
        continue;
      }
      try {
        const outcome = await executeOne(toSingleProfileAction(action, entry), target.profileId, account, target.access);
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
