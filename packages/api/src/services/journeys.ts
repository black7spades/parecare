import type { Knex } from 'knex';
import { db } from '../config/database';

/**
 * Care journey instances: enrolment copies a template into per-person
 * rows, phase progression locks history exactly like the legacy phase
 * pipeline, and journeys that mirror the legacy ageing enum keep
 * care_profiles.current_phase and care_phase_history in sync so older
 * clients keep working.
 */

export interface JourneyPhaseRow {
  id: string;
  care_journey_id: string;
  template_phase_id: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  legacy_phase: string | null;
  entered_at: Date | null;
  locked_at: Date | null;
  locked_by: string | null;
}

export interface JourneyRow {
  id: string;
  care_profile_id: string;
  template_id: string | null;
  name: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  handed_over_to_journey_id: string | null;
}

export function phaseState(phase: Pick<JourneyPhaseRow, 'entered_at' | 'locked_at'>): 'upcoming' | 'current' | 'locked' {
  if (phase.locked_at) return 'locked';
  if (phase.entered_at) return 'current';
  return 'upcoming';
}

/**
 * Enrol a care profile in a journey template: copy the phases and their
 * task seeds, open the starting phase, lock everything before it.
 */
export async function enrolProfileInTemplate(
  trx: Knex.Transaction,
  opts: {
    careProfileId: string;
    templateId: string;
    createdByAccountId: string | null;
    /** Phase sort_order to open as current. Earlier phases lock. */
    startAtSortOrder?: number;
  }
): Promise<JourneyRow> {
  const template = await trx('journey_templates').where({ id: opts.templateId }).first();
  if (!template) throw new Error('Journey template not found');
  const phases = await trx('journey_template_phases')
    .where({ template_id: opts.templateId })
    .orderBy('sort_order', 'asc');
  if (phases.length === 0) throw new Error('Journey template has no phases');

  const startAt = Math.min(Math.max(opts.startAtSortOrder ?? 0, 0), phases.length - 1);
  const now = new Date();

  const [journey] = await trx('care_journeys')
    .insert({
      care_profile_id: opts.careProfileId,
      template_id: opts.templateId,
      name: template.name,
      status: 'active',
      created_by_account_id: opts.createdByAccountId,
    })
    .returning('*');

  for (const [i, tp] of phases.entries()) {
    const [journeyPhase] = await trx('care_journey_phases')
      .insert({
        care_journey_id: journey.id,
        template_phase_id: tp.id,
        name: tp.name,
        description: tp.description,
        sort_order: i,
        legacy_phase: tp.legacy_phase,
        entered_at: i <= startAt ? now : null,
        locked_at: i < startAt ? now : null,
        locked_by: i < startAt ? opts.createdByAccountId : null,
      })
      .returning('id');

    const tasks = await trx('journey_template_tasks')
      .where({ template_phase_id: tp.id })
      .orderBy('sort_order', 'asc');
    if (tasks.length > 0) {
      await trx('checklist_items').insert(
        tasks.map((task) => ({
          care_profile_id: opts.careProfileId,
          care_journey_phase_id: journeyPhase.id,
          phase: tp.legacy_phase,
          title: task.title,
          description: task.description,
          is_milestone: task.is_milestone,
          sort_order: task.sort_order,
        }))
      );
    }
  }

  await syncLegacyPhaseFromJourney(trx, journey.id);
  return journey;
}

/**
 * Move a journey to a target phase. Forward moves lock every earlier
 * open phase; backward moves are reserved for super admins correcting
 * records and reopen the target.
 */
export async function setCurrentJourneyPhase(
  trx: Knex.Transaction,
  opts: {
    journey: JourneyRow;
    targetPhaseId: string;
    actorAccountId: string;
    actorIsSuperAdmin: boolean;
  }
): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'PHASE_LOCKED' }> {
  const phases: JourneyPhaseRow[] = await trx('care_journey_phases')
    .where({ care_journey_id: opts.journey.id })
    .orderBy('sort_order', 'asc');
  const target = phases.find((p) => p.id === opts.targetPhaseId);
  if (!target) return { ok: false, code: 'NOT_FOUND' };

  const currentIndex = phases.findIndex((p) => phaseState(p) === 'current');
  const targetIndex = phases.findIndex((p) => p.id === target.id);
  const now = new Date();

  if (targetIndex === currentIndex) return { ok: true };
  if (currentIndex >= 0 && targetIndex < currentIndex && !opts.actorIsSuperAdmin) {
    return { ok: false, code: 'PHASE_LOCKED' };
  }

  if (currentIndex >= 0 && targetIndex < currentIndex) {
    // Super admin reopening an earlier phase: unlock it and everything
    // between it and the phase that was current; the old current phase
    // returns to upcoming? No: it stays entered but the reopened phase
    // becomes the single current one, so later phases go back to upcoming.
    for (const [i, p] of phases.entries()) {
      if (i < targetIndex) continue;
      if (i === targetIndex) {
        await trx('care_journey_phases')
          .where({ id: p.id })
          .update({ entered_at: p.entered_at ?? now, locked_at: null, locked_by: null });
      } else if (p.entered_at && !p.locked_at) {
        // The previously current phase steps back to upcoming.
        await trx('care_journey_phases').where({ id: p.id }).update({ entered_at: null });
      } else if (p.locked_at) {
        await trx('care_journey_phases').where({ id: p.id }).update({ entered_at: null, locked_at: null, locked_by: null });
      }
    }
  } else {
    // Forward: lock everything before the target, open the target.
    for (const [i, p] of phases.entries()) {
      if (i < targetIndex) {
        await trx('care_journey_phases')
          .where({ id: p.id })
          .update({
            entered_at: p.entered_at ?? now,
            locked_at: p.locked_at ?? now,
            locked_by: p.locked_by ?? opts.actorAccountId,
          });
      } else if (i === targetIndex) {
        await trx('care_journey_phases')
          .where({ id: p.id })
          .update({ entered_at: p.entered_at ?? now, locked_at: null, locked_by: null });
      }
    }
  }

  // Backfilled journeys skipped seeding for phases that were already
  // locked history; entering an empty phase seeds its template tasks.
  if (target.template_phase_id) {
    const existing = await trx('checklist_items').where({ care_journey_phase_id: target.id }).count('id as count').first();
    if (Number(existing?.count ?? 0) === 0) {
      const tasks = await trx('journey_template_tasks')
        .where({ template_phase_id: target.template_phase_id })
        .orderBy('sort_order', 'asc');
      if (tasks.length > 0) {
        await trx('checklist_items').insert(
          tasks.map((task) => ({
            care_profile_id: opts.journey.care_profile_id,
            care_journey_phase_id: target.id,
            phase: target.legacy_phase,
            title: task.title,
            description: task.description,
            is_milestone: task.is_milestone,
            sort_order: task.sort_order,
          }))
        );
      }
    }
  }

  await trx('care_journeys').where({ id: opts.journey.id }).update({ updated_at: trx.fn.now() });
  await syncLegacyPhaseFromJourney(trx, opts.journey.id);
  return { ok: true };
}

/**
 * Mirror a legacy-mapped journey back onto care_profiles.current_phase
 * and care_phase_history so pre-journey clients read a consistent world.
 * Journeys without legacy phase slugs sync nothing.
 */
export async function syncLegacyPhaseFromJourney(trx: Knex.Transaction, journeyId: string): Promise<void> {
  const journey = await trx('care_journeys').where({ id: journeyId }).first();
  if (!journey) return;
  const phases: JourneyPhaseRow[] = await trx('care_journey_phases')
    .where({ care_journey_id: journeyId })
    .orderBy('sort_order', 'asc');
  if (!phases.some((p) => p.legacy_phase)) return;

  const current = phases.find((p) => phaseState(p) === 'current');
  if (current?.legacy_phase) {
    await trx('care_profiles')
      .where({ id: journey.care_profile_id })
      .update({ current_phase: current.legacy_phase, updated_at: trx.fn.now() });
  }
  for (const p of phases) {
    if (!p.legacy_phase || !p.entered_at) continue;
    await trx('care_phase_history')
      .insert({
        care_profile_id: journey.care_profile_id,
        phase: p.legacy_phase,
        entered_at: p.entered_at,
        locked_at: p.locked_at,
        locked_by: p.locked_by,
      })
      .onConflict(['care_profile_id', 'phase'])
      .merge(['entered_at', 'locked_at', 'locked_by']);
  }
}

/** The profile's journey mirroring the legacy ageing enum, if any. */
export async function findLegacyJourney(careProfileId: string, trx?: Knex.Transaction): Promise<JourneyRow | null> {
  const q = (trx ?? db)('care_journeys')
    .join('care_journey_phases', 'care_journeys.id', 'care_journey_phases.care_journey_id')
    .where('care_journeys.care_profile_id', careProfileId)
    .whereNotNull('care_journey_phases.legacy_phase')
    .where('care_journeys.status', 'active')
    .select('care_journeys.*')
    .orderBy('care_journeys.started_at', 'asc')
    .first();
  return (await q) ?? null;
}
