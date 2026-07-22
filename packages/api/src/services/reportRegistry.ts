import { Knex } from 'knex';
import { summarizeSpend, toNum, type SpendCategory } from './healthSpend';

export interface ReportField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'enum';
  enumValues?: string[];
}

export interface ReportFilter {
  key: string;
  label: string;
  type: 'text' | 'select' | 'multi-select' | 'date-range' | 'boolean';
  options?: { value: string; label: string }[];
}

export interface ReportSectionMeta {
  key: string;
  label: string;
  description: string;
  category: 'demographics' | 'health' | 'medications' | 'care' | 'admin';
  fields: ReportField[];
  filters: ReportFilter[];
  supportsDateRange: boolean;
  crossProfileCapable: boolean;
}

export interface SectionFetchOptions {
  profileIds: string[];
  fields: string[];
  filters: Record<string, unknown>;
  dateRange: { from: string; to: string } | null;
  db: Knex;
}

export interface SectionFetcher {
  meta: ReportSectionMeta;
  fetch: (opts: SectionFetchOptions) => Promise<Record<string, unknown>[]>;
}

const registry = new Map<string, SectionFetcher>();

export function registerSection(fetcher: SectionFetcher): void {
  registry.set(fetcher.meta.key, fetcher);
}

export function getSection(key: string): SectionFetcher | undefined {
  return registry.get(key);
}

export function getAllSections(): ReportSectionMeta[] {
  return Array.from(registry.values()).map((f) => f.meta);
}

export function getSectionFetcher(key: string): SectionFetcher['fetch'] | undefined {
  return registry.get(key)?.fetch;
}

// ── Section definitions ────────────────────────────────────────────────

registerSection({
  meta: {
    key: 'demographics',
    label: 'Demographics',
    description: 'Basic profile information including name, age, language, and care phase',
    category: 'demographics',
    fields: [
      { key: 'full_name', label: 'Full name', type: 'text' },
      { key: 'preferred_name', label: 'Preferred name', type: 'text' },
      { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
      { key: 'age', label: 'Age', type: 'number' },
      { key: 'pronouns', label: 'Pronouns', type: 'text' },
      { key: 'primary_language', label: 'Primary language', type: 'text' },
      { key: 'current_phase', label: 'Care phase', type: 'enum', enumValues: ['early_concern', 'home_with_support', 'increased_dependency', 'transition_to_residential', 'residential_ongoing', 'end_of_life'] },
      { key: 'kind', label: 'Profile type', type: 'enum', enumValues: ['person', 'pet'] },
      { key: 'species', label: 'Species', type: 'text' },
      { key: 'breed', label: 'Breed', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
    filters: [
      { key: 'kind', label: 'Profile type', type: 'select', options: [{ value: 'person', label: 'Person' }, { value: 'pet', label: 'Pet' }] },
      {
        key: 'current_phase', label: 'Care phase', type: 'multi-select', options: [
          { value: 'early_concern', label: 'Early concern' },
          { value: 'home_with_support', label: 'Home with support' },
          { value: 'increased_dependency', label: 'Increased dependency' },
          { value: 'transition_to_residential', label: 'Transition to residential' },
          { value: 'residential_ongoing', label: 'Residential ongoing' },
          { value: 'end_of_life', label: 'End of life' },
        ],
      },
    ],
    supportsDateRange: false,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, fields, filters, db }) {
    let query = db('care_profiles').whereIn('id', profileIds).where({ archived: false });
    if (filters['kind']) query = query.where('kind', String(filters['kind']));
    if (Array.isArray(filters['current_phase']) && filters['current_phase'].length) {
      query = query.whereIn('current_phase', filters['current_phase'] as string[]);
    }
    const rows = await query.select('*');
    return rows.map((r) => {
      const age = r.date_of_birth ? Math.floor((Date.now() - new Date(r.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
      const record: Record<string, unknown> = {
        _profile_id: r.id,
        _profile_name: r.full_name,
        full_name: r.full_name,
        preferred_name: r.preferred_name,
        date_of_birth: r.date_of_birth,
        age,
        pronouns: r.pronouns,
        primary_language: r.primary_language,
        current_phase: r.current_phase,
        kind: r.kind,
        species: r.species,
        breed: r.breed,
        notes: r.notes,
      };
      if (fields.length) {
        const keep = new Set([...fields, '_profile_id', '_profile_name']);
        for (const k of Object.keys(record)) {
          if (!keep.has(k)) delete record[k];
        }
      }
      return record;
    });
  },
});

registerSection({
  meta: {
    key: 'allergies',
    label: 'Allergies',
    description: 'Known allergies and reactions',
    category: 'health',
    fields: [
      { key: 'substance', label: 'Substance', type: 'text' },
      { key: 'reaction', label: 'Reaction', type: 'text' },
    ],
    filters: [],
    supportsDateRange: false,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, db }) {
    const rows = await db('allergies')
      .join('care_profiles', 'care_profiles.id', 'allergies.care_profile_id')
      .whereIn('allergies.care_profile_id', profileIds)
      .select('allergies.*', 'care_profiles.full_name as _profile_name')
      .orderBy('allergies.sort_order', 'asc');
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      substance: r.substance,
      reaction: r.reaction,
    }));
  },
});

registerSection({
  meta: {
    key: 'medical_conditions',
    label: 'Medical conditions',
    description: 'Diagnoses and ongoing conditions with status tracking',
    category: 'health',
    fields: [
      { key: 'name', label: 'Condition', type: 'text' },
      { key: 'status', label: 'Status', type: 'enum', enumValues: ['active', 'improving', 'managed', 'resolved'] },
      { key: 'is_temporary', label: 'Temporary', type: 'boolean' },
      { key: 'started_on', label: 'Started', type: 'date' },
      { key: 'resolved_on', label: 'Resolved', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
    filters: [
      {
        key: 'status', label: 'Status', type: 'multi-select', options: [
          { value: 'active', label: 'Active' },
          { value: 'improving', label: 'Improving' },
          { value: 'managed', label: 'Managed' },
          { value: 'resolved', label: 'Resolved' },
        ],
      },
      { key: 'is_temporary', label: 'Temporary only', type: 'boolean' },
    ],
    supportsDateRange: true,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, dateRange, db }) {
    let query = db('medical_conditions')
      .join('care_profiles', 'care_profiles.id', 'medical_conditions.care_profile_id')
      .whereIn('medical_conditions.care_profile_id', profileIds);
    if (Array.isArray(filters['status']) && filters['status'].length) {
      query = query.whereIn('medical_conditions.status', filters['status'] as string[]);
    }
    if (filters['is_temporary'] === true) query = query.where('medical_conditions.is_temporary', true);
    if (dateRange) {
      query = query.where(function () {
        this.where('medical_conditions.started_on', '>=', dateRange.from)
          .orWhereNull('medical_conditions.started_on');
      });
    }
    const rows = await query.select('medical_conditions.*', 'care_profiles.full_name as _profile_name')
      .orderBy('medical_conditions.sort_order', 'asc');
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      name: r.name,
      status: r.status,
      is_temporary: r.is_temporary,
      started_on: r.started_on,
      resolved_on: r.resolved_on,
      notes: r.notes,
    }));
  },
});

const CARE_LOG_TYPES = [
  'visit', 'medication', 'medical_appointment', 'phone_call',
  'decision_made', 'concern_raised', 'observation', 'handover',
] as const;
const SENTIMENT_LABELS: Record<number, string> = {
  1: 'Angry', 2: 'Sad', 3: 'Disappointed', 4: 'Neutral', 5: 'Happy', 6: 'Overjoyed',
};

registerSection({
  meta: {
    key: 'care_log',
    label: 'Care log',
    description: 'Logged visits, observations, handovers and concerns, with the emotional tone of each note',
    category: 'care',
    fields: [
      { key: 'occurred_at', label: 'When', type: 'date' },
      { key: 'entry_type', label: 'Type', type: 'text' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'body', label: 'Note', type: 'text' },
      { key: 'mood', label: 'Tone', type: 'text' },
    ],
    filters: [
      {
        key: 'entry_type', label: 'Type', type: 'multi-select',
        options: CARE_LOG_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })),
      },
    ],
    supportsDateRange: true,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, dateRange, db }) {
    let query = db('care_log_entries as cl')
      .join('care_profiles as cp', 'cp.id', 'cl.care_profile_id')
      .whereIn('cl.care_profile_id', profileIds);
    if (Array.isArray(filters['entry_type']) && filters['entry_type'].length) {
      query = query.whereIn('cl.entry_type', filters['entry_type'] as string[]);
    }
    if (dateRange) {
      query = query.where('cl.occurred_at', '>=', dateRange.from).andWhere('cl.occurred_at', '<', `${dateRange.to}T23:59:59.999Z`);
    }
    const rows = await query
      .select('cl.care_profile_id', 'cp.full_name as _profile_name', 'cl.occurred_at', 'cl.entry_type', 'cl.title', 'cl.body', 'cl.sentiment')
      .orderBy('cl.occurred_at', 'desc');
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      occurred_at: r.occurred_at,
      entry_type: r.entry_type,
      title: r.title,
      body: r.body,
      mood: r.sentiment != null ? SENTIMENT_LABELS[r.sentiment] ?? '' : '',
    }));
  },
});

registerSection({
  meta: {
    key: 'neurotype_attributes',
    label: 'Neurotype traits, needs and supports',
    description: 'What a person\'s neurodivergence looks like for them: recorded traits, needs and supports',
    category: 'health',
    fields: [
      { key: 'neurotype', label: 'Neurotype', type: 'text' },
      { key: 'kind', label: 'Kind', type: 'enum', enumValues: ['trait', 'need', 'support'] },
      { key: 'attribute', label: 'Item', type: 'text' },
      { key: 'domain', label: 'Area of life', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
    filters: [
      {
        key: 'kind', label: 'Kind', type: 'multi-select', options: [
          { value: 'trait', label: 'Traits' },
          { value: 'need', label: 'Needs' },
          { value: 'support', label: 'Supports' },
        ],
      },
    ],
    supportsDateRange: false,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, db }) {
    let query = db('neurotype_attributes as na')
      .join('neurotype_attribute_catalogue as nac', 'na.catalogue_id', 'nac.id')
      .join('medical_conditions as mc', 'mc.id', 'na.condition_id')
      .join('care_profiles as cp', 'cp.id', 'mc.care_profile_id')
      .whereIn('mc.care_profile_id', profileIds);
    if (Array.isArray(filters['kind']) && filters['kind'].length) {
      query = query.whereIn('nac.kind', filters['kind'] as string[]);
    }
    const rows = await query
      .select(
        'mc.care_profile_id',
        'cp.full_name as _profile_name',
        'mc.name as condition_name',
        'nac.kind',
        'nac.label',
        'nac.domain',
        'na.notes'
      )
      .orderBy([{ column: 'mc.name' }, { column: 'nac.kind' }, { column: 'na.sort_order' }]);
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      neurotype: r.condition_name,
      kind: r.kind,
      attribute: r.label,
      domain: r.domain ? String(r.domain).replace(/_/g, ' ') : null,
      notes: r.notes,
    }));
  },
});

registerSection({
  meta: {
    key: 'health_statuses',
    label: 'Health statuses',
    description: 'Current and past health events: illnesses, injuries, recovery periods with symptom tracking',
    category: 'health',
    fields: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'category', label: 'Category', type: 'enum', enumValues: ['illness', 'injury', 'post_operative', 'recovery', 'mental_health', 'chronic_flare', 'acute_illness', 'other'] },
      { key: 'status', label: 'Status', type: 'enum', enumValues: ['active', 'improving', 'managed', 'resolved'] },
      { key: 'onset_date', label: 'Onset date', type: 'date' },
      { key: 'actual_resolution_date', label: 'Resolved on', type: 'date' },
      { key: 'is_contagious', label: 'Contagious', type: 'boolean' },
      { key: 'isolation_required', label: 'Isolation required', type: 'boolean' },
      { key: 'region', label: 'Region or area', type: 'text' },
      { key: 'duration_days', label: 'Duration in days', type: 'number' },
      { key: 'symptoms', label: 'Symptoms', type: 'text' },
    ],
    filters: [
      {
        key: 'category', label: 'Category', type: 'multi-select', options: [
          { value: 'illness', label: 'Illness' },
          { value: 'injury', label: 'Injury' },
          { value: 'post_operative', label: 'Post-operative' },
          { value: 'recovery', label: 'Recovery' },
          { value: 'mental_health', label: 'Mental health' },
          { value: 'chronic_flare', label: 'Chronic flare' },
          { value: 'acute_illness', label: 'Acute illness' },
          { value: 'other', label: 'Other' },
        ],
      },
      {
        key: 'status', label: 'Status', type: 'multi-select', options: [
          { value: 'active', label: 'Active' },
          { value: 'improving', label: 'Improving' },
          { value: 'managed', label: 'Managed' },
          { value: 'resolved', label: 'Resolved' },
        ],
      },
      { key: 'is_contagious', label: 'Contagious only', type: 'boolean' },
      { key: 'isolation_required', label: 'Isolation required', type: 'boolean' },
    ],
    supportsDateRange: true,
    crossProfileCapable: true,
  },
  // Health status lives on conditions now; this section reads the acute
  // categories from medical_conditions and their tracked symptoms.
  async fetch({ profileIds, filters, dateRange, db }) {
    let query = db('medical_conditions as mc')
      .join('care_profiles as cp', 'cp.id', 'mc.care_profile_id')
      .whereIn('mc.care_profile_id', profileIds)
      .whereNotNull('mc.category');
    if (Array.isArray(filters['category']) && filters['category'].length) {
      query = query.whereIn('mc.category', filters['category'] as string[]);
    }
    if (Array.isArray(filters['status']) && filters['status'].length) {
      query = query.whereIn('mc.status', filters['status'] as string[]);
    }
    if (filters['is_contagious'] === true) query = query.where('mc.is_contagious', true);
    if (filters['isolation_required'] === true) query = query.where('mc.isolation_required', true);
    if (dateRange) {
      query = query.where('mc.started_on', '>=', dateRange.from).where('mc.started_on', '<=', dateRange.to);
    }
    const rows = await query.select('mc.*', 'cp.full_name as _profile_name').orderBy('mc.started_on', 'desc');
    const ids = rows.map((r) => r.id);
    const symptoms = ids.length
      ? await db('condition_symptoms').whereIn('condition_id', ids).orderBy('noted_at', 'asc')
      : [];
    const symptomsByCondition = new Map<string, Array<{ name: string; severity: number }>>();
    for (const s of symptoms) {
      const arr = symptomsByCondition.get(s.condition_id) ?? [];
      arr.push({ name: s.name, severity: s.severity });
      symptomsByCondition.set(s.condition_id, arr);
    }
    return rows.map((r) => {
      const now = new Date();
      const onset = r.started_on ? new Date(r.started_on) : null;
      const resolved = r.resolved_on ? new Date(r.resolved_on) : null;
      const end = resolved ?? (r.status !== 'resolved' ? now : null);
      const duration = onset && end ? Math.ceil((end.getTime() - onset.getTime()) / (24 * 3600 * 1000)) : null;
      const syms = symptomsByCondition.get(r.id) ?? [];
      return {
        _profile_id: r.care_profile_id,
        _profile_name: r._profile_name,
        name: r.name,
        category: r.category,
        status: r.status,
        onset_date: r.started_on,
        actual_resolution_date: r.resolved_on,
        is_contagious: r.is_contagious,
        isolation_required: r.isolation_required,
        region: r.region,
        duration_days: duration,
        symptoms: syms.map((s) => `${s.name} (severity ${s.severity}/10)`).join(', '),
      };
    });
  },
});

registerSection({
  meta: {
    key: 'medications',
    label: 'Medications',
    description: 'Current and past prescriptions with dosage, schedule, and supply information',
    category: 'medications',
    fields: [
      { key: 'name', label: 'Medication', type: 'text' },
      { key: 'form', label: 'Form', type: 'text' },
      { key: 'dose', label: 'Dose', type: 'text' },
      { key: 'dose_amount', label: 'Dose amount', type: 'number' },
      { key: 'dose_unit', label: 'Dose unit', type: 'text' },
      { key: 'route', label: 'Route', type: 'text' },
      { key: 'frequency', label: 'Frequency', type: 'text' },
      { key: 'schedule_times', label: 'Scheduled times', type: 'text' },
      { key: 'instructions', label: 'Instructions', type: 'text' },
      { key: 'supply_remaining', label: 'Supply remaining', type: 'number' },
      { key: 'packs_on_hand', label: 'Packs on hand', type: 'number' },
      { key: 'critical', label: 'Critical', type: 'boolean' },
      { key: 'as_needed', label: 'As needed', type: 'boolean' },
      { key: 'with_food', label: 'With food', type: 'boolean' },
      { key: 'active', label: 'Active', type: 'boolean' },
      { key: 'condition_name', label: 'Linked condition', type: 'text' },
    ],
    filters: [
      { key: 'active', label: 'Active only', type: 'boolean' },
      { key: 'critical', label: 'Critical only', type: 'boolean' },
      { key: 'as_needed', label: 'As needed only', type: 'boolean' },
    ],
    supportsDateRange: false,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, db }) {
    let query = db('medications as m')
      .join('medication_catalogue as mc', 'm.medication_catalogue_id', 'mc.id')
      .join('care_profiles as cp', 'cp.id', 'm.care_profile_id')
      .leftJoin('medical_conditions as cond', 'm.medical_condition_id', 'cond.id')
      .whereIn('m.care_profile_id', profileIds);
    if (filters['active'] === true) query = query.where('m.active', true);
    if (filters['critical'] === true) query = query.where('m.critical', true);
    if (filters['as_needed'] === true) query = query.where('m.as_needed', true);
    const rows = await query.select(
      'm.*', 'mc.name as name', 'mc.form as form',
      'cp.full_name as _profile_name', 'cond.name as condition_name'
    ).orderBy('mc.name', 'asc');
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      name: r.name,
      form: r.form,
      dose: r.dose,
      dose_amount: r.dose_amount,
      dose_unit: r.dose_unit,
      route: r.route,
      frequency: r.frequency,
      schedule_times: Array.isArray(r.schedule_times) ? r.schedule_times.join(', ') : '',
      instructions: r.instructions,
      supply_remaining: r.supply_remaining,
      packs_on_hand: r.packs_on_hand,
      critical: r.critical,
      as_needed: r.as_needed,
      with_food: r.with_food,
      active: r.active,
      condition_name: r.condition_name,
    }));
  },
});

registerSection({
  meta: {
    key: 'medication_administrations',
    label: 'Medication administration record',
    description: 'Detailed log of medication doses given, refused, omitted, or held',
    category: 'medications',
    fields: [
      { key: 'medication_name', label: 'Medication', type: 'text' },
      { key: 'scheduled_for', label: 'Scheduled for', type: 'date' },
      { key: 'administered_at', label: 'Administered at', type: 'date' },
      { key: 'status', label: 'Status', type: 'enum', enumValues: ['given', 'refused', 'omitted', 'held', 'self_administered'] },
      { key: 'dose_given', label: 'Dose given', type: 'text' },
      { key: 'route_given', label: 'Route', type: 'text' },
      { key: 'administered_by_name', label: 'Administered by', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'text' },
      { key: 'right_patient', label: 'Right patient', type: 'boolean' },
      { key: 'right_medication', label: 'Right medication', type: 'boolean' },
      { key: 'right_dose', label: 'Right dose', type: 'boolean' },
      { key: 'right_route', label: 'Right route', type: 'boolean' },
      { key: 'right_time', label: 'Right time', type: 'boolean' },
      { key: 'right_documentation', label: 'Right documentation', type: 'boolean' },
    ],
    filters: [
      {
        key: 'status', label: 'Status', type: 'multi-select', options: [
          { value: 'given', label: 'Given' },
          { value: 'refused', label: 'Refused' },
          { value: 'omitted', label: 'Omitted' },
          { value: 'held', label: 'Held' },
          { value: 'self_administered', label: 'Self-administered' },
        ],
      },
    ],
    supportsDateRange: true,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, dateRange, db }) {
    let query = db('medication_administrations as ma')
      .join('medications as m', 'ma.medication_id', 'm.id')
      .join('medication_catalogue as mc', 'm.medication_catalogue_id', 'mc.id')
      .join('care_profiles as cp', 'cp.id', 'ma.care_profile_id')
      .whereIn('ma.care_profile_id', profileIds);
    if (Array.isArray(filters['status']) && filters['status'].length) {
      query = query.whereIn('ma.status', filters['status'] as string[]);
    }
    if (dateRange) {
      query = query.where('ma.administered_at', '>=', dateRange.from).where('ma.administered_at', '<=', dateRange.to);
    }
    const rows = await query.select(
      'ma.*', 'mc.name as medication_name', 'cp.full_name as _profile_name'
    ).orderBy('ma.administered_at', 'desc');
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      medication_name: r.medication_name,
      scheduled_for: r.scheduled_for,
      administered_at: r.administered_at,
      status: r.status,
      dose_given: r.dose_given,
      route_given: r.route_given,
      administered_by_name: r.administered_by_name,
      notes: r.notes,
      right_patient: r.right_patient,
      right_medication: r.right_medication,
      right_dose: r.right_dose,
      right_route: r.right_route,
      right_time: r.right_time,
      right_documentation: r.right_documentation,
    }));
  },
});

registerSection({
  meta: {
    key: 'treatments',
    label: 'Treatments and observations',
    description: 'Non-medication interventions (devices, therapy, exercises) and their recorded observations',
    category: 'medications',
    fields: [
      { key: 'treatment_name', label: 'Treatment', type: 'text' },
      { key: 'treatment_category', label: 'Category', type: 'enum', enumValues: ['device', 'therapy', 'exercise', 'wound_care', 'diet', 'other'] },
      { key: 'observed_at', label: 'Observed at', type: 'date' },
      { key: 'recorded_by_name', label: 'Recorded by', type: 'text' },
      { key: 'status', label: 'Status', type: 'enum', enumValues: ['completed', 'partial', 'skipped', 'refused'] },
      { key: 'notes', label: 'Notes', type: 'text' },
      { key: 'readings', label: 'Readings', type: 'text' },
    ],
    filters: [
      {
        key: 'treatment_category', label: 'Category', type: 'multi-select', options: [
          { value: 'device', label: 'Device' },
          { value: 'therapy', label: 'Therapy' },
          { value: 'exercise', label: 'Exercise' },
          { value: 'wound_care', label: 'Wound care' },
          { value: 'diet', label: 'Diet' },
          { value: 'other', label: 'Other' },
        ],
      },
    ],
    supportsDateRange: true,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, dateRange, db }) {
    let query = db('observations as o')
      .join('treatments as t', 'o.treatment_id', 't.id')
      .join('care_profiles as cp', 'cp.id', 'o.care_profile_id')
      .whereIn('o.care_profile_id', profileIds);
    if (Array.isArray(filters['treatment_category']) && filters['treatment_category'].length) {
      query = query.whereIn('t.category', filters['treatment_category'] as string[]);
    }
    if (dateRange) {
      query = query.where('o.observed_at', '>=', dateRange.from).where('o.observed_at', '<=', dateRange.to);
    }
    const rows = await query.select('o.*', 't.name as treatment_name', 't.category as treatment_category', 'cp.full_name as _profile_name')
      .orderBy('o.observed_at', 'desc');
    const obsIds = rows.map((r) => r.id);
    const values = obsIds.length
      ? await db('observation_values as ov')
          .join('treatment_metrics as tm', 'ov.treatment_metric_id', 'tm.id')
          .whereIn('ov.observation_id', obsIds)
          .select('ov.*', 'tm.name as metric_name', 'tm.unit as metric_unit')
      : [];
    const valsByObs = new Map<string, string[]>();
    for (const v of values) {
      const arr = valsByObs.get(v.observation_id) ?? [];
      const val = v.value_number != null ? v.value_number : v.value_boolean != null ? (v.value_boolean ? 'Yes' : 'No') : v.value_text;
      arr.push(`${v.metric_name}: ${val}${v.metric_unit ? ` ${v.metric_unit}` : ''}`);
      valsByObs.set(v.observation_id, arr);
    }
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      treatment_name: r.treatment_name,
      treatment_category: r.treatment_category,
      observed_at: r.observed_at,
      recorded_by_name: r.recorded_by_name,
      status: r.status,
      notes: r.notes,
      readings: (valsByObs.get(r.id) ?? []).join('; '),
    }));
  },
});

registerSection({
  meta: {
    key: 'health_spend',
    label: 'Health spend',
    description: 'Actual spend on each person over the chosen date range, split into medications, appointments and other, for the high-level view across everyone in your care',
    category: 'medications',
    fields: [
      { key: 'medication_spend', label: 'Medications', type: 'number' },
      { key: 'appointment_spend', label: 'Appointments', type: 'number' },
      { key: 'other_spend', label: 'Other', type: 'number' },
      { key: 'total_spend', label: 'Total spent', type: 'number' },
      { key: 'pending_spend', label: 'Estimated, not yet confirmed', type: 'number' },
    ],
    filters: [],
    supportsDateRange: true,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, dateRange, db }) {
    // One row per person: confirmed spend over the range, by category and
    // combined, plus the estimated amount still awaiting confirmation. Each
    // figure is its own column so the report can sort and total independently.
    const range = { from: dateRange?.from ?? null, to: dateRange?.to ?? null };
    const profiles = await db('care_profiles').whereIn('id', profileIds).select('id', 'full_name');
    const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));
    const rows: Record<string, unknown>[] = [];
    for (const profileId of profileIds) {
      const s = await summarizeSpend(profileId, range, db);
      rows.push({
        _profile_id: profileId,
        _profile_name: nameById.get(profileId) ?? '',
        medication_spend: s.by_category.medication,
        appointment_spend: s.by_category.appointment,
        other_spend: s.by_category.other,
        total_spend: s.total,
        pending_spend: s.pending_total,
      });
    }
    return rows;
  },
});

registerSection({
  meta: {
    key: 'health_spend_detail',
    label: 'Health spend, itemised',
    description: 'Every recorded cost over the chosen date range: what it was for, the amount, and whether it is confirmed or still an estimate',
    category: 'medications',
    fields: [
      { key: 'spent_on', label: 'Date', type: 'date' },
      { key: 'category', label: 'Category', type: 'enum', enumValues: ['medication', 'appointment', 'other'] },
      { key: 'item_name', label: 'What it was for', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'status', label: 'Status', type: 'enum', enumValues: ['confirmed', 'estimated'] },
      { key: 'description', label: 'Note', type: 'text' },
    ],
    filters: [
      {
        key: 'category', label: 'Category', type: 'multi-select', options: [
          { value: 'medication', label: 'Medications' },
          { value: 'appointment', label: 'Appointments' },
          { value: 'other', label: 'Other' },
        ],
      },
      {
        key: 'status', label: 'Status', type: 'multi-select', options: [
          { value: 'confirmed', label: 'Confirmed' },
          { value: 'estimated', label: 'Estimated' },
        ],
      },
    ],
    supportsDateRange: true,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, dateRange, db }) {
    let query = db('health_spend_entries as e')
      .join('care_profiles as cp', 'cp.id', 'e.care_profile_id')
      .leftJoin('appointments as ap', 'ap.id', 'e.appointment_id')
      .leftJoin('medications as m', 'm.id', 'e.medication_id')
      .leftJoin('medication_catalogue as mc', 'mc.id', 'm.medication_catalogue_id')
      .whereIn('e.care_profile_id', profileIds);
    if (Array.isArray(filters['category']) && filters['category'].length) {
      query = query.whereIn('e.category', filters['category'] as string[]);
    }
    if (Array.isArray(filters['status']) && filters['status'].length) {
      query = query.whereIn('e.status', filters['status'] as string[]);
    }
    if (dateRange) {
      query = query.where('e.spent_on', '>=', dateRange.from).where('e.spent_on', '<=', dateRange.to);
    }
    const rows = await query
      .select(
        'e.care_profile_id', 'e.spent_on', 'e.category', 'e.status', 'e.amount', 'e.description',
        'cp.full_name as _profile_name',
        db.raw('coalesce(mc.name, ap.title, e.description) as item_name')
      )
      .orderBy('e.spent_on', 'desc');
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      spent_on: r.spent_on,
      category: r.category as SpendCategory,
      item_name: r.item_name,
      amount: toNum(r.amount),
      status: r.status,
      description: r.description,
    }));
  },
});

registerSection({
  meta: {
    key: 'care_plan',
    label: 'Care plan',
    description: 'Dietary requirements, mobility aids, communication needs, and advance care directives',
    category: 'care',
    fields: [
      { key: 'dietary_requirements', label: 'Dietary requirements', type: 'text' },
      { key: 'mobility_aids', label: 'Mobility aids', type: 'text' },
      { key: 'communication_needs', label: 'Communication needs', type: 'text' },
      { key: 'advance_care_directive', label: 'Advance care directive', type: 'boolean' },
      { key: 'advance_care_directive_location', label: 'Directive location', type: 'text' },
      { key: 'emergency_contacts', label: 'Emergency contacts', type: 'text' },
    ],
    filters: [],
    supportsDateRange: false,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, db }) {
    const rows = await db('care_plans')
      .join('care_profiles', 'care_profiles.id', 'care_plans.care_profile_id')
      .whereIn('care_plans.care_profile_id', profileIds)
      .select('care_plans.*', 'care_profiles.full_name as _profile_name');
    return rows.map((r) => {
      const contacts = Array.isArray(r.emergency_contacts) ? r.emergency_contacts : [];
      return {
        _profile_id: r.care_profile_id,
        _profile_name: r._profile_name,
        dietary_requirements: Array.isArray(r.dietary_requirements) ? r.dietary_requirements.join(', ') : '',
        mobility_aids: Array.isArray(r.mobility_aids) ? r.mobility_aids.join(', ') : '',
        communication_needs: Array.isArray(r.communication_needs) ? r.communication_needs.join(', ') : '',
        advance_care_directive: r.advance_care_directive,
        advance_care_directive_location: r.advance_care_directive_location,
        emergency_contacts: contacts.map((c: Record<string, string>) => [c.name, c.relationship, c.phone].filter(Boolean).join(' - ')).join('; '),
      };
    });
  },
});

registerSection({
  meta: {
    key: 'tasks',
    label: 'Tasks and reminders',
    description: 'Scheduled tasks, reminders, and their completion status and outcomes',
    category: 'care',
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'body', label: 'Description', type: 'text' },
      { key: 'reminder_type', label: 'Repeat type', type: 'enum', enumValues: ['once', 'daily', 'weekly', 'monthly'] },
      { key: 'next_due_at', label: 'Due date', type: 'date' },
      { key: 'completed', label: 'Completed', type: 'boolean' },
      { key: 'completed_at', label: 'Completed at', type: 'date' },
      { key: 'sentiment', label: 'Outcome rating', type: 'number' },
      { key: 'desired_outcome', label: 'Desired outcome', type: 'text' },
    ],
    filters: [
      { key: 'completed', label: 'Completed only', type: 'boolean' },
      { key: 'incomplete', label: 'Incomplete only', type: 'boolean' },
      { key: 'has_sentiment', label: 'With outcome rating', type: 'boolean' },
    ],
    supportsDateRange: true,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, dateRange, db }) {
    let query = db('reminders')
      .join('care_profiles', 'care_profiles.id', 'reminders.care_profile_id')
      .whereIn('reminders.care_profile_id', profileIds);
    if (filters['completed'] === true) query = query.where('reminders.completed', true);
    if (filters['incomplete'] === true) query = query.where('reminders.completed', false);
    if (filters['has_sentiment'] === true) query = query.whereNotNull('reminders.sentiment');
    if (dateRange) {
      query = query.where(function () {
        this.whereBetween('reminders.next_due_at', [dateRange.from, dateRange.to])
          .orWhereBetween('reminders.completed_at', [dateRange.from, dateRange.to]);
      });
    }
    const rows = await query.select('reminders.*', 'care_profiles.full_name as _profile_name')
      .orderBy('reminders.next_due_at', 'desc');
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      title: r.title,
      body: r.body,
      reminder_type: r.reminder_type,
      next_due_at: r.next_due_at,
      completed: r.completed,
      completed_at: r.completed_at,
      sentiment: r.sentiment,
      desired_outcome: r.desired_outcome,
    }));
  },
});

registerSection({
  meta: {
    key: 'care_circle',
    label: 'Care circle',
    description: 'People involved in care: their roles, relationships, and permissions',
    category: 'admin',
    fields: [
      { key: 'display_name', label: 'Name', type: 'text' },
      { key: 'role', label: 'Role', type: 'text' },
      { key: 'relationship', label: 'Relationship', type: 'text' },
      { key: 'permission', label: 'Permission', type: 'enum', enumValues: ['viewer', 'contributor'] },
      { key: 'poa_type', label: 'Power of attorney type', type: 'text' },
      { key: 'poa_activated', label: 'Power of attorney activated', type: 'boolean' },
    ],
    filters: [
      { key: 'permission', label: 'Permission', type: 'select', options: [{ value: 'viewer', label: 'Viewer' }, { value: 'contributor', label: 'Contributor' }] },
    ],
    supportsDateRange: false,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, db }) {
    let query = db('care_circle_members')
      .join('care_profiles', 'care_profiles.id', 'care_circle_members.care_profile_id')
      .whereIn('care_circle_members.care_profile_id', profileIds)
      .where('care_circle_members.invite_accepted', true);
    if (filters['permission']) query = query.where('care_circle_members.permission', String(filters['permission']));
    const rows = await query.select('care_circle_members.*', 'care_profiles.full_name as _profile_name');
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      display_name: r.display_name,
      role: r.role,
      relationship: r.relationship,
      permission: r.permission,
      poa_type: r.poa_type,
      poa_activated: r.poa_activated,
    }));
  },
});

registerSection({
  meta: {
    key: 'providers',
    label: 'Providers',
    description: 'Healthcare providers, specialists, pharmacies, and service providers linked to profiles',
    category: 'admin',
    fields: [
      { key: 'name', label: 'Provider name', type: 'text' },
      { key: 'provider_type', label: 'Type', type: 'text' },
      { key: 'organisation', label: 'Organisation', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'address', label: 'Address', type: 'text' },
    ],
    filters: [
      {
        key: 'provider_type', label: 'Type', type: 'multi-select', options: [
          { value: 'gp', label: 'GP' },
          { value: 'specialist', label: 'Specialist' },
          { value: 'psychologist', label: 'Psychologist' },
          { value: 'vet', label: 'Vet' },
          { value: 'pharmacy', label: 'Pharmacy' },
          { value: 'care_facility', label: 'Care facility' },
          { value: 'allied_health', label: 'Allied health' },
          { value: 'legal', label: 'Legal' },
          { value: 'financial', label: 'Financial' },
          { value: 'social_worker', label: 'Social worker' },
          { value: 'other', label: 'Other' },
        ],
      },
    ],
    supportsDateRange: false,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, db }) {
    let query = db('care_profile_providers as cpp')
      .join('providers as p', 'cpp.provider_id', 'p.id')
      .join('care_profiles as cp', 'cp.id', 'cpp.care_profile_id')
      .whereIn('cpp.care_profile_id', profileIds);
    if (Array.isArray(filters['provider_type']) && filters['provider_type'].length) {
      query = query.whereIn('p.provider_type', filters['provider_type'] as string[]);
    }
    const rows = await query.select('p.*', 'cpp.care_profile_id', 'cp.full_name as _profile_name');
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      name: r.name,
      provider_type: r.provider_type,
      organisation: r.organisation,
      phone: r.phone,
      email: r.email,
      address: r.address,
    }));
  },
});

registerSection({
  meta: {
    key: 'care_journeys',
    label: 'Care journeys',
    description: 'Lifecycle journey progress, current phases, and milestone tracking',
    category: 'care',
    fields: [
      { key: 'journey_name', label: 'Journey', type: 'text' },
      { key: 'status', label: 'Status', type: 'enum', enumValues: ['active', 'completed', 'abandoned'] },
      { key: 'current_phase', label: 'Current phase', type: 'text' },
      { key: 'total_phases', label: 'Total phases', type: 'number' },
      { key: 'started_at', label: 'Started', type: 'date' },
      { key: 'ended_at', label: 'Ended', type: 'date' },
      { key: 'tasks_completed', label: 'Tasks completed', type: 'number' },
      { key: 'tasks_total', label: 'Tasks total', type: 'number' },
      { key: 'milestones_achieved', label: 'Milestones achieved', type: 'number' },
    ],
    filters: [
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'abandoned', label: 'Abandoned' }] },
    ],
    supportsDateRange: false,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, db }) {
    let query = db('care_journeys as cj')
      .join('care_profiles as cp', 'cp.id', 'cj.care_profile_id')
      .whereIn('cj.care_profile_id', profileIds);
    if (filters['status']) query = query.where('cj.status', String(filters['status']));
    const rows = await query.select('cj.*', 'cp.full_name as _profile_name');
    const journeyIds = rows.map((r) => r.id);
    const phases = journeyIds.length
      ? await db('care_journey_phases').whereIn('care_journey_id', journeyIds).orderBy('sort_order', 'asc')
      : [];
    const phaseIds = phases.map((p) => p.id);
    const checklist = phaseIds.length
      ? await db('checklist_items').whereIn('care_journey_phase_id', phaseIds)
      : [];
    const phasesByJourney = new Map<string, typeof phases>();
    for (const p of phases) {
      const arr = phasesByJourney.get(p.care_journey_id) ?? [];
      arr.push(p);
      phasesByJourney.set(p.care_journey_id, arr);
    }
    const checklistByPhase = new Map<string, typeof checklist>();
    for (const c of checklist) {
      if (!c.care_journey_phase_id) continue;
      const arr = checklistByPhase.get(c.care_journey_phase_id) ?? [];
      arr.push(c);
      checklistByPhase.set(c.care_journey_phase_id, arr);
    }
    return rows.map((r) => {
      const jp = phasesByJourney.get(r.id) ?? [];
      const current = jp.find((p) => p.entered_at && !p.locked_at);
      let tasksCompleted = 0, tasksTotal = 0, milestones = 0;
      for (const p of jp) {
        const items = checklistByPhase.get(p.id) ?? [];
        tasksTotal += items.length;
        tasksCompleted += items.filter((i) => i.completed).length;
        milestones += items.filter((i) => i.is_milestone && i.completed).length;
      }
      return {
        _profile_id: r.care_profile_id,
        _profile_name: r._profile_name,
        journey_name: r.name,
        status: r.status,
        current_phase: current?.name ?? (r.status === 'completed' ? 'Completed' : 'Not started'),
        total_phases: jp.length,
        started_at: r.started_at,
        ended_at: r.ended_at,
        tasks_completed: tasksCompleted,
        tasks_total: tasksTotal,
        milestones_achieved: milestones,
      };
    });
  },
});

registerSection({
  meta: {
    key: 'documents',
    label: 'Documents',
    description: 'Uploaded documents and files',
    category: 'admin',
    fields: [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'mime_type', label: 'File type', type: 'text' },
      { key: 'file_size_bytes', label: 'Size in bytes', type: 'number' },
      { key: 'created_at', label: 'Uploaded', type: 'date' },
    ],
    filters: [],
    supportsDateRange: true,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, dateRange, db }) {
    let query = db('documents')
      .join('care_profiles', 'care_profiles.id', 'documents.care_profile_id')
      .whereIn('documents.care_profile_id', profileIds);
    if (dateRange) {
      query = query.where('documents.created_at', '>=', dateRange.from).where('documents.created_at', '<=', dateRange.to);
    }
    const rows = await query.select('documents.*', 'care_profiles.full_name as _profile_name')
      .orderBy('documents.created_at', 'desc');
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      label: r.label,
      category: r.category,
      mime_type: r.mime_type,
      file_size_bytes: r.file_size_bytes,
      created_at: r.created_at,
    }));
  },
});

registerSection({
  meta: {
    key: 'activity_log',
    label: 'Activity log',
    description: 'Audit trail of all changes made to a profile',
    category: 'admin',
    fields: [
      { key: 'action', label: 'Action', type: 'enum', enumValues: ['created', 'updated', 'deleted'] },
      { key: 'entity_type', label: 'Entity type', type: 'text' },
      { key: 'summary', label: 'Summary', type: 'text' },
      { key: 'created_at', label: 'When', type: 'date' },
    ],
    filters: [
      { key: 'action', label: 'Action', type: 'multi-select', options: [{ value: 'created', label: 'Created' }, { value: 'updated', label: 'Updated' }, { value: 'deleted', label: 'Deleted' }] },
    ],
    supportsDateRange: true,
    crossProfileCapable: true,
  },
  async fetch({ profileIds, filters, dateRange, db }) {
    let query = db('audit_log')
      .join('care_profiles', 'care_profiles.id', 'audit_log.care_profile_id')
      .whereIn('audit_log.care_profile_id', profileIds);
    if (Array.isArray(filters['action']) && filters['action'].length) {
      query = query.whereIn('audit_log.action', filters['action'] as string[]);
    }
    if (dateRange) {
      query = query.where('audit_log.created_at', '>=', dateRange.from).where('audit_log.created_at', '<=', dateRange.to);
    }
    const rows = await query.select('audit_log.*', 'care_profiles.full_name as _profile_name')
      .orderBy('audit_log.created_at', 'desc').limit(500);
    return rows.map((r) => ({
      _profile_id: r.care_profile_id,
      _profile_name: r._profile_name,
      action: r.action,
      entity_type: r.entity_type,
      summary: r.summary,
      created_at: r.created_at,
    }));
  },
});
