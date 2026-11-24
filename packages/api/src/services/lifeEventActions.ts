import { z } from 'zod';
import { db } from '../config/database';
import { currentSourceDocument } from './auditContext';
import { StayProblem, createStay, dischargeStay, openStay } from './hospitalStays';
import { ResultProblem, saveResult, DOCTOR_VIEWS } from './testResults';
import { PlanProblem, savePlan, MANAGEMENT, SCHEMES } from './fundingPlans';
import { MoveProblem, paymentChoiceFrom, saveMove } from './careMoves';
import { TaskProblem } from './tasks';
import { resolveContactInput } from './professionals';
import { whereNamed } from './providerPractices';
import { formatInZone } from '../lib/timezone';
import type { Knex } from 'knex';
import type { Account } from '../types';

/**
 * What Pare can record about life events, through the same services the
 * screens use: a hospital stay and its discharge, a test result, a funding
 * plan and a move into care.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (max: number) => z.string().max(max).optional().nullable();

export const recordHospitalStaySchema = z.object({
  type: z.literal('record_hospital_stay'),
  // The hospital, by name: found in Contacts, or filed there.
  hospital: z.string().min(1).max(255),
  admitted_on: day,
  discharged_on: day.optional().nullable(),
  ward: opt(120),
  treating_team: opt(255),
  reason: opt(4000),
});

export const recordDischargeSchema = z.object({
  type: z.literal('record_discharge'),
  discharged_on: day,
  // Days after leaving to see the GP, from the letter. Seven when it does not say.
  follow_up_days: z.number().int().min(0).max(365).optional().nullable(),
  // Who to see, by name. Their main GP when left out.
  follow_up_with: opt(255),
  // When no stay is open: the hospital and the day they went in, to record the stay too.
  hospital: opt(255),
  admitted_on: day.optional().nullable(),
});

const resultValue = z.object({
  name: z.string().min(1).max(255),
  value_number: z.number().optional().nullable(),
  value_text: opt(255),
  unit: opt(30),
  range_low: z.number().optional().nullable(),
  range_high: z.number().optional().nullable(),
  flag: z.enum(['low', 'high', 'normal']).optional().nullable(),
});

export const recordResultSchema = z.object({
  type: z.literal('record_result'),
  test_name: z.string().min(1).max(255),
  collected_on: day.optional().nullable(),
  reported_on: day.optional().nullable(),
  summary: opt(5000),
  doctor_view: z.enum(DOCTOR_VIEWS).optional().nullable(),
  ordered_by: opt(255),
  lab: opt(255),
  // The test appointment, by title.
  for_appointment: opt(255),
  values: z.array(resultValue).max(100).optional().nullable(),
});

export const setFundingPlanSchema = z.object({
  type: z.literal('set_funding_plan'),
  scheme: z.enum(SCHEMES),
  starts_on: day.optional().nullable(),
  ends_on: day.optional().nullable(),
  review_on: day.optional().nullable(),
  management: z.enum(MANAGEMENT).optional().nullable(),
  plan_manager: opt(255),
  support_coordinator: opt(255),
  local_area_coordinator: opt(255),
  budgets: z.array(z.object({ name: z.string().min(1).max(120), amount: z.number().min(0) })).max(40).optional().nullable(),
});

export const recordMoveIntoCareSchema = z.object({
  type: z.literal('record_move_into_care'),
  care_home: z.string().min(1).max(255),
  entry_on: day.optional().nullable(),
  agreement_signed_on: day.optional().nullable(),
  // lump_sum | daily | mix, or plain words.
  payment_choice: opt(60),
  notice_given_on: day.optional().nullable(),
  room: opt(50),
});

export type LifeEventAction =
  | z.infer<typeof recordHospitalStaySchema>
  | z.infer<typeof recordDischargeSchema>
  | z.infer<typeof recordResultSchema>
  | z.infer<typeof setFundingPlanSchema>
  | z.infer<typeof recordMoveIntoCareSchema>;

export const LIFE_EVENT_TYPES = new Set(['record_hospital_stay', 'record_discharge', 'record_result', 'set_funding_plan', 'record_move_into_care']);

interface Ctx {
  profileId: string;
  account: Account;
  timeZone: string | null | undefined;
  audit: (entityType: string, summary: string, entityId?: string | null) => Promise<void>;
  linkSource: (kind: string, id: string | null | undefined) => Promise<void>;
}

/** A contact already linked to the person, by name, else null. Never files anyone. */
async function linkedByName(profileId: string, name: string | null | undefined): Promise<string | null> {
  if (!name?.trim()) return null;
  const row = (await db('care_profile_providers as cpp')
    .join('providers as p', 'cpp.provider_id', 'p.id')
    .where('cpp.care_profile_id', profileId)
    .where((w) => whereNamed(w as unknown as Knex.QueryBuilder, name.trim(), 'p'))
    .first('p.id')) as { id: string } | undefined;
  return row?.id ?? null;
}

const filedLine = (filed: Array<{ name: string }>) => filed.map((f) => ` Added ${f.name} to Contacts.`).join('');

const friendly = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export async function executeLifeEvent(action: LifeEventAction, ctx: Ctx): Promise<string> {
  const { profileId, account, timeZone } = ctx;
  try {
    switch (action.type) {
      case 'record_hospital_stay': {
        const hospitalId = await linkedByName(profileId, action.hospital);
        const made = await db.transaction((trx) =>
          createStay(trx, {
            profileId,
            actorId: account.id,
            timeZone,
            documentId: currentSourceDocument(),
            input: {
              ...(hospitalId ? { hospital_provider_id: hospitalId } : { hospital_name: action.hospital }),
              admitted_on: action.admitted_on,
              discharged_on: action.discharged_on ?? null,
              ward: action.ward ?? null,
              treating_team: action.treating_team ?? null,
              reason: action.reason ?? null,
            },
          })
        );
        await ctx.audit('hospital-stays', `hospital stay at ${action.hospital}`, made.stay.id);
        await ctx.linkSource('hospital-stays', made.stay.id);
        return made.stay.discharged_on
          ? `Recorded the stay at ${action.hospital} from ${friendly(action.admitted_on)} to ${friendly(made.stay.discharged_on)}, with a GP follow-up task.${filedLine(made.filed)}`
          : `Recorded that they went into ${action.hospital} on ${friendly(action.admitted_on)}. Medicine reminders are paused until the discharge is recorded.${filedLine(made.filed)}`;
      }
      case 'record_discharge': {
        let stay = await openStay(db, profileId);
        let made = '';
        if (!stay) {
          // A letter for a stay nobody recorded yet: record it now, if it says where.
          if (action.hospital?.trim() && action.admitted_on) {
            const hospitalId = await linkedByName(profileId, action.hospital);
            const created = await db.transaction((trx) =>
              createStay(trx, {
                profileId,
                actorId: account.id,
                timeZone,
                input: { ...(hospitalId ? { hospital_provider_id: hospitalId } : { hospital_name: action.hospital }), admitted_on: action.admitted_on! },
              })
            );
            stay = created.stay;
            made = ` Recorded the stay at ${action.hospital} from ${friendly(action.admitted_on)}.${filedLine(created.filed)}`;
          } else {
            const latest = (await db('hospital_stays').where({ care_profile_id: profileId }).orderBy('admitted_on', 'desc').first()) as typeof stay | undefined;
            if (!latest) return 'There is no hospital stay to discharge. Say which hospital and the day they went in, and I will record both.';
            stay = latest;
          }
        }
        let withId: string | null = null;
        if (action.follow_up_with?.trim()) {
          const r = await resolveContactInput(db, profileId, { name: action.follow_up_with }, 'gp');
          if (!('error' in r)) withId = r.id;
        }
        const done = await db.transaction((trx) =>
          dischargeStay(trx, {
            profileId,
            stayId: stay!.id,
            actorId: account.id,
            timeZone,
            input: { discharged_on: action.discharged_on, follow_up_days: action.follow_up_days ?? null, document_id: currentSourceDocument(), follow_up_with_provider_id: withId },
          })
        );
        await ctx.audit('hospital-stays', `recorded the discharge on ${action.discharged_on}`, done.id);
        await ctx.linkSource('hospital-stays', done.id);
        const task = done.follow_up_task_id ? ((await db('reminders').where({ id: done.follow_up_task_id }).first('title')) as { title: string } | undefined) : undefined;
        if (done.follow_up_task_id) await ctx.linkSource('reminders', done.follow_up_task_id);
        return `Recorded the discharge on ${friendly(action.discharged_on)}. Medicine reminders are back on.${task ? ` Added the task "${task.title}".` : ''} Added "Look over the care plan after the hospital stay".${made}`;
      }
      case 'record_result': {
        let appointmentId: string | null = null;
        if (action.for_appointment?.trim()) {
          const row = (await db('appointments')
            .where({ care_profile_id: profileId })
            .whereRaw('title ilike ?', [`%${action.for_appointment.trim()}%`])
            .orderByRaw('starts_at DESC NULLS LAST')
            .first('id')) as { id: string } | undefined;
          appointmentId = row?.id ?? null;
        }
        const orderedId = await linkedByName(profileId, action.ordered_by);
        const labId = await linkedByName(profileId, action.lab);
        const saved = await db.transaction((trx) =>
          saveResult(trx, {
            profileId,
            actorId: account.id,
            input: {
              test_name: action.test_name,
              collected_on: action.collected_on ?? undefined,
              reported_on: action.reported_on ?? null,
              summary: action.summary ?? null,
              doctor_view: action.doctor_view ?? null,
              ...(appointmentId ? { appointment_id: appointmentId } : {}),
              ...(orderedId ? { ordered_by_provider_id: orderedId } : action.ordered_by?.trim() ? { ordered_by_name: action.ordered_by } : {}),
              ...(labId ? { lab_provider_id: labId } : action.lab?.trim() ? { lab_name: action.lab } : {}),
              values: (action.values ?? []).map((v) => ({ ...v, value_text: v.value_text ?? null, unit: v.unit ?? null })),
            },
          })
        );
        await ctx.audit('results', `result for ${action.test_name}`, saved.id);
        await ctx.linkSource('results', saved.id);
        const row = (await db('test_results as r')
          .leftJoin('appointments as a', 'a.id', 'r.review_appointment_id')
          .where('r.id', saved.id)
          .first('a.title', 'a.starts_at')) as { title: string | null; starts_at: Date | null } | undefined;
        const at = row?.title && row.starts_at ? ` It is to talk about at ${row.title}, ${formatInZone(new Date(row.starts_at), timeZone)}.` : '';
        const n = action.values?.length ?? 0;
        return `Recorded the ${action.test_name} result${n ? ` with ${n} ${n === 1 ? 'measure' : 'measures'}` : ''}.${at}${filedLine(saved.filed)}`;
      }
      case 'set_funding_plan': {
        const existing = (await db('funding_plans').where({ care_profile_id: profileId, scheme: action.scheme }).orderByRaw('coalesce(starts_on, created_at::date) desc').first('id')) as
          | { id: string }
          | undefined;
        // The same plan again (same scheme and start) is a change to it; a new start is a new plan.
        const same = existing && action.starts_on
          ? ((await db('funding_plans').where({ id: existing.id }).first('starts_on')) as { starts_on: string | null }).starts_on === action.starts_on
          : !!existing && !action.starts_on;
        const ref = (name: string | null | undefined) => (name?.trim() ? { name: name.trim() } : undefined);
        const saved = await db.transaction((trx) =>
          savePlan(trx, {
            profileId,
            actorId: account.id,
            planId: same ? existing!.id : null,
            timeZone,
            input: {
              scheme: action.scheme,
              ...(action.starts_on !== undefined ? { starts_on: action.starts_on } : {}),
              ...(action.ends_on !== undefined ? { ends_on: action.ends_on } : {}),
              ...(action.review_on !== undefined ? { review_on: action.review_on } : {}),
              ...(action.management !== undefined ? { management: action.management } : {}),
              ...(ref(action.plan_manager) ? { plan_manager: ref(action.plan_manager) } : {}),
              ...(ref(action.support_coordinator) ? { support_coordinator: ref(action.support_coordinator) } : {}),
              ...(ref(action.local_area_coordinator) ? { local_area_coordinator: ref(action.local_area_coordinator) } : {}),
              ...(action.budgets ? { budgets: action.budgets } : {}),
            },
          })
        );
        await ctx.audit('funding-plans', `${same ? 'updated' : 'added'} the funding plan`, saved.id);
        await ctx.linkSource('funding-plans', saved.id);
        const reports = saved.report_tasks ? ` Added ${saved.report_tasks} ${saved.report_tasks === 1 ? 'task' : 'tasks'} to ask for progress reports before the review.` : '';
        return `${same ? 'Updated' : 'Saved'} the funding plan.${reports}${filedLine(saved.filed)}`;
      }
      case 'record_move_into_care': {
        const homeId = await linkedByName(profileId, action.care_home);
        const choice = paymentChoiceFrom(action.payment_choice);
        const existing = homeId
          ? ((await db('care_moves').where({ care_profile_id: profileId, facility_provider_id: homeId }).first('id')) as { id: string } | undefined)
          : undefined;
        const saved = await db.transaction((trx) =>
          saveMove(trx, {
            profileId,
            actor: { id: account.id, role: account.role },
            moveId: existing?.id ?? null,
            timeZone,
            input: {
              ...(homeId ? { facility_provider_id: homeId } : { facility_name: action.care_home }),
              ...(action.entry_on !== undefined ? { entry_on: action.entry_on } : {}),
              ...(action.agreement_signed_on !== undefined ? { agreement_signed_on: action.agreement_signed_on } : {}),
              ...(choice ? { payment_choice: choice } : {}),
              ...(action.notice_given_on !== undefined ? { notice_given_on: action.notice_given_on } : {}),
              ...(action.room ? { room_number: action.room } : {}),
            },
          })
        );
        await ctx.audit('care-moves', `move into ${action.care_home}`, saved.id);
        await ctx.linkSource('care-moves', saved.id);
        return `Recorded the move into ${action.care_home}. It is where they live now, and their previous home is kept.${saved.phase_changed ? ' Their care journey has moved on too.' : ''}${filedLine(saved.filed)}`;
      }
    }
  } catch (err) {
    if (err instanceof StayProblem || err instanceof ResultProblem || err instanceof PlanProblem || err instanceof MoveProblem || err instanceof TaskProblem) {
      return `That was not saved: ${err.message}`;
    }
    throw err;
  }
}
