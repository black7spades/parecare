import { db } from '../config/database';
import { formatInZone } from '../lib/timezone';
import type { CareAccess, CareProfile } from '../types';

/**
 * Builds the assistant's knowledge of one person. Everything the platform
 * knows about a care profile is summarised into a plain-text context block
 * that is injected into the system prompt, so the assistant can answer from
 * the live record instead of guessing.
 *
 * Scoping rules:
 * - The block only ever covers ONE care profile. The assistant knows nothing
 *   about other people on the account or the platform.
 * - Documents respect per-role visibility, exactly like the documents API.
 * - Everything else mirrors the API's read permissions: any accepted circle
 *   member (including viewers) can read the whole record.
 */

const MAX_LIST = 25;
const LOG_DAYS = 30;
const MAR_DAYS = 14;

function age(dob: string | Date | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) years--;
  return years;
}

function fmtDate(v: string | Date | null | undefined, timeZone?: string | null): string {
  if (!v) return 'unknown time';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'unknown time' : formatInZone(d, timeZone);
}

function line(items: Array<string | null | undefined>): string {
  return items.filter(Boolean).join(', ');
}

export async function buildProfileContext(
  profile: CareProfile,
  access: CareAccess,
  timeZone?: string | null
): Promise<string> {
  const profileId = profile.id;
  const now = new Date();
  const marSince = new Date(now.getTime() - MAR_DAYS * 24 * 3600 * 1000);
  const logSince = new Date(now.getTime() - LOG_DAYS * 24 * 3600 * 1000);
  const soon = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

  const [plan, meds, mar, tasks, circle, providers, questions, log, docs] = await Promise.all([
    db('care_plans').where({ care_profile_id: profileId }).first(),
    db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .where({ 'm.care_profile_id': profileId, 'm.active': true })
      .select('m.*', 'c.name as name', 'c.form as form')
      .orderBy('c.name', 'asc'),
    db('medication_administrations as a')
      .join('medications as m', 'a.medication_id', 'm.id')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .where('a.care_profile_id', profileId)
      .where('a.administered_at', '>=', marSince)
      .select('a.status', 'a.administered_at', 'a.dose_given', 'a.notes', 'a.administered_by_name', 'c.name as med_name')
      .orderBy('a.administered_at', 'desc')
      .limit(60),
    db('reminders')
      .where({ care_profile_id: profileId, completed: false })
      .where('next_due_at', '<=', soon)
      .orderBy('next_due_at', 'asc')
      .limit(MAX_LIST),
    db('care_circle_members').where({ care_profile_id: profileId, invite_accepted: true }),
    db('care_profile_providers as cpp')
      .join('providers as p', 'cpp.provider_id', 'p.id')
      .where({ 'cpp.care_profile_id': profileId })
      .select('p.*', 'cpp.poa_type', 'cpp.poa_activated')
      .orderBy('p.name', 'asc')
      .limit(MAX_LIST),
    db('open_questions').where({ care_profile_id: profileId, status: 'open' }).orderBy('created_at', 'desc').limit(10),
    db('care_log_entries')
      .where({ care_profile_id: profileId })
      .where('occurred_at', '>=', logSince)
      .orderBy('occurred_at', 'desc')
      .limit(MAX_LIST),
    db('documents').where({ care_profile_id: profileId }).orderBy('created_at', 'desc').limit(MAX_LIST),
  ]);

  const sections: string[] = [];
  const displayName = profile.full_name;
  const years = age(profile.date_of_birth);

  sections.push(
    [
      `## Person`,
      `Name: ${displayName}${profile.preferred_name ? ` (goes by ${profile.preferred_name})` : ''}`,
      years !== null ? `Age: ${years}` : null,
      profile.pronouns ? `Pronouns: ${profile.pronouns}` : null,
      profile.primary_language ? `Primary language: ${profile.primary_language}` : null,
      `Care phase: ${String(profile.current_phase).replace(/_/g, ' ')}`,
      profile.notes ? `Profile notes: ${profile.notes}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  );

  // Active care journeys: which phase each is in and what is open there,
  // so "what should we be doing next" is answerable from the record.
  const journeys = await db('care_journeys')
    .where({ care_profile_id: profileId, status: 'active' })
    .orderBy('started_at', 'asc');
  if (journeys.length > 0) {
    const lines: string[] = ['## Care journeys'];
    for (const j of journeys) {
      const phases = await db('care_journey_phases').where({ care_journey_id: j.id }).orderBy('sort_order', 'asc');
      const current = phases.find((p) => p.entered_at && !p.locked_at);
      const openTasks = current
        ? await db('checklist_items')
            .where({ care_journey_phase_id: current.id, completed: false })
            .orderBy('sort_order', 'asc')
            .limit(10)
        : [];
      lines.push(
        `- ${j.name}: currently in phase "${current?.name ?? 'not started'}" of ${phases.length}` +
          (openTasks.length ? `. Open tasks: ${openTasks.map((t) => t.title).join('; ')}` : '')
      );
    }
    sections.push(lines.join('\n'));
  }

  // Allergies come first among the health facts: the assistant must
  // never suggest anything on this list.
  const [allergies, conditions] = await Promise.all([
    db('allergies').where({ care_profile_id: profileId }).orderBy('sort_order', 'asc'),
    db('medical_conditions').where({ care_profile_id: profileId }).orderBy('sort_order', 'asc'),
  ]);
  if (allergies.length > 0) {
    sections.push(
      `## Allergies, must never be given\n` +
        allergies.map((a) => `- ${a.substance}${a.reaction ? `: causes ${a.reaction}` : ''}`).join('\n')
    );
  }
  if (conditions.length > 0) {
    sections.push(
      `## Medical conditions\n` + conditions.map((c) => `- ${c.name}${c.notes ? `: ${c.notes}` : ''}`).join('\n')
    );
  }

  if (plan) {
    const contacts = Array.isArray(plan.emergency_contacts) ? plan.emergency_contacts : [];
    sections.push(
      [
        `## Care plan`,
        Array.isArray(plan.dietary_requirements) && plan.dietary_requirements.length
          ? `Dietary requirements: ${plan.dietary_requirements.join('; ')}`
          : null,
        Array.isArray(plan.mobility_aids) && plan.mobility_aids.length ? `Mobility aids: ${plan.mobility_aids.join('; ')}` : null,
        Array.isArray(plan.communication_needs) && plan.communication_needs.length
          ? `Communication needs: ${plan.communication_needs.join('; ')}`
          : null,
        `Advance care directive: ${plan.advance_care_directive ? `yes${plan.advance_care_directive_location ? `, kept at ${plan.advance_care_directive_location}` : ''}` : 'no'}`,
        contacts.length
          ? `Emergency contacts: ${contacts
              .map((c: { name?: string; relationship?: string; phone?: string }) => line([c.name, c.relationship, c.phone]))
              .join(' | ')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  if (meds.length) {
    sections.push(
      `## Active medications\n` +
        meds
          .map((m) => {
            const bits = [
              `- ${m.name}`,
              m.dose ? `dose ${m.dose}` : null,
              m.form ? `form ${m.form}` : null,
              m.route ? `route ${m.route}` : null,
              m.frequency ? `frequency ${m.frequency}` : null,
              Array.isArray(m.schedule_times) && m.schedule_times.length ? `scheduled at ${m.schedule_times.join(', ')}` : null,
              m.supply_remaining !== null && m.supply_remaining !== undefined && m.supply_remaining !== ''
                ? `supply remaining ${m.supply_remaining}`
                : null,
              m.instructions ? `instructions: ${m.instructions}` : null,
            ];
            return bits.filter(Boolean).join('; ');
          })
          .join('\n')
    );
  }

  if (mar.length) {
    sections.push(
      `## Medication administration record, last ${MAR_DAYS} days (newest first)\n` +
        mar
          .map(
            (a) =>
              `- ${fmtDate(a.administered_at, timeZone)}: ${a.med_name}${a.dose_given ? ` ${a.dose_given}` : ''} status ${a.status}${a.administered_by_name ? ` by ${a.administered_by_name}` : ''}${a.notes ? ` (note: ${a.notes})` : ''}`
          )
          .join('\n')
    );
  }

  if (tasks.length) {
    sections.push(
      `## Upcoming tasks and appointments, next 30 days\n` +
        tasks
          .map((t) => `- ${fmtDate(t.next_due_at, timeZone)}: ${t.title}${t.reminder_type !== 'once' ? ` (repeats ${t.reminder_type})` : ''}${t.body ? ` — ${t.body}` : ''}`)
          .join('\n')
    );
  }

  if (circle.length) {
    sections.push(
      `## Care circle\n` +
        circle
          .map(
            (m) =>
              `- ${m.display_name}: ${line([m.role, m.relationship ? `their ${m.relationship}` : null, m.permission === 'viewer' ? 'view-only' : null, m.poa_type ? `holds ${m.poa_type} power of attorney${m.poa_activated ? ' (activated)' : ''}` : null])}`
          )
          .join('\n')
    );
  }

  if (providers.length) {
    sections.push(
      `## Providers\n` +
        providers
          .map(
            (p) =>
              `- ${p.name} (${p.provider_type})${line(['', p.organisation, p.phone, p.email]) ? `: ${line([p.organisation, p.phone, p.email])}` : ''}${p.poa_type ? `; holds ${p.poa_type} power of attorney${p.poa_activated ? ' (activated)' : ''}` : ''}`
          )
          .join('\n')
    );
  }

  if (questions.length) {
    sections.push(`## Open family questions\n` + questions.map((q) => `- ${q.title}${q.body ? `: ${q.body}` : ''}`).join('\n'));
  }

  if (log.length) {
    sections.push(
      `## Care log, last ${LOG_DAYS} days (newest first)\n` +
        log
          .map((e) => `- ${fmtDate(e.occurred_at, timeZone)} [${String(e.entry_type).replace(/_/g, ' ')}]${e.title ? ` ${e.title}:` : ''} ${e.body}`)
          .join('\n')
    );
  }

  // Documents respect per-role visibility exactly like the documents API:
  // an empty list means visible to the whole circle.
  const visibleDocs = docs.filter((d) => {
    const roles = Array.isArray(d.visible_to_roles) ? d.visible_to_roles : [];
    if (roles.length === 0) return true;
    if (access.level === 'owner' || access.level === 'admin') return true;
    const memberRole = access.member?.role;
    return !!memberRole && roles.includes(memberRole);
  });
  if (visibleDocs.length) {
    sections.push(
      `## Documents on file (names only, contents not readable here)\n` +
        visibleDocs.map((d) => `- ${d.label} (${String(d.category).replace(/_/g, ' ')}, added ${fmtDate(d.created_at, timeZone)})`).join('\n')
    );
  }

  return sections.join('\n\n');
}
