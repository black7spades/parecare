import { z } from 'zod';
import { db } from '../config/database';
import type { Account, CareAccess } from '../types';

/**
 * Actions the assistant can carry out on the user's behalf: logging a care
 * event, recording a medication dose, or adding a task. The model emits a
 * fenced ```parecare-action``` block containing one JSON action; the server
 * validates it against these schemas and executes it with the SAME
 * permission rules as the equivalent API endpoint (viewers cannot write).
 * Every action lands in the audit log like any other change.
 */

const LOG_ENTRY_TYPES = [
  'visit',
  'medication',
  'medical_appointment',
  'phone_call',
  'decision_made',
  'concern_raised',
  'observation',
  'handover',
] as const;

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
  status: z.enum(['given', 'refused', 'omitted', 'held', 'self_administered']).default('given'),
  dose_given: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
  administered_at: z.string().optional().nullable(),
});

const addTaskSchema = z.object({
  type: z.literal('add_task'),
  title: z.string().min(1).max(255),
  body: z.string().optional().nullable(),
  due_at: z.string(),
  repeat: z.enum(['once', 'daily', 'weekly', 'monthly']).default('once'),
});

export const actionSchema = z.discriminatedUnion('type', [logEventSchema, recordMedicationSchema, addTaskSchema]);
export type AssistantAction = z.infer<typeof actionSchema>;

const ACTION_BLOCK_RE = /```parecare-action\s*\n([\s\S]*?)```/g;

export interface ExtractedActions {
  /** The reply with action blocks removed. */
  cleanedReply: string;
  actions: AssistantAction[];
  parseErrors: string[];
}

export function extractActions(reply: string): ExtractedActions {
  const actions: AssistantAction[] = [];
  const parseErrors: string[] = [];
  const cleanedReply = reply
    .replace(ACTION_BLOCK_RE, (_whole, json: string) => {
      try {
        const parsed = actionSchema.safeParse(JSON.parse(json));
        if (parsed.success) actions.push(parsed.data);
        else parseErrors.push('The assistant suggested an action that was not valid, so it was not carried out.');
      } catch {
        parseErrors.push('The assistant suggested an action that could not be read, so it was not carried out.');
      }
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { cleanedReply, actions, parseErrors };
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

async function executeOne(
  action: AssistantAction,
  profileId: string,
  account: Account,
  access: CareAccess
): Promise<string> {
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
      const med = await db('medications as m')
        .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
        .where({ 'm.care_profile_id': profileId, 'm.active': true })
        .whereRaw('lower(c.name) = lower(?)', [action.medication_name.trim()])
        .select('m.*', 'c.name as name')
        .first();
      if (!med) {
        return `Could not record the dose: no active medication called "${action.medication_name}" is on the list.`;
      }
      if (!GIVEN.has(action.status) && !action.notes?.trim()) {
        return `Could not record the ${action.status} dose of ${med.name}: a note explaining why is required.`;
      }
      const administeredAt = parseWhen(action.administered_at);
      await db('medication_administrations').insert({
        medication_id: med.id,
        care_profile_id: profileId,
        administered_at: administeredAt,
        administered_by_account_id: account.id,
        administered_by_name: account.display_name,
        status: action.status,
        dose_given: action.dose_given ?? med.dose ?? null,
        route_given: med.route ?? null,
        notes: [action.notes?.trim(), 'Recorded through the PareCare assistant.'].filter(Boolean).join(' '),
        right_patient: true,
        right_medication: true,
        right_documentation: true,
        // Dose, route and time must be verified by a person at the point of
        // care; a conversational log cannot confirm them.
        right_dose: false,
        right_route: false,
        right_time: false,
      });
      if (GIVEN.has(action.status)) {
        const amount = doseAmount(action.dose_given ?? med.dose);
        if (amount > 0) {
          await db('medications')
            .where({ id: med.id })
            .whereNotNull('supply_remaining')
            .update({ supply_remaining: db.raw('GREATEST(0, supply_remaining - ?)', [amount]) });
        }
      }
      await audit(profileId, account.id, 'medications', `${med.name} ${action.status}`);
      return `Recorded ${med.name}${action.dose_given ?? med.dose ? ` ${action.dose_given ?? med.dose}` : ''} as ${action.status.replace(/_/g, ' ')}.`;
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
      results.push(await executeOne(action, profileId, account, access));
    } catch (err) {
      console.warn('Assistant action failed:', (err as Error).message);
      results.push('One of the requested changes could not be saved. Please try it directly in the app.');
    }
  }
  return results;
}
