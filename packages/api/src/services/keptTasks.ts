import type { Knex } from 'knex';
import { createTask, ownerZone, resolveDue } from './tasks';
import { nextStepTypeIdByKey } from './nextStepTypes';
import { accountIdForProfile } from './documentCategories';

type Conn = Knex | Knex.Transaction;

/**
 * A task a record makes and keeps in step with itself: the GP follow-up a
 * discharge makes, the return-by task for loaned equipment, the cooling-off
 * date of a move into care, a therapist's report before a plan review. When
 * the record's date moves, the task's due date moves with it; when the date
 * is cleared, the task goes, unless someone already ticked it off.
 */
export interface KeptTask {
  title: string;
  /** The day it is due, any time that day. */
  due_on: string;
  body?: string | null;
  provider_id?: string | null;
  /** A built-in next step kind, by its key. */
  kind_key?: string | null;
  /** Columns that tie the task to its record. */
  links?: { asset_id?: string | null; funding_plan_id?: string | null };
}

export async function keepTask(
  conn: Conn,
  opts: { profileId: string; actorId: string | null; taskId: string | null; want: KeptTask | null; timeZone?: string | null }
): Promise<string | null> {
  const { profileId, want } = opts;
  const existing = opts.taskId
    ? ((await conn('reminders').where({ id: opts.taskId, care_profile_id: profileId }).first('id', 'completed')) as
        | { id: string; completed: boolean }
        | undefined)
    : undefined;
  if (!want) {
    if (existing && !existing.completed) await conn('reminders').where({ id: existing.id }).delete();
    return existing?.completed ? existing.id : null;
  }
  // Ticked off already: the record's change does not bring it back.
  if (existing?.completed) return existing.id;
  const accountId = (await accountIdForProfile(profileId, conn))!;
  const typeId = want.kind_key ? await nextStepTypeIdByKey(accountId, want.kind_key, conn) : null;
  if (existing) {
    const due = resolveDue({ due_on: want.due_on }, await ownerZone(conn, profileId, opts.timeZone))!;
    await conn('reminders')
      .where({ id: existing.id })
      .update({
        title: want.title.slice(0, 255),
        next_due_at: due.next_due_at,
        all_day: true,
        last_notified_at: null,
        ...(want.provider_id !== undefined ? { provider_id: want.provider_id } : {}),
        ...(typeId ? { next_step_type_id: typeId } : {}),
        ...(want.links ?? {}),
      });
    return existing.id;
  }
  const made = await createTask(conn, {
    profileId,
    actorId: opts.actorId,
    timeZone: opts.timeZone,
    input: {
      title: want.title,
      body: want.body ?? null,
      due_on: want.due_on,
      provider_id: want.provider_id ?? null,
      next_step_type_id: typeId,
      no_infer: true,
      no_join: true,
    },
  });
  if (want.links && Object.keys(want.links).length) await conn('reminders').where({ id: made.reminder.id }).update(want.links);
  return made.reminder.id;
}
