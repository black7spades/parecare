import { db } from '../config/database';
import { getMarRetentionMonths } from '../config/settings';

/** The cutoff date before which administrations are archived. */
export function retentionCutoff(months = getMarRetentionMonths()): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

/**
 * Move medication administrations older than the retention horizon out of the
 * live table into the archive. Nothing is deleted — archived rows stay
 * queryable. Runs in a transaction and in bounded batches. Returns how many
 * rows were archived.
 */
export async function archiveOldAdministrations(cutoff: Date = retentionCutoff(), batch = 5000): Promise<number> {
  return db.transaction(async (trx) => {
    const rows = await trx('medication_administrations as a')
      .join('medications as m', 'a.medication_id', 'm.id')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .where('a.administered_at', '<', cutoff)
      .select('a.*', 'c.name as medication_name')
      .limit(batch);
    if (rows.length === 0) return 0;

    await trx('medication_administration_archive').insert(
      rows.map((r) => ({
        id: r.id,
        medication_id: r.medication_id,
        care_profile_id: r.care_profile_id,
        medication_name: r.medication_name,
        scheduled_for: r.scheduled_for,
        administered_at: r.administered_at,
        administered_by_account_id: r.administered_by_account_id,
        administered_by_name: r.administered_by_name,
        status: r.status,
        dose_given: r.dose_given,
        route_given: r.route_given,
        notes: r.notes,
        right_patient: r.right_patient,
        right_medication: r.right_medication,
        right_dose: r.right_dose,
        right_route: r.right_route,
        right_time: r.right_time,
        right_documentation: r.right_documentation,
        created_at: r.created_at,
      }))
    );
    await trx('medication_administrations').whereIn('id', rows.map((r) => r.id)).del();
    return rows.length;
  });
}

let timer: NodeJS.Timeout | null = null;
const DAY_MS = 24 * 3600 * 1000;

function scheduleNext(): void {
  timer = setTimeout(() => {
    archiveOldAdministrations()
      .then((n) => { if (n) console.log(`Archived ${n} old medication administration(s).`); })
      .catch((err) => console.error('MAR archive error:', err))
      .finally(scheduleNext);
  }, DAY_MS);
  timer.unref();
}

/** Sweep once shortly after boot, then daily. */
export function startMarArchiveScheduler(): void {
  const first = setTimeout(() => {
    archiveOldAdministrations()
      .then((n) => { if (n) console.log(`Archived ${n} old medication administration(s).`); })
      .catch((err) => console.error('MAR archive error:', err))
      .finally(scheduleNext);
  }, 60 * 1000);
  first.unref();
}
