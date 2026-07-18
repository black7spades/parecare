import type { MedicationRecord } from './care';

/** One recorded administration, as the medication chart consumes it. */
export interface ChartAdmin {
  id: string;
  medication_id: string;
  scheduled_for: string | null;
  administered_at: string;
  status: string;
  notes: string | null;
}

/** A scheduled slot for a day, and whether a dose has covered it. */
export interface SlotView {
  t: string;
  iso: string;
  past: boolean;
  covered: boolean;
  admin?: ChartAdmin;
}

const isGiven = (status: string): boolean => status === 'given' || status === 'self_administered';

/**
 * Match a day's doses to a medication's scheduled slots. A dose recorded
 * against a slot fills it; any remaining given dose that day (for example one
 * logged "as taken now", with no slot) then fills the earliest still-open past
 * slot, so a scheduled dose taken late still counts and the slot stops reading
 * as due. Whatever is left over is returned as an extra dose.
 */
export function coverMedDay(
  m: Pick<MedicationRecord, 'id' | 'schedule_times'>,
  dayStr: string,
  admins: ChartAdmin[],
  now: Date
): { slots: SlotView[]; extras: ChartAdmin[] } {
  const mine = admins.filter((a) => a.medication_id === m.id);
  const used = new Set<string>();
  const slots: SlotView[] = (m.schedule_times ?? []).map((t) => {
    const iso = new Date(`${dayStr}T${t}:00`).toISOString();
    const past = new Date(`${dayStr}T${t}:00`) <= now;
    const exact = mine.find(
      (a) => !used.has(a.id) && a.scheduled_for && new Date(a.scheduled_for).getTime() === new Date(iso).getTime()
    );
    if (exact) used.add(exact.id);
    return { t, iso, past, covered: !!exact, admin: exact };
  });
  const leftoverGiven = mine.filter((a) => !used.has(a.id) && isGiven(a.status));
  let gi = 0;
  for (const sv of slots) {
    if (!sv.covered && sv.past && gi < leftoverGiven.length) {
      sv.admin = leftoverGiven[gi];
      sv.covered = true;
      used.add(leftoverGiven[gi].id);
      gi += 1;
    }
  }
  return { slots, extras: mine.filter((a) => !used.has(a.id)) };
}

/** Whether any medication has a passed scheduled slot with no dose covering it. */
export function anyDoseDue(
  meds: Array<Pick<MedicationRecord, 'id' | 'schedule_times'>>,
  dayStr: string,
  admins: ChartAdmin[],
  now: Date
): boolean {
  return meds.some((m) => coverMedDay(m, dayStr, admins, now).slots.some((sv) => sv.past && !sv.covered));
}
