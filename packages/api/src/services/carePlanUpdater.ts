import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '../config/database';
import { uploadFile, deleteFile } from './storage';
import { composeReport, reportToHtml } from './carePlanReport';
import { isSelfManaged } from './aiTone';

/**
 * Event-driven incremental care-plan updater.
 *
 * The care plan is a versioned document assembled from the first-class
 * data tables (conditions, allergies, medications, treatments, providers,
 * care needs). Changes to those tables land in care_plan_events; applying
 * the pending events produces a minimal, ordered delta of add / modify /
 * remove operations touching only the entries that actually changed. The
 * delta is validated against the database truth, applied atomically on
 * top of the previous version, and recorded with full provenance (which
 * events caused which operation). The whole document is never
 * regenerated after version 1.
 *
 * When an AI provider is configured, the local LLM is asked to propose
 * the delta in strict machine-readable JSON; every proposed operation is
 * then verified against a deterministic diff of the source tables, so a
 * hallucinated entry can never enter the plan. Without AI, the
 * deterministic diff is used directly.
 */

// ---------------------------------------------------------------------------
// Content model

/** One entry in a plan section. Every fact is its own field. */
export interface PlanEntry {
  key: string;
  fields: Record<string, string | number | boolean | null>;
}

export interface PlanContent {
  sections: Record<string, PlanEntry[]>;
}

export interface DeltaOp {
  op: 'add' | 'modify' | 'remove';
  section: string;
  key: string;
  fields?: Record<string, string | number | boolean | null>;
}

/**
 * Section order is presentation order. The synthesized clinical narrative
 * (goals and preferences first, then the strategies that pursue them, the
 * risks to watch, and when the plan must be reviewed) leads the document,
 * as care-plan frameworks such as the Australian Government's Support at
 * Home program expect; the factual record follows as the evidence base.
 */
export const PLAN_SECTIONS = [
  'goals',
  'strategies',
  'risks',
  'review',
  'allergies',
  'conditions',
  'medications',
  'treatments',
  'needs',
  'directive',
  'emergency_contacts',
  'providers',
] as const;
export type PlanSection = (typeof PLAN_SECTIONS)[number];

/** Sections written by the plan editor, not sourced from a table. */
export const NARRATIVE_SECTIONS = ['goals', 'strategies', 'risks', 'review'] as const;
type NarrativeSection = (typeof NARRATIVE_SECTIONS)[number];

/** Sections that mirror a source table row for row. */
export const FACTUAL_SECTIONS = [
  'allergies',
  'conditions',
  'medications',
  'treatments',
  'needs',
  'directive',
  'emergency_contacts',
  'providers',
] as const;
type FactualSection = (typeof FACTUAL_SECTIONS)[number];

export const SECTION_LABELS: Record<PlanSection, string> = {
  goals: 'Goals and preferences',
  strategies: 'Care strategies',
  risks: 'Risks and considerations',
  review: 'Review schedule',
  allergies: 'Allergies',
  conditions: 'Conditions',
  medications: 'Medications',
  treatments: 'Treatments',
  needs: 'Day-to-day needs',
  directive: 'Advance care directive',
  emergency_contacts: 'Emergency contacts',
  providers: 'Providers',
};

/** Which factual plan sections a change to a source table can affect. */
const SECTIONS_BY_SOURCE: Record<string, PlanSection[]> = {
  conditions: ['conditions'],
  allergies: ['allergies'],
  medications: ['medications'],
  treatments: ['treatments'],
  providers: ['providers'],
  plan: ['needs', 'directive', 'emergency_contacts'],
  // Care log entries carry no factual section of their own, but feed the
  // synthesized risk narrative (incidents, observations).
  log: [],
};

/** Sections where a modify or remove is clinically risky enough to need review. */
const HIGH_RISK_SECTIONS = new Set<PlanSection>(['allergies', 'medications']);

/** Deltas larger than this are unusual and routed for human review. */
const LARGE_DELTA_OPS = 12;

const slug = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

const dateOnly = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const asStringArray = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
};

// ---------------------------------------------------------------------------
// Section builders: the database truth for each section, entry by entry

async function buildSection(profileId: string, section: FactualSection): Promise<PlanEntry[]> {
  switch (section) {
    case 'allergies': {
      const rows = await db('allergies').where({ care_profile_id: profileId }).orderBy('substance');
      return rows.map((r) => ({
        key: `allergies:${r.id}`,
        fields: { substance: r.substance, reaction: r.reaction ?? null },
      }));
    }
    case 'conditions': {
      const rows = await db('medical_conditions')
        .where({ care_profile_id: profileId })
        .orderBy('name');
      return rows.map((r) => ({
        key: `conditions:${r.id}`,
        fields: {
          name: r.name,
          category: r.category ?? null,
          condition_type: r.condition_type ?? null,
          severity: r.severity ?? null,
          status: r.status ?? null,
          started_on: dateOnly(r.started_on),
          resolved_on: dateOnly(r.resolved_on),
        },
      }));
    }
    case 'medications': {
      // The medication's name lives on the shared catalogue, not the
      // medication row (migration 023) — same join the medications route
      // uses. Dose amount and measure are two data points, two fields.
      const rows = await db('medications as m')
        .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
        .where('m.care_profile_id', profileId)
        .orderBy('c.name')
        .select('m.*', 'c.name as name');
      return rows.map((r) => ({
        key: `medications:${r.id}`,
        fields: {
          name: r.name,
          dose_amount: r.dose_amount ?? null,
          dose_unit: r.dose_unit ?? null,
          route: r.route ?? null,
          frequency: r.frequency ?? null,
          // One multi-valued field: the daily schedule times.
          schedule_times: asStringArray(r.schedule_times).join(', ') || null,
          as_needed: !!r.as_needed,
          active: !!r.active,
        },
      }));
    }
    case 'treatments': {
      const rows = await db('treatments').where({ care_profile_id: profileId }).orderBy('name');
      return rows.map((r) => ({
        key: `treatments:${r.id}`,
        fields: {
          name: r.name,
          category: r.category ?? null,
          frequency: r.frequency ?? null,
          schedule_times: asStringArray(r.schedule_times).join(', ') || null,
          as_needed: !!r.as_needed,
          active: !!r.active,
        },
      }));
    }
    case 'providers': {
      // Providers are account-scoped (migration 047); the tie to a care
      // profile lives on care_profile_providers.
      const rows = await db('care_profile_providers as cpp')
        .join('providers as p', 'cpp.provider_id', 'p.id')
        .where({ 'cpp.care_profile_id': profileId })
        .orderBy('p.name')
        .select('p.*', 'cpp.provider_id');
      return rows.map((r) => ({
        key: `providers:${r.provider_id}`,
        fields: {
          name: r.name,
          provider_type: r.provider_type ?? null,
          organisation: r.organisation ?? null,
          phone: r.phone ?? null,
          email: r.email ?? null,
        },
      }));
    }
    case 'needs': {
      const plan = await db('care_plans').where({ care_profile_id: profileId }).first();
      const entries: PlanEntry[] = [];
      const lists: Array<[string, string, unknown]> = [
        ['dietary_requirement', 'Dietary requirement', plan?.dietary_requirements],
        ['mobility_aid', 'Mobility aid', plan?.mobility_aids],
        ['communication_need', 'Communication need', plan?.communication_needs],
      ];
      for (const [kind, label, raw] of lists) {
        for (const value of asStringArray(raw)) {
          entries.push({
            key: `needs:${kind}:${slug(value)}`,
            fields: { kind: label, value },
          });
        }
      }
      return entries;
    }
    case 'directive': {
      const plan = await db('care_plans').where({ care_profile_id: profileId }).first();
      if (!plan?.advance_care_directive) return [];
      return [
        {
          key: 'directive:status',
          fields: {
            in_place: true,
            location: plan.advance_care_directive_location ?? null,
          },
        },
      ];
    }
    case 'emergency_contacts': {
      const plan = await db('care_plans').where({ care_profile_id: profileId }).first();
      const contacts = ((): Array<{ name?: string; relationship?: string; phone?: string }> => {
        const raw = plan?.emergency_contacts;
        if (Array.isArray(raw)) return raw as Array<{ name?: string; relationship?: string; phone?: string }>;
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }
        return [];
      })();
      return contacts
        .filter((c) => c.name)
        .map((c) => ({
          key: `emergency_contacts:${slug(`${c.name}-${c.phone ?? ''}`)}`,
          fields: {
            name: c.name ?? '',
            relationship: c.relationship ?? null,
            phone: c.phone ?? null,
          },
        }));
    }
  }
}

async function buildTruth(profileId: string, sections: FactualSection[]): Promise<Record<string, PlanEntry[]>> {
  const truth: Record<string, PlanEntry[]> = {};
  for (const section of sections) {
    truth[section] = await buildSection(profileId, section);
  }
  return truth;
}

// ---------------------------------------------------------------------------
// Deterministic diff: the ground truth delta for the touched sections

// Postgres jsonb does not preserve key order, so stored fields must be
// compared canonically or every round-trip would look like a change.
const canonFields = (f: PlanEntry['fields']): string =>
  JSON.stringify(Object.fromEntries(Object.entries(f).sort(([a], [b]) => a.localeCompare(b))));

const sameFields = (a: PlanEntry['fields'], b: PlanEntry['fields']): boolean =>
  canonFields(a) === canonFields(b);

function diffOps(current: PlanContent, truth: Record<string, PlanEntry[]>, sections: PlanSection[]): DeltaOp[] {
  const ops: DeltaOp[] = [];
  for (const section of sections) {
    const curEntries = current.sections[section] ?? [];
    const truthEntries = truth[section] ?? [];
    const curByKey = new Map(curEntries.map((e) => [e.key, e]));
    const truthByKey = new Map(truthEntries.map((e) => [e.key, e]));
    for (const entry of truthEntries) {
      const existing = curByKey.get(entry.key);
      if (!existing) ops.push({ op: 'add', section, key: entry.key, fields: entry.fields });
      else if (!sameFields(existing.fields, entry.fields))
        ops.push({ op: 'modify', section, key: entry.key, fields: entry.fields });
    }
    for (const entry of curEntries) {
      if (!truthByKey.has(entry.key)) ops.push({ op: 'remove', section, key: entry.key });
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// The synthesized clinical narrative
//
// Frameworks such as the Australian Government's Support at Home program
// expect a care plan to lead with the participant's goals, preferences
// and choices, connect each condition to the services and strategies that
// address it, assess risk proactively, and be reviewed at least every 12
// months or when a significant event occurs. The plan editor below turns
// the factual record into that narrative: the LLM is the editor and
// synthesizer where configured (strict machine-readable output enforced),
// with a deterministic fallback so the sections always exist.

export interface NarrativeSources {
  name: string;
  /** Preferred/first name for addressing the person. */
  display_name: string;
  /** True when the person runs their own care (address them directly). */
  self_managed: boolean;
  conditions: Array<{
    name: string;
    status: string | null;
    severity: string | null;
    category: string | null;
    condition_type: string | null;
    started_on: string | null;
    resolved_on: string | null;
    contagious: boolean;
    /** For neurotype conditions: the formal diagnosis facts, never invented. */
    neurotype: string | null;
    diagnosis_status: string | null;
    medications: string[];
    treatments: string[];
  }>;
  allergies: Array<{ substance: string; reaction: string | null }>;
  dietary_requirements: string[];
  mobility_aids: string[];
  communication_needs: string[];
  /**
   * Neurodivergence is intrinsic, not a condition to manage. These are the
   * recorded traits (how it shows up), needs and supports (what helps), keyed
   * by the neurotype they belong to, so the plan can describe accommodations.
   */
  neurotype_attributes: Array<{ neurotype: string; kind: 'trait' | 'need' | 'support'; label: string; notes: string | null }>;
  medications: Array<{
    name: string;
    dose_amount: string | null;
    dose_unit: string | null;
    route: string | null;
    frequency: string | null;
    schedule_times: string | null;
    as_needed: boolean;
    active: boolean;
    for_condition: string | null;
  }>;
  treatments: Array<{
    name: string;
    category: string | null;
    frequency: string | null;
    as_needed: boolean;
    active: boolean;
    for_condition: string | null;
  }>;
  providers: Array<{
    name: string;
    provider_type: string | null;
    organisation: string | null;
    phone: string | null;
    email: string | null;
  }>;
  emergency_contacts: Array<{ name: string; relationship: string | null; phone: string | null }>;
  recent_care_logs: Array<{ entry_type: string; title: string | null; body: string; occurred_at: string }>;
}

export async function gatherNarrativeSources(profileId: string): Promise<NarrativeSources> {
  const [profile, conditions, meds, treatments, allergies, plan, providers, logs] = await Promise.all([
    db('care_profiles').where({ id: profileId }).first(),
    db('medical_conditions').where({ care_profile_id: profileId }).orderBy('name'),
    db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .where('m.care_profile_id', profileId)
      .select('m.*', 'c.name as name'),
    db('treatments').where({ care_profile_id: profileId }),
    db('allergies').where({ care_profile_id: profileId }).orderBy('substance'),
    db('care_plans').where({ care_profile_id: profileId }).first(),
    db('care_profile_providers as cpp')
      .join('providers as p', 'cpp.provider_id', 'p.id')
      .where({ 'cpp.care_profile_id': profileId })
      .orderBy('p.name')
      .select('p.name', 'p.provider_type', 'p.organisation', 'p.phone', 'p.email'),
    db('care_log_entries')
      .where({ care_profile_id: profileId })
      .orderBy('occurred_at', 'desc')
      .limit(20),
  ]);
  const conditionNameById = new Map<string, string>(conditions.map((c) => [c.id as string, c.name as string]));
  // Neurotype traits, needs and supports, so the plan describes accommodations
  // rather than treating neurodivergence as something to manage.
  const neurotypeIds = conditions.filter((c) => c.category === 'neurotype').map((c) => c.id as string);
  const attrRows = neurotypeIds.length
    ? await db('neurotype_attributes as na')
        .join('neurotype_attribute_catalogue as nac', 'na.catalogue_id', 'nac.id')
        .whereIn('na.condition_id', neurotypeIds)
        .orderBy('na.sort_order', 'asc')
        .select('na.condition_id', 'na.notes', 'nac.kind', 'nac.label')
    : [];
  const medsByCondition = new Map<string, string[]>();
  for (const m of meds) {
    if (!m.medical_condition_id) continue;
    medsByCondition.set(m.medical_condition_id, [...(medsByCondition.get(m.medical_condition_id) ?? []), m.name]);
  }
  const treatmentsByCondition = new Map<string, string[]>();
  for (const t of treatments) {
    if (!t.medical_condition_id) continue;
    treatmentsByCondition.set(t.medical_condition_id, [
      ...(treatmentsByCondition.get(t.medical_condition_id) ?? []),
      t.name,
    ]);
  }
  const contacts = ((): Array<{ name?: string; relationship?: string; phone?: string }> => {
    const raw = plan?.emergency_contacts;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  })();
  return {
    name: profile?.full_name ?? 'this person',
    display_name: profile?.preferred_name ?? profile?.first_name ?? profile?.full_name ?? 'this person',
    self_managed: isSelfManaged({
      kind: profile?.kind ?? 'person',
      contact_kind: profile?.contact_kind ?? null,
      owner_relationship: profile?.owner_relationship ?? null,
    }),
    conditions: conditions.map((c) => ({
      name: c.name,
      status: c.status ?? null,
      severity: c.severity ?? null,
      category: c.category ?? null,
      condition_type: c.condition_type ?? null,
      started_on: dateOnly(c.started_on),
      resolved_on: dateOnly(c.resolved_on),
      contagious: !!c.is_contagious,
      neurotype: c.neurotype ?? null,
      diagnosis_status: c.diagnosis_status ?? null,
      medications: medsByCondition.get(c.id) ?? [],
      treatments: treatmentsByCondition.get(c.id) ?? [],
    })),
    allergies: allergies.map((a) => ({ substance: a.substance, reaction: a.reaction ?? null })),
    dietary_requirements: asStringArray(plan?.dietary_requirements),
    mobility_aids: asStringArray(plan?.mobility_aids),
    communication_needs: asStringArray(plan?.communication_needs),
    neurotype_attributes: attrRows.map((a) => ({
      neurotype: conditionNameById.get(a.condition_id as string) ?? 'neurotype',
      kind: a.kind as 'trait' | 'need' | 'support',
      label: a.label as string,
      notes: (a.notes as string | null) ?? null,
    })),
    medications: meds.map((m) => ({
      name: m.name,
      dose_amount: m.dose_amount ?? null,
      dose_unit: m.dose_unit ?? null,
      route: m.route ?? null,
      frequency: m.frequency ?? null,
      schedule_times: asStringArray(m.schedule_times).join(', ') || null,
      as_needed: !!m.as_needed,
      active: !!m.active,
      for_condition: m.medical_condition_id ? conditionNameById.get(m.medical_condition_id) ?? null : null,
    })),
    treatments: treatments.map((t) => ({
      name: t.name,
      category: t.category ?? null,
      frequency: t.frequency ?? null,
      as_needed: !!t.as_needed,
      active: !!t.active,
      for_condition: t.medical_condition_id ? conditionNameById.get(t.medical_condition_id) ?? null : null,
    })),
    providers: providers.map((p) => ({
      name: p.name,
      provider_type: p.provider_type ?? null,
      organisation: p.organisation ?? null,
      phone: p.phone ?? null,
      email: p.email ?? null,
    })),
    emergency_contacts: contacts
      .filter((c) => c.name)
      .map((c) => ({ name: c.name!, relationship: c.relationship ?? null, phone: c.phone ?? null })),
    recent_care_logs: logs.map((l) => ({
      entry_type: l.entry_type,
      title: l.title ?? null,
      body: String(l.body ?? '').slice(0, 500),
      occurred_at: new Date(l.occurred_at).toISOString(),
    })),
  };
}

const narrativeSchema = z.object({
  goals: z
    .array(
      z.object({
        goal: z.string().min(1).max(500),
        basis: z.string().max(500).optional().nullable(),
      })
    )
    .max(10),
  strategies: z
    .array(
      z.object({
        condition: z.string().max(255).optional().nullable(),
        goal: z.string().min(1).max(500),
        strategy: z.string().min(1).max(1000),
        // The step-by-step method a carer follows to carry the strategy out:
        // who does what, when, how, with what, and what to check. This is what
        // makes the plan an instruction manual rather than a summary.
        method: z.string().max(2000).optional().nullable(),
        supported_by: z.string().max(500).optional().nullable(),
      })
    )
    .max(15),
  risks: z
    .array(
      z.object({
        risk: z.string().min(1).max(500),
        level: z.enum(['high', 'medium', 'low']),
        source: z.string().max(255).optional().nullable(),
        watch_for: z.string().max(500).optional().nullable(),
      })
    )
    .max(15),
  review_triggers: z
    .array(
      z.object({
        trigger: z.string().min(1).max(500),
        action: z.string().max(500).optional().nullable(),
      })
    )
    .max(10),
});
type Narrative = z.infer<typeof narrativeSchema>;

/**
 * The narrative every plan gets even with no AI configured: goals from
 * the recorded conditions and needs, strategies from the recorded
 * condition-to-treatment ties, risks from allergies and condition flags,
 * and the standard Support at Home review triggers.
 */
export function fallbackNarrative(src: NarrativeSources): Narrative {
  const first = src.display_name;
  const goals: Narrative['goals'] = [];
  const liveConditions = src.conditions.filter((c) => c.status !== 'resolved');
  // Neurodivergence is intrinsic, not a condition to manage, so it is kept out
  // of the "manage X" goals and strategies and given its own accommodation.
  const managed = liveConditions.filter((c) => c.category !== 'neurotype');
  const neurotypes = liveConditions.filter((c) => c.category === 'neurotype');
  for (const c of managed) {
    goals.push({ goal: `Manage ${c.name}`, basis: `Recorded condition${c.status ? `, currently ${c.status}` : ''}` });
  }
  for (const c of neurotypes) {
    goals.push({
      goal: `Support and accommodate ${first}'s sensory, cognitive and social needs`,
      basis: `${c.name}${c.diagnosis_status === 'formal' ? ', formally diagnosed' : ''}: intrinsic to who ${first} is, supported rather than treated`,
    });
  }
  for (const d of src.dietary_requirements) {
    goals.push({ goal: `Keep to a ${d.toLowerCase()} diet`, basis: 'Recorded dietary requirement' });
  }
  for (const m of src.mobility_aids) {
    goals.push({ goal: `Stay mobile and independent with the ${m.toLowerCase()}`, basis: 'Recorded mobility aid' });
  }
  if (goals.length === 0) {
    goals.push({
      goal: `Maintain ${src.name}'s health, independence and quality of life at home`,
      basis: 'Default goal. Record conditions and day-to-day needs to personalise it.',
    });
  }

  const self = src.self_managed;
  const managedStrategies: Narrative['strategies'] = managed.map((c) => {
    const parts: string[] = [];
    if (c.medications.length > 0) parts.push(`Medication: ${c.medications.join(', ')}`);
    if (c.treatments.length > 0) parts.push(`Therapy: ${c.treatments.join(', ')}`);
    // A plain, ordered method, addressed to whoever carries it out: the
    // person themselves when they self-manage, otherwise their carers.
    const steps: string[] = [];
    if (c.medications.length > 0) {
      steps.push(`${self ? 'Take' : `Give ${first}`} the medications for ${c.name} at their scheduled times: ${c.medications.join(', ')}`);
      steps.push(self ? 'Record each dose as taken on the Medications record' : `Watch ${first} take each dose, then record it as given on the Medications record`);
    }
    if (c.treatments.length > 0) {
      steps.push(`Carry out the treatments as recorded: ${c.treatments.join(', ')}`);
    }
    steps.push(self ? `Note any change in ${c.name} in the care log, and seek help if it worsens` : `Note any change in ${c.name} in the care log, and escalate if it worsens`);
    // What supports this condition is its own medications and treatments, not
    // an unrelated dietary requirement.
    const supporting = [...c.medications, ...c.treatments];
    return {
      condition: c.name,
      goal: `Manage ${c.name}`,
      strategy: parts.length > 0 ? parts.join('. ') : 'Monitoring. No linked medication or treatment is recorded yet.',
      method: steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
      supported_by: supporting.length > 0 ? supporting.join(', ') : null,
    };
  });

  const neurotypeStrategies: Narrative['strategies'] = neurotypes.map((c) => {
    const attrs = src.neurotype_attributes.filter((a) => a.neurotype === c.name);
    const fmt = (a: { label: string; notes: string | null }) => (a.notes ? `${a.label} (${a.notes})` : a.label);
    const traits = attrs.filter((a) => a.kind === 'trait');
    const needs = attrs.filter((a) => a.kind === 'need');
    const supports = attrs.filter((a) => a.kind === 'support');
    const steps: string[] = [];
    if (traits.length > 0) steps.push(`Understand how ${c.name.toLowerCase()} shows up for ${first}: ${traits.map(fmt).join('; ')}`);
    if (needs.length > 0) steps.push(`Make sure these needs are met: ${needs.map(fmt).join('; ')}`);
    if (supports.length > 0) steps.push(`Put in place what helps ${first}: ${supports.map(fmt).join('; ')}`);
    if (steps.length === 0) {
      steps.push(`Ask ${first} what helps day to day, and record their traits, needs and supports on the Neurotypes page so this plan can be specific to them`);
    }
    steps.push(`Accommodate ${first}, do not try to change them: the aim is to support how they experience the world, never to treat or fix it`);
    return {
      condition: c.name,
      goal: `Support and accommodate ${first}'s ${c.name.toLowerCase()} needs`,
      strategy: `${c.name} is intrinsic to who ${first} is. The approach is accommodation of ${first}'s sensory, cognitive and social needs, not treatment or monitoring.`,
      method: steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
      supported_by: supports.length > 0 ? supports.map((s) => s.label).join(', ') : null,
    };
  });

  const strategies: Narrative['strategies'] = [...managedStrategies, ...neurotypeStrategies];

  const risks: Narrative['risks'] = [];
  for (const a of src.allergies) {
    risks.push({
      risk: `Allergy to ${a.substance}`,
      level: 'high',
      source: 'Allergies',
      watch_for: a.reaction ? `Must not be given ${a.substance}. Reaction: ${a.reaction}` : `Must not be given ${a.substance}`,
    });
  }
  for (const c of managed) {
    if (c.contagious) {
      risks.push({
        risk: `${c.name} is contagious`,
        level: 'medium',
        source: 'Conditions',
        watch_for: 'Follow hygiene and isolation guidance until it resolves',
      });
    }
    if (c.severity === 'severe' || c.severity === 'profound') {
      risks.push({
        risk: `${c.name} is ${c.severity}`,
        level: 'high',
        source: 'Conditions',
        watch_for: 'Escalate promptly if it worsens',
      });
    }
  }

  const review_triggers: Narrative['review_triggers'] = [
    { trigger: 'A hospital admission, a fall, or another significant health event', action: 'Review the plan straight away' },
    { trigger: 'A new diagnosis, or a recorded condition worsens or changes status', action: 'Review the affected goals and strategies' },
    { trigger: 'A new medication, a medication change, or a new allergy is recorded', action: 'Review medication strategies and risks' },
    { trigger: 'A dietary requirement or day-to-day need can no longer be met', action: 'Review the supports behind the affected goal' },
  ];

  return { goals, strategies, risks, review_triggers };
}

/**
 * The plan editor. When an AI provider is configured it synthesizes the
 * narrative from the recorded facts and recent care log entries, and must
 * return strict machine-readable JSON; anything malformed falls back to
 * the deterministic narrative. The factual sections stay authoritative
 * either way — the narrative interprets, it never contradicts the record
 * as stored.
 */
async function synthesizeNarrative(profileId: string): Promise<Record<NarrativeSection, PlanEntry[]>> {
  const src = await gatherNarrativeSources(profileId);
  let narrative = fallbackNarrative(src);

  try {
    const { isAiConfigured, complete } = await import('./aiProvider');
    const { toneGuidance } = await import('./aiTone');
    const profile = await db('care_profiles')
      .where({ id: profileId })
      .select('kind', 'contact_kind', 'owner_relationship', 'preferred_name', 'first_name', 'full_name')
      .first();
    const planName = profile?.preferred_name ?? profile?.first_name ?? profile?.full_name ?? src.name;
    if (isAiConfigured()) {
      const system =
        'You are the care plan editor for a care coordination platform. You synthesize the recorded ' +
        'facts into the clinical narrative of a care plan meeting frameworks like the Australian ' +
        "Government's Support at Home program. The plan is an INSTRUCTION MANUAL: it must tell a carer " +
        'not just what to do, but exactly HOW to do it, so someone who has never met the person could ' +
        'follow it. Requirements: ' +
        "1) GOALS: state the person's goals, preferences and choices up front, specific to them, " +
        'never generic (e.g. "maintain functional independence with the walking frame", "manage ' +
        'Hypertension", "enjoy a low-salt diet"). ' +
        '2) STRATEGIES: for each condition or goal, name the strategy (the services, medications or ' +
        'treatments that address it), and give a "method": the step-by-step way a carer carries it out. ' +
        'The method must be concrete and practical, ordered steps where it helps, naming who does what, ' +
        'when, how, with what, and what to check or watch for afterwards (e.g. method for a morning ' +
        'medication round: "1. Wash hands. 2. Check the blister pack for the 08:00 dose. 3. Give ' +
        'Amlodipine 5mg and Perindopril 4mg with a full glass of water while seated. 4. Watch them ' +
        'swallow. 5. Record the dose as given. 6. Check both ankles for swelling and note anything ' +
        'unusual"). Use only the medications, doses, routes and schedules actually in the record. ' +
        '3) RISKS: proactively infer risks from the allergies, conditions, medications and recent care ' +
        'log entries, each with a level (high/medium/low), its source, and what carers should watch ' +
        'for (e.g. oedema associated with Amlodipine intake requires vigilance during morning routines). ' +
        '4) REVIEW TRIGGERS: list the concrete events that must trigger a plan review before the ' +
        'standard 12-month review (hospital admission, fall, new diagnosis, a condition status change, ' +
        'a breach of a dietary requirement, a significant care log incident). ' +
        'NEURODIVERGENCE: a neurotype (autism, ADHD, dyslexia and so on) is intrinsic to who the person ' +
        'is, like eye colour, and is NOT a condition to manage, monitor, treat or cure. Never write ' +
        '"manage <neurotype>", never say a neurotype is "currently active", and never list it among ' +
        'conditions or risks. For each neurotype, write the goal and strategy about accommodating the ' +
        "person's sensory, cognitive and social needs, drawing ONLY on their recorded traits, needs and " +
        'supports (the neurotype_attributes in the data); if none are recorded, say to ask the person and ' +
        'record their traits, needs and supports. The aim is accommodation, never changing the person. ' +
        'DIET: a dietary requirement (e.g. low salt) is its own goal, not a universal support. Do NOT put ' +
        'a diet in the "supported_by" of conditions it is not clinically relevant to; "supported_by" is ' +
        "the medications, treatments or services for THAT condition. Low salt supports blood pressure, not " +
        'depression, dry eyes, a cold or a neurotype. ' +
        'Write in plain language a family carer can follow; refer to the person by name; never invent ' +
        'facts, medications or doses that are not in the data. Return ONLY strict JSON, no prose, matching: ' +
        '{"goals":[{"goal":"...","basis":"..."}],' +
        '"strategies":[{"condition":"...","goal":"...","strategy":"...","method":"step-by-step how-to","supported_by":"..."}],' +
        '"risks":[{"risk":"...","level":"high|medium|low","source":"...","watch_for":"..."}],' +
        '"review_triggers":[{"trigger":"...","action":"..."}]}\n' +
        toneGuidance(profile ?? { kind: 'person', contact_kind: null, owner_relationship: null }, planName);
      const result = await complete(system, [{ role: 'user', content: JSON.stringify(src) }], 4096, 'chat');
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = narrativeSchema.safeParse(JSON.parse(jsonMatch[0]));
        if (parsed.success) narrative = parsed.data;
      }
    }
  } catch (err) {
    console.warn('Care plan narrative synthesis failed, using deterministic narrative:', (err as Error).message);
  }

  // The standard review anchor is never left to the model: at least every
  // 12 months from this version.
  const due = new Date();
  due.setMonth(due.getMonth() + 12);

  const dedup = (entries: PlanEntry[]): PlanEntry[] => {
    const seen = new Set<string>();
    return entries.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
  };

  return {
    goals: dedup(
      narrative.goals.map((g) => ({
        key: `goals:${slug(g.goal)}`,
        fields: { goal: g.goal, basis: g.basis ?? null },
      }))
    ),
    strategies: dedup(
      narrative.strategies.map((s) => ({
        key: `strategies:${slug(s.condition ?? s.goal)}`,
        fields: {
          condition: s.condition ?? null,
          goal: s.goal,
          strategy: s.strategy,
          method: s.method ?? null,
          supported_by: s.supported_by ?? null,
        },
      }))
    ),
    risks: dedup(
      narrative.risks.map((r) => ({
        key: `risks:${slug(r.risk)}`,
        fields: { risk: r.risk, level: r.level, source: r.source ?? null, watch_for: r.watch_for ?? null },
      }))
    ),
    review: dedup([
      {
        key: 'review:standard',
        fields: {
          review_type: 'Standard',
          due_by: due.toISOString().slice(0, 10),
          reason: 'Reviewed with the participant at least once every 12 months',
        },
      },
      ...narrative.review_triggers.map((t) => ({
        key: `review:trigger:${slug(t.trigger)}`,
        fields: { review_type: 'Triggered', trigger: t.trigger, action: t.action ?? null },
      })),
    ]),
  };
}

// ---------------------------------------------------------------------------
// LLM delta proposal, validated against the deterministic diff

const deltaSchema = z.object({
  ops: z
    .array(
      z.object({
        op: z.enum(['add', 'modify', 'remove']),
        section: z.enum(PLAN_SECTIONS),
        key: z.string().min(1).max(255),
        fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      })
    )
    .max(200),
});

interface PendingEvent {
  id: string;
  source_table: string;
  action: string;
  summary: string | null;
  snapshot: unknown;
  created_at: Date;
}

/**
 * Ask the configured model for a minimal ordered delta. The reply must be
 * strict JSON matching deltaSchema. The proposal is only trusted for
 * ordering: each operation must also appear in the deterministic diff,
 * and field values are always taken from the database truth. Anything
 * the model invents is dropped; anything it misses is appended. So the
 * result is always exactly the true delta, at worst re-ordered.
 */
async function proposeDelta(
  events: PendingEvent[],
  current: PlanContent,
  truth: Record<string, PlanEntry[]>,
  sections: PlanSection[]
): Promise<DeltaOp[]> {
  const deterministic = diffOps(current, truth, sections);
  if (deterministic.length === 0) return [];

  let ordered: DeltaOp[] | null = null;
  try {
    const { isAiConfigured, complete } = await import('./aiProvider');
    if (isAiConfigured()) {
      const system =
        'You maintain a versioned care plan document. Given change events from the care record, ' +
        'the current plan entries and the up-to-date database entries for the affected sections, ' +
        'produce the MINIMAL ordered delta that brings the plan up to date. ' +
        'Only describe entries that are new, changed or removed. Never rewrite unchanged entries. ' +
        'Order operations by clinical importance: allergies first, then medications, then everything else. ' +
        'Return ONLY strict JSON, no prose, matching: ' +
        '{"ops":[{"op":"add|modify|remove","section":"<section>","key":"<entry key>","fields":{...}}]} ' +
        `Valid sections: ${PLAN_SECTIONS.join(', ')}. For remove operations omit fields.`;
      const user = JSON.stringify({
        events: events.map((e) => ({
          id: e.id,
          source_table: e.source_table,
          action: e.action,
          summary: e.summary,
        })),
        current_entries: Object.fromEntries(sections.map((s) => [s, current.sections[s] ?? []])),
        database_entries: Object.fromEntries(sections.map((s) => [s, truth[s] ?? []])),
      });
      const result = await complete(system, [{ role: 'user', content: user }], 4096, 'chat');
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = deltaSchema.safeParse(JSON.parse(jsonMatch[0]));
        if (parsed.success) ordered = parsed.data.ops as DeltaOp[];
      }
    }
  } catch (err) {
    console.warn('Care plan LLM delta failed, using deterministic diff:', (err as Error).message);
  }

  if (!ordered) return deterministic;

  // Reconcile: keep the model's ordering for operations it got right,
  // with field values always replaced by the database truth.
  const opKey = (o: DeltaOp) => `${o.op}|${o.section}|${o.key}`;
  const detByKey = new Map(deterministic.map((o) => [opKey(o), o]));
  const result: DeltaOp[] = [];
  const seen = new Set<string>();
  for (const o of ordered) {
    const k = opKey(o);
    const trueOp = detByKey.get(k);
    if (trueOp && !seen.has(k)) {
      result.push(trueOp);
      seen.add(k);
    }
  }
  for (const o of deterministic) {
    const k = opKey(o);
    if (!seen.has(k)) result.push(o);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Applying a delta

function applyOps(content: PlanContent, ops: DeltaOp[]): PlanContent {
  const sections: Record<string, PlanEntry[]> = {};
  for (const [name, entries] of Object.entries(content.sections)) {
    sections[name] = entries.map((e) => ({ key: e.key, fields: { ...e.fields } }));
  }
  for (const op of ops) {
    const list = sections[op.section] ?? (sections[op.section] = []);
    const idx = list.findIndex((e) => e.key === op.key);
    if (op.op === 'remove') {
      if (idx >= 0) list.splice(idx, 1);
    } else if (op.op === 'add') {
      if (idx >= 0) list[idx] = { key: op.key, fields: op.fields ?? {} };
      else list.push({ key: op.key, fields: op.fields ?? {} });
    } else {
      if (idx >= 0) list[idx] = { key: op.key, fields: op.fields ?? {} };
      else list.push({ key: op.key, fields: op.fields ?? {} });
    }
  }
  return { sections };
}

const contentHash = (version: number, content: PlanContent): string =>
  createHash('sha256').update(JSON.stringify({ version, content })).digest('hex');

// ---------------------------------------------------------------------------
// Human-readable changelog

const entryName = (fields: PlanEntry['fields'] | undefined | null): string => {
  if (!fields) return '';
  const v =
    fields['substance'] ??
    fields['name'] ??
    fields['goal'] ??
    fields['risk'] ??
    fields['trigger'] ??
    fields['condition'] ??
    fields['review_type'] ??
    fields['value'] ??
    fields['location'] ??
    '';
  return typeof v === 'string' ? v : String(v ?? '');
};

function describeOp(op: DeltaOp, before?: PlanEntry['fields'] | null): string {
  const section = SECTION_LABELS[op.section as PlanSection] ?? op.section;
  const name = entryName(op.fields) || entryName(before) || op.key;
  if (op.op === 'add') return `Added to ${section}: ${name}`;
  if (op.op === 'remove') return `Removed from ${section}: ${name}`;
  const changed: string[] = [];
  if (before && op.fields) {
    for (const [field, after] of Object.entries(op.fields)) {
      const prev = before[field];
      if (JSON.stringify(prev) !== JSON.stringify(after)) {
        changed.push(`${field.replace(/_/g, ' ')}: ${prev ?? 'not set'} to ${after ?? 'not set'}`);
      }
    }
  }
  return `Updated in ${section}: ${name}${changed.length ? ` (${changed.join('; ')})` : ''}`;
}

// ---------------------------------------------------------------------------
// Rendering the stored document

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const fieldLabel = (f: string): string => f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function renderHtml(
  profileName: string,
  version: number,
  hash: string,
  createdAt: Date,
  content: PlanContent,
  changelog: string | null,
  report: string
): string {
  const sections = PLAN_SECTIONS.filter((s) => (content.sections[s] ?? []).length > 0)
    .map((s) => {
      const entries = content.sections[s] ?? [];
      const fieldNames = [...new Set(entries.flatMap((e) => Object.keys(e.fields)))];
      const head = fieldNames.map((f) => `<th>${esc(fieldLabel(f))}</th>`).join('');
      const rows = entries
        .map(
          (e) =>
            `<tr>${fieldNames
              .map((f) => {
                const v = e.fields[f];
                const text = v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
                return `<td>${esc(text)}</td>`;
              })
              .join('')}</tr>`
        )
        .join('');
      return `<h2>${esc(SECTION_LABELS[s])}</h2><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Care plan for ${esc(profileName)}, version ${version}</title>
<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.5}
h1{font-size:1.5rem;margin-bottom:0}h2{font-size:1.05rem;margin-top:1.5rem}h3{font-size:.95rem;margin-top:1rem}
.masthead{margin:.1rem 0;font-size:1rem}table{border-collapse:collapse;width:100%;font-size:.85rem}
th,td{border:1px solid #ccc;padding:.35rem .5rem;text-align:left}th{background:#f3f3f3}
.meta{color:#666;font-size:.8rem}.changes{white-space:pre-wrap;font-size:.85rem;background:#f8f8f8;padding:.75rem;border-radius:.375rem}
.appendix{margin-top:2.5rem;border-top:2px solid #ccc;padding-top:1rem}</style>
</head><body>
${reportToHtml(report)}
<p class="meta">Integrity hash SHA-256 ${hash} &middot; Created ${createdAt.toISOString()}</p>
<div class="appendix">
<h2>Appendix: data record</h2>
<p class="meta">The structured facts this report was written from, one column per data point.</p>
${changelog ? `<h2>What changed in this version</h2><div class="changes">${esc(changelog)}</div>` : ''}
${sections}
</div>
<p class="meta">Document generated by PareCare. Version ${version}. SHA-256 ${hash}.</p>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Version creation

export interface VersionRow {
  id: string;
  care_profile_id: string;
  version: number;
  status: string;
  content: PlanContent;
  content_hash: string;
  changelog: string | null;
  report: string | null;
  author_account_id: string | null;
  applied_event_ids: string[];
  document_id: string | null;
  restored_from_version: number | null;
  locked: boolean;
  created_at: Date;
  published_at: Date | null;
}

export const parseContent = (raw: unknown): PlanContent => {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const sections = (value as PlanContent | null)?.sections;
  return { sections: sections && typeof sections === 'object' ? sections : {} };
};

export const parseIds = (raw: unknown): string[] => {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(value) ? value.map(String) : [];
};

async function latestVersion(profileId: string): Promise<VersionRow | null> {
  const row = await db('care_plan_versions')
    .where({ care_profile_id: profileId })
    .orderBy('version', 'desc')
    .first();
  if (!row) return null;
  return { ...row, content: parseContent(row.content), applied_event_ids: parseIds(row.applied_event_ids) };
}

async function profileName(profileId: string): Promise<string> {
  const profile = await db('care_profiles').where({ id: profileId }).first();
  return profile?.full_name ?? 'this person';
}

interface CreateVersionInput {
  profileId: string;
  actorId: string | null;
  base: VersionRow | null;
  ops: DeltaOp[];
  content: PlanContent;
  eventIds: string[];
  status: 'published' | 'awaiting_signoff';
  changelog: string;
  restoredFromVersion?: number | null;
}

/**
 * Atomically writes the new version: the stored document, the version
 * row, the ordered change rows with provenance, and the processed marks
 * on the applied events. Everything or nothing.
 */
async function createVersion(input: CreateVersionInput): Promise<VersionRow> {
  const versionNumber = (input.base?.version ?? 0) + 1;
  const hash = contentHash(versionNumber, input.content);
  const name = await profileName(input.profileId);
  const createdAt = new Date();
  // The prose clinical report: the same data structure written as a
  // narrative document. Composed fresh for every version.
  const report = await composeReport({
    profileName: name,
    version: versionNumber,
    createdAt,
    content: input.content,
    sources: await gatherNarrativeSources(input.profileId),
  });
  const html = renderHtml(name, versionNumber, hash, createdAt, input.content, input.changelog, report);
  const fileUrl = await uploadFile(
    Buffer.from(html, 'utf8'),
    `${input.profileId}/care-plan-v${versionNumber}-${hash.slice(0, 12)}.html`,
    'text/html'
  );

  try {
    return await db.transaction(async (trx) => {
      const [doc] = await trx('documents')
        .insert({
          care_profile_id: input.profileId,
          category: 'care_plan',
          label: `Care plan version ${versionNumber}`,
          file_url: fileUrl,
          file_size_bytes: Buffer.byteLength(html, 'utf8'),
          mime_type: 'text/html',
          visible_to_roles: [],
        })
        .returning('*');

      const beforeByKey = new Map<string, PlanEntry>();
      for (const entries of Object.values(input.base?.content.sections ?? {})) {
        for (const e of entries) beforeByKey.set(e.key, e);
      }

      const [version] = await trx('care_plan_versions')
        .insert({
          care_profile_id: input.profileId,
          version: versionNumber,
          status: input.status,
          content: trx.raw('?::jsonb', [JSON.stringify(input.content)]),
          content_hash: hash,
          changelog: input.changelog || null,
          report,
          author_account_id: input.actorId,
          applied_event_ids: trx.raw('?::jsonb', [JSON.stringify(input.eventIds)]),
          document_id: doc.id,
          restored_from_version: input.restoredFromVersion ?? null,
          published_at: input.status === 'published' ? trx.fn.now() : null,
        })
        .returning('*');

      if (input.ops.length > 0) {
        await trx('care_plan_changes').insert(
          input.ops.map((op, i) => ({
            version_id: version.id,
            position: i,
            op: op.op,
            section: op.section,
            entry_key: op.key,
            before: trx.raw('?::jsonb', [JSON.stringify(beforeByKey.get(op.key)?.fields ?? null)]),
            after: trx.raw('?::jsonb', [JSON.stringify(op.fields ?? null)]),
            source_event_ids: trx.raw('?::jsonb', [JSON.stringify(input.eventIds)]),
          }))
        );
      }

      if (input.eventIds.length > 0) {
        await trx('care_plan_events').whereIn('id', input.eventIds).update({ processed_at: trx.fn.now() });
      }

      return { ...version, content: input.content, applied_event_ids: input.eventIds };
    });
  } catch (err) {
    // The version write failed after the file was stored — clean it up.
    await deleteFile(fileUrl).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public entry points

export async function pendingEvents(profileId: string): Promise<PendingEvent[]> {
  return db('care_plan_events')
    .where({ care_profile_id: profileId })
    .whereNull('processed_at')
    .orderBy('created_at', 'asc');
}

/**
 * First run: assembles version 1 as the complete baseline from the source
 * tables and marks any queued events as covered by it.
 */
export async function generateBaseline(profileId: string, actorId: string | null): Promise<VersionRow> {
  const factual = await buildTruth(profileId, [...FACTUAL_SECTIONS]);
  const narrative = await synthesizeNarrative(profileId);
  // Sections are stored in presentation order: narrative first.
  const truth: Record<string, PlanEntry[]> = {};
  for (const s of PLAN_SECTIONS) truth[s] = (narrative as Record<string, PlanEntry[]>)[s] ?? factual[s] ?? [];
  const content: PlanContent = { sections: truth };
  const events = await pendingEvents(profileId);
  const empty: PlanContent = { sections: {} };
  const ops = diffOps(empty, truth, [...PLAN_SECTIONS]);
  const changelog = ['Version 1: initial care plan generated from the care record.']
    .concat(ops.map((op) => describeOp(op)))
    .join('\n');
  return createVersion({
    profileId,
    actorId,
    base: null,
    ops,
    content,
    eventIds: events.map((e) => e.id),
    status: 'published',
    changelog,
  });
}

export interface UpdateResult {
  version: VersionRow | null;
  applied: number;
  status: 'no_changes' | 'published' | 'awaiting_signoff';
}

/**
 * Applies all pending events as one minimal delta on top of the latest
 * version. Idempotent: events are applied exactly once, and operations
 * that would not change the plan are dropped. High-risk or unusually
 * large deltas, and any update on top of a signed version, produce a
 * version awaiting sign-off instead of an automatically published one.
 */
export async function applyPending(profileId: string, actorId: string | null): Promise<UpdateResult> {
  const base = await latestVersion(profileId);
  if (!base) {
    const version = await generateBaseline(profileId, actorId);
    return { version, applied: version.applied_event_ids.length, status: 'published' };
  }
  if (base.status === 'awaiting_signoff') {
    throw Object.assign(new Error('A version is already awaiting sign-off. Approve or reject it first.'), {
      status: 409,
      code: 'PLAN_AWAITING_SIGNOFF',
    });
  }

  const events = await pendingEvents(profileId);
  if (events.length === 0) return { version: null, applied: 0, status: 'no_changes' };

  const touched = [
    ...new Set(events.flatMap((e) => SECTIONS_BY_SOURCE[e.source_table] ?? [])),
  ] as FactualSection[];
  const truth = await buildTruth(profileId, touched);
  const factualOps = await proposeDelta(events, base.content, truth, touched);

  // The narrative is re-synthesized whenever the facts changed, or when a
  // care log entry arrived (incidents feed the risk narrative). Its delta
  // is diffed and recorded like any other change, so goals, strategies,
  // risks and review triggers evolve incrementally too.
  const afterFacts = applyOps(base.content, factualOps);
  let narrativeOps: DeltaOp[] = [];
  if (factualOps.length > 0 || events.some((e) => e.source_table === 'log')) {
    const narrative = await synthesizeNarrative(profileId);
    narrativeOps = diffOps(afterFacts, narrative, [...NARRATIVE_SECTIONS]);
  }
  const ops = [...factualOps, ...narrativeOps];

  const eventIds = events.map((e) => e.id);
  if (ops.length === 0) {
    // The events cancelled out (e.g. add then delete). Mark them applied
    // so they are never offered again — idempotency without a new version.
    await db('care_plan_events').whereIn('id', eventIds).update({ processed_at: db.fn.now() });
    return { version: null, applied: events.length, status: 'no_changes' };
  }

  // Only factual operations count towards the review rules: the narrative
  // legitimately rewords several entries whenever a fact changes.
  const highRisk = factualOps.some(
    (op) => op.op !== 'add' && HIGH_RISK_SECTIONS.has(op.section as PlanSection)
  );
  const needsReview = highRisk || factualOps.length > LARGE_DELTA_OPS || base.locked;
  const status: 'published' | 'awaiting_signoff' = needsReview ? 'awaiting_signoff' : 'published';

  const beforeByKey = new Map<string, PlanEntry>();
  for (const entries of Object.values(base.content.sections)) {
    for (const e of entries) beforeByKey.set(e.key, e);
  }
  const changelog = ops.map((op) => describeOp(op, beforeByKey.get(op.key)?.fields ?? null)).join('\n');

  const content = applyOps(afterFacts, narrativeOps);
  const version = await createVersion({
    profileId,
    actorId,
    base,
    ops,
    content,
    eventIds,
    status,
    changelog,
  });
  return { version, applied: events.length, status };
}

/**
 * Reverting never rewrites history: it creates a new version whose
 * content restores the chosen prior version, with the restoring delta
 * recorded like any other change.
 */
export async function revertToVersion(
  profileId: string,
  targetVersion: number,
  actorId: string | null
): Promise<VersionRow> {
  const base = await latestVersion(profileId);
  if (!base) {
    throw Object.assign(new Error('No care plan exists yet.'), { status: 404, code: 'NOT_FOUND' });
  }
  const target = await db('care_plan_versions')
    .where({ care_profile_id: profileId, version: targetVersion })
    .first();
  if (!target) {
    throw Object.assign(new Error('That version does not exist.'), { status: 404, code: 'NOT_FOUND' });
  }
  const targetContent = parseContent(target.content);
  const truthLike: Record<string, PlanEntry[]> = {};
  for (const s of PLAN_SECTIONS) truthLike[s] = targetContent.sections[s] ?? [];
  const ops = diffOps(base.content, truthLike, [...PLAN_SECTIONS]);
  const changelog = [`Restored the plan to version ${targetVersion}.`]
    .concat(ops.map((op) => describeOp(op)))
    .join('\n');
  return createVersion({
    profileId,
    actorId,
    base,
    ops,
    content: targetContent,
    eventIds: [],
    status: 'published',
    changelog,
    restoredFromVersion: targetVersion,
  });
}

/**
 * Approves a version that was routed for human review, publishing it.
 */
export async function approveVersion(versionId: string, profileId: string): Promise<void> {
  const updated = await db('care_plan_versions')
    .where({ id: versionId, care_profile_id: profileId, status: 'awaiting_signoff' })
    .update({ status: 'published', published_at: db.fn.now() });
  if (!updated) {
    throw Object.assign(new Error('No version awaiting sign-off with that id.'), {
      status: 404,
      code: 'NOT_FOUND',
    });
  }
}

/**
 * Rejects a version awaiting sign-off: the version and its changes are
 * removed and its events are requeued so a corrected update can pick
 * them up later. Only the newest version can be rejected, so history
 * stays linear.
 */
export async function rejectVersion(versionId: string, profileId: string): Promise<void> {
  const row = await db('care_plan_versions')
    .where({ id: versionId, care_profile_id: profileId, status: 'awaiting_signoff' })
    .first();
  if (!row) {
    throw Object.assign(new Error('No version awaiting sign-off with that id.'), {
      status: 404,
      code: 'NOT_FOUND',
    });
  }
  const newest = await db('care_plan_versions')
    .where({ care_profile_id: profileId })
    .orderBy('version', 'desc')
    .first();
  if (newest.id !== row.id) {
    throw Object.assign(new Error('Only the newest version can be rejected.'), {
      status: 409,
      code: 'CONFLICT',
    });
  }
  const doc = row.document_id ? await db('documents').where({ id: row.document_id }).first() : null;
  await db.transaction(async (trx) => {
    await trx('care_plan_events')
      .whereIn('id', parseIds(row.applied_event_ids))
      .update({ processed_at: null });
    await trx('care_plan_versions').where({ id: row.id }).delete();
    if (doc) await trx('documents').where({ id: doc.id }).delete();
  });
  if (doc) await deleteFile(doc.file_url).catch(() => {});
}

/**
 * Wipes every care plan artifact for a profile: all versions (their
 * changes, signatures and review links cascade with them), all recorded
 * plan events, all explicit access grants, and the version documents
 * filed in Documents together with their stored files. The recorded
 * facts (allergies, conditions, medications, and so on) are untouched;
 * the next Generate starts again from a fresh version 1.
 */
export async function deleteCarePlan(profileId: string): Promise<number> {
  const versions = await db('care_plan_versions')
    .where({ care_profile_id: profileId })
    .select('id', 'document_id');
  const docIds = versions.map((v) => v.document_id).filter(Boolean) as string[];
  const docs = docIds.length ? await db('documents').whereIn('id', docIds).select('id', 'file_url') : [];
  await db.transaction(async (trx) => {
    await trx('care_plan_events').where({ care_profile_id: profileId }).delete();
    await trx('care_plan_versions').where({ care_profile_id: profileId }).delete();
    await trx('care_plan_access').where({ care_profile_id: profileId }).delete();
    if (docIds.length) await trx('documents').whereIn('id', docIds).delete();
  });
  for (const d of docs) {
    await deleteFile(d.file_url).catch(() => {});
  }
  return versions.length;
}

// ---------------------------------------------------------------------------
// First-run baseline gaps

export interface BaselineGaps {
  allergies: boolean;
  emergency_contacts: boolean;
  gp: boolean;
  needs: boolean;
}

/** Baseline facts still missing before the first plan is generated. */
export async function baselineGaps(profileId: string): Promise<BaselineGaps> {
  const [allergyCount, gpCount, plan] = await Promise.all([
    db('allergies').where({ care_profile_id: profileId }).count<{ count: string }[]>('id as count'),
    db('care_profile_providers as cpp')
      .join('providers as p', 'cpp.provider_id', 'p.id')
      .where({ 'cpp.care_profile_id': profileId, 'p.provider_type': 'gp' })
      .count<{ count: string }[]>('cpp.id as count'),
    db('care_plans').where({ care_profile_id: profileId }).first(),
  ]);
  const contacts = plan?.emergency_contacts;
  const contactList = Array.isArray(contacts) ? contacts : typeof contacts === 'string' ? JSON.parse(contacts || '[]') : [];
  const needsCount =
    asStringArray(plan?.dietary_requirements).length +
    asStringArray(plan?.mobility_aids).length +
    asStringArray(plan?.communication_needs).length;
  return {
    allergies: Number(allergyCount[0]?.count ?? 0) === 0,
    emergency_contacts: !Array.isArray(contactList) || contactList.length === 0,
    gp: Number(gpCount[0]?.count ?? 0) === 0,
    needs: needsCount === 0,
  };
}

export const newReviewToken = (): string => randomBytes(32).toString('hex');
