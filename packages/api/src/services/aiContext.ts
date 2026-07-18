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

  const [plan, meds, mar, latestDoseRows, tasks, circle, providers, questions, log, docs] = await Promise.all([
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
    // The single most recent dose ever recorded, so "the latest dose taken"
    // is answerable even when it falls outside the recent window above.
    db('medication_administrations as a')
      .join('medications as m', 'a.medication_id', 'm.id')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .where('a.care_profile_id', profileId)
      .select('a.status', 'a.administered_at', 'a.dose_given', 'a.notes', 'a.administered_by_name', 'c.name as med_name')
      .orderBy('a.administered_at', 'desc')
      .limit(1),
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

  // Where they live and who to contact, resolved from the linked providers
  // already loaded above, so "where is she / how do I reach her" is answerable.
  const providerOf = (id: string | null | undefined) => (id ? providers.find((p) => p.id === id) : undefined);
  const residenceProvider = providerOf(profile.residence_provider_id);
  const roomParts = [
    profile.room_number ? `room ${profile.room_number}` : null,
    profile.room_area_name ? `${profile.room_area_name}${profile.room_area_type ? ` ${profile.room_area_type}` : ''}` : null,
  ].filter(Boolean);
  const RESIDENCE_LABELS: Record<string, string> = {
    private_residence: 'private residence',
    care_facility: 'care facility',
    retirement_village: 'retirement village',
    group_home: 'group home',
    hospital: 'hospital',
    other: 'other',
  };
  const addressLine = [profile.address_line1, profile.address_line2, profile.address_suburb, profile.address_state, profile.address_postcode]
    .filter(Boolean)
    .join(', ');
  const residenceLine = residenceProvider
    ? `Lives at: ${residenceProvider.name}${roomParts.length ? ` (${roomParts.join(', ')})` : ''}${profile.residence_type ? ` — ${RESIDENCE_LABELS[profile.residence_type] ?? profile.residence_type}` : ''}${residenceProvider.phone ? `, phone ${residenceProvider.phone}` : ''}`
    : addressLine
      ? `Lives at: ${addressLine}${profile.residence_type ? ` — ${RESIDENCE_LABELS[profile.residence_type] ?? profile.residence_type}` : ''}`
      : null;

  const contactProvider = providerOf(profile.contact_provider_id);
  const contactLine =
    profile.contact_kind === 'provider' && contactProvider
      ? `Contact via: ${contactProvider.name}${contactProvider.phone ? `, phone ${contactProvider.phone}` : ''}${contactProvider.email ? `, email ${contactProvider.email}` : ''}`
      : profile.contact_kind === 'contact' && profile.contact_name
        ? `Contact: ${profile.contact_name}${profile.contact_relationship ? ` (${profile.contact_relationship})` : ''}${profile.contact_phone ? `, phone ${profile.contact_phone}` : ''}`
        : profile.contact_kind === 'self' && profile.contact_phone
          ? `Contact: themselves${profile.contact_phone ? `, phone ${profile.contact_phone}` : ''}`
          : null;

  sections.push(
    [
      `## Person`,
      `Name: ${displayName}${profile.preferred_name ? ` (goes by ${profile.preferred_name})` : ''}`,
      years !== null ? `Age: ${years}` : null,
      profile.pronouns ? `Pronouns: ${profile.pronouns}` : null,
      profile.primary_language ? `Primary language: ${profile.primary_language}` : null,
      `Care phase: ${String(profile.current_phase).replace(/_/g, ' ')}`,
      residenceLine,
      contactLine,
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

  // What each neurotype actually looks like for this person: the recorded
  // traits, needs and supports, so the assistant answers from the record
  // rather than describing the neurotype in generic terms.
  const neurotypeConds = conditions.filter((c) => c.category === 'neurotype');
  if (neurotypeConds.length > 0) {
    const attrs = await db('neurotype_attributes as na')
      .join('neurotype_attribute_catalogue as nac', 'na.catalogue_id', 'nac.id')
      .whereIn('na.condition_id', neurotypeConds.map((c) => c.id as string))
      .orderBy('na.sort_order', 'asc')
      .select('na.condition_id', 'nac.kind', 'na.notes', 'nac.label');
    if (attrs.length > 0) {
      const kindLabel: Record<string, string> = { trait: 'Traits', need: 'Needs', support: 'Supports' };
      const lines = neurotypeConds
        .map((c) => {
          const mine = attrs.filter((a) => a.condition_id === c.id);
          if (mine.length === 0) return null;
          const parts = (['trait', 'need', 'support'] as const)
            .map((k) => {
              const items = mine
                .filter((a) => a.kind === k)
                .map((a) => `${a.label}${a.notes ? ` (${a.notes})` : ''}`);
              return items.length ? `  ${kindLabel[k]}: ${items.join('; ')}` : null;
            })
            .filter(Boolean);
          return [`- ${c.name}`, ...parts].join('\n');
        })
        .filter(Boolean);
      if (lines.length > 0) {
        sections.push(`## Neurotype traits, needs and supports\n${lines.join('\n')}`);
      }
    }
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

  {
    // Always present, so the assistant can tell "no doses recorded" apart from
    // "I was not given the record". The latest dose ever recorded leads, then
    // the recent detail; a dose older than the window still answers "the
    // latest dose taken".
    const fmtDose = (a: {
      administered_at: string | Date | null;
      med_name: string;
      dose_given: string | null;
      status: string;
      administered_by_name: string | null;
      notes: string | null;
    }) =>
      `${fmtDate(a.administered_at, timeZone)}: ${a.med_name}${a.dose_given ? ` ${a.dose_given}` : ''} status ${a.status}${a.administered_by_name ? ` by ${a.administered_by_name}` : ''}${a.notes ? ` (note: ${a.notes})` : ''}`;
    const latest = latestDoseRows[0];
    const lines = [`## Medication administration record (doses actually taken)`];
    if (latest) {
      lines.push(`Most recent dose taken — ${fmtDose(latest)}`);
    } else {
      lines.push('No doses have ever been recorded as taken for this person.');
    }
    if (mar.length) {
      lines.push(`Doses in the last ${MAR_DAYS} days (newest first):`);
      for (const a of mar) lines.push(`- ${fmtDose(a)}`);
    } else if (latest) {
      lines.push(`No doses have been recorded in the last ${MAR_DAYS} days.`);
    }
    sections.push(lines.join('\n'));
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
