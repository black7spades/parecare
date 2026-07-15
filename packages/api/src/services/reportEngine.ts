import { db } from '../config/database';
import { getSection, getAllSections, type ReportSectionMeta } from './reportRegistry';
import { complete, isAiConfigured } from './aiProvider';

export interface ReportSectionConfig {
  key: string;
  fields: string[];
  filters: Record<string, unknown>;
}

export interface ReportRequest {
  profileIds: string[];
  sections: ReportSectionConfig[];
  dateRange: { from: string; to: string } | null;
  includeAiNarrative: boolean;
  aiPrompt?: string;
}

export interface ReportSectionResult {
  key: string;
  label: string;
  rows: Record<string, unknown>[];
  fields: ReportSectionMeta['fields'];
}

export interface ReportResult {
  generatedAt: string;
  profileCount: number;
  sections: ReportSectionResult[];
  aiNarrative?: string;
}

export async function generateReport(req: ReportRequest): Promise<ReportResult> {
  const sectionResults: ReportSectionResult[] = [];

  for (const sectionCfg of req.sections) {
    const section = getSection(sectionCfg.key);
    if (!section) continue;

    let rows: Record<string, unknown>[];
    try {
      rows = await section.fetch({
        profileIds: req.profileIds,
        fields: sectionCfg.fields,
        filters: sectionCfg.filters,
        dateRange: section.meta.supportsDateRange ? req.dateRange : null,
        db,
      });
    } catch (err) {
      console.error(`Report section "${sectionCfg.key}" failed:`, err);
      rows = [];
    }

    let visibleFields = section.meta.fields;
    if (sectionCfg.fields.length > 0) {
      const keep = new Set(sectionCfg.fields);
      visibleFields = visibleFields.filter((f) => keep.has(f.key));
    }

    sectionResults.push({
      key: section.meta.key,
      label: section.meta.label,
      rows,
      fields: visibleFields,
    });
  }

  const result: ReportResult = {
    generatedAt: new Date().toISOString(),
    profileCount: new Set(req.profileIds).size,
    sections: sectionResults,
  };

  if (req.includeAiNarrative && isAiConfigured()) {
    result.aiNarrative = await generateNarrative(sectionResults, req.aiPrompt);
  }

  return result;
}

async function generateNarrative(sections: ReportSectionResult[], customPrompt?: string): Promise<string> {
  const dataContext = sections.map((s) => {
    if (s.rows.length === 0) return `## ${s.label}\nNo data.`;
    const headers = ['Profile', ...s.fields.map((f) => f.label)];
    const tableRows = s.rows.slice(0, 100).map((r) => {
      return [
        String(r['_profile_name'] ?? ''),
        ...s.fields.map((f) => formatValue(r[f.key])),
      ];
    });
    const table = [headers.join(' | '), ...tableRows.map((row) => row.join(' | '))].join('\n');
    return `## ${s.label} (${s.rows.length} records)\n${table}`;
  }).join('\n\n');

  const systemPrompt = [
    'You are a care report analyst for PareCare, a care coordination platform.',
    'You will be given structured data from a care report. Write a clear, professional narrative summary suitable for handover to medical staff, NDIS auditors, or care managers.',
    'Guidelines:',
    '- Use plain language. Avoid jargon unless defining it.',
    '- Highlight key findings, patterns, and concerns.',
    '- For health data, note contagious cases, unresolved conditions, and duration outliers.',
    '- For medications, note any refused or omitted doses.',
    '- For multi-profile reports, identify cross-cutting patterns (e.g. multiple people with the same illness).',
    '- Structure your response with clear headings.',
    '- Be factual. Do not speculate beyond what the data shows.',
    '- Keep the summary concise but thorough.',
    customPrompt ? `\nAdditional instructions from the report creator: ${customPrompt}` : '',
  ].filter(Boolean).join('\n');

  const result = await complete(
    systemPrompt,
    [{ role: 'user', content: `Here is the report data:\n\n${dataContext}\n\nPlease write the narrative summary.` }],
    4096,
    'chat'
  );

  return result.text;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export function getRegistry(): ReportSectionMeta[] {
  return getAllSections();
}

export interface ReportPreset {
  id: string;
  account_id: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
  config: {
    sections: ReportSectionConfig[];
    dateRangePreset: string | null;
    includeAiNarrative: boolean;
    aiPrompt: string | null;
    profileFilter?: { kind?: string };
  };
  created_at: string;
  updated_at: string;
}

export const SYSTEM_PRESETS: Omit<ReportPreset, 'id' | 'created_at' | 'updated_at'>[] = [
  {
    account_id: null,
    name: 'Health summary for doctor or vet visit',
    description: 'Demographics, allergies, conditions, medications, and recent health events. Ideal for preparing a GP, specialist, or veterinary appointment.',
    is_system: true,
    config: {
      sections: [
        { key: 'demographics', fields: ['full_name', 'date_of_birth', 'age', 'pronouns', 'primary_language'], filters: {} },
        { key: 'allergies', fields: [], filters: {} },
        { key: 'medical_conditions', fields: [], filters: { status: ['active', 'improving', 'managed'] } },
        { key: 'medications', fields: ['name', 'dose', 'route', 'frequency', 'schedule_times', 'instructions', 'critical'], filters: { active: true } },
        { key: 'health_statuses', fields: ['name', 'category', 'status', 'onset_date', 'duration_days', 'symptoms', 'is_contagious'], filters: { status: ['active', 'monitoring', 'resolving'] } },
        { key: 'care_plan', fields: ['dietary_requirements', 'mobility_aids', 'communication_needs', 'advance_care_directive'], filters: {} },
      ],
      dateRangePreset: '90d',
      includeAiNarrative: true,
      aiPrompt: 'Write this summary as if preparing for a doctor or vet visit. Highlight anything the clinician should be made aware of urgently.',
    },
  },
  {
    account_id: null,
    name: 'Medication administration record',
    description: 'Detailed log of all medication doses given, refused, omitted, or held over a selected period.',
    is_system: true,
    config: {
      sections: [
        { key: 'demographics', fields: ['full_name', 'date_of_birth', 'age'], filters: {} },
        { key: 'medications', fields: ['name', 'dose', 'route', 'frequency', 'schedule_times', 'critical', 'as_needed'], filters: { active: true } },
        { key: 'medication_administrations', fields: [], filters: {} },
      ],
      dateRangePreset: '7d',
      includeAiNarrative: false,
      aiPrompt: null,
    },
  },
  {
    account_id: null,
    name: 'Illness and outbreak analysis',
    description: 'Cross-profile view of current illnesses, contagion risk, isolation status, and affected areas. Use for outbreak tracking in families or facilities.',
    is_system: true,
    config: {
      sections: [
        { key: 'demographics', fields: ['full_name', 'age', 'current_phase'], filters: {} },
        { key: 'health_statuses', fields: ['name', 'category', 'status', 'onset_date', 'expected_resolution_date', 'duration_days', 'is_contagious', 'isolation_required', 'region', 'symptoms'], filters: { status: ['active', 'monitoring', 'resolving'] } },
        { key: 'medical_conditions', fields: ['name', 'status'], filters: { status: ['active'] } },
      ],
      dateRangePreset: '30d',
      includeAiNarrative: true,
      aiPrompt: 'Analyse this data for outbreak patterns. Identify who is sick, what they have, how long they have been unwell, who might be a vector, which areas or wings are affected, and who might be at greatest risk. Flag anyone not improving and suggest whether isolation measures are warranted.',
      profileFilter: { kind: 'person' },
    },
  },
  {
    account_id: null,
    name: 'NDIS progress report',
    description: 'Journey progress, task completion rates, outcome ratings, and milestone tracking for NDIS plan reviews and audits.',
    is_system: true,
    config: {
      sections: [
        { key: 'demographics', fields: ['full_name', 'date_of_birth', 'age', 'current_phase'], filters: {} },
        { key: 'care_journeys', fields: [], filters: { status: 'active' } },
        { key: 'tasks', fields: ['title', 'completed', 'completed_at', 'sentiment', 'desired_outcome'], filters: { has_sentiment: true } },
        { key: 'treatments', fields: ['treatment_name', 'treatment_category', 'observed_at', 'status', 'readings'], filters: {} },
      ],
      dateRangePreset: '90d',
      includeAiNarrative: true,
      aiPrompt: 'Write this as an NDIS progress report. Focus on measurable outcomes, goal progress, task completion rates, and treatment adherence. Use evidence-based language suitable for an NDIS plan review.',
      profileFilter: { kind: 'person' },
    },
  },
  {
    account_id: null,
    name: 'Care handover report',
    description: 'Everything an incoming carer needs to know: demographics, allergies, medications, care plan, active health issues, care circle, and providers.',
    is_system: true,
    config: {
      sections: [
        { key: 'demographics', fields: ['full_name', 'preferred_name', 'date_of_birth', 'age', 'pronouns', 'primary_language', 'current_phase'], filters: {} },
        { key: 'allergies', fields: [], filters: {} },
        { key: 'medical_conditions', fields: ['name', 'status', 'notes'], filters: { status: ['active', 'improving', 'managed'] } },
        { key: 'medications', fields: ['name', 'dose', 'route', 'frequency', 'schedule_times', 'instructions', 'critical', 'as_needed', 'with_food'], filters: { active: true } },
        { key: 'health_statuses', fields: ['name', 'category', 'status', 'onset_date', 'is_contagious', 'isolation_required', 'symptoms', 'escalation_notes'], filters: { status: ['active', 'monitoring'] } },
        { key: 'care_plan', fields: [], filters: {} },
        { key: 'treatments', fields: ['treatment_name', 'treatment_category', 'notes'], filters: {} },
        { key: 'care_circle', fields: ['display_name', 'role', 'relationship', 'permission'], filters: {} },
        { key: 'providers', fields: ['name', 'provider_type', 'organisation', 'phone'], filters: {} },
      ],
      dateRangePreset: null,
      includeAiNarrative: true,
      aiPrompt: 'Write a care handover brief. Structure it so an incoming carer can quickly understand: who this person is, what they need, what to watch out for, who to contact, and what the daily routine looks like.',
    },
  },
  {
    account_id: null,
    name: 'Facility overview',
    description: 'Multi-profile snapshot of all people in care: health statuses, medication compliance, task completion, and staffing. Designed for facility managers.',
    is_system: true,
    config: {
      sections: [
        { key: 'demographics', fields: ['full_name', 'age', 'current_phase'], filters: { kind: 'person' } },
        { key: 'health_statuses', fields: ['name', 'category', 'status', 'is_contagious', 'isolation_required', 'region'], filters: { status: ['active', 'monitoring'] } },
        { key: 'medications', fields: ['name', 'critical', 'supply_remaining'], filters: { active: true } },
        { key: 'tasks', fields: ['title', 'next_due_at', 'completed'], filters: { incomplete: true } },
      ],
      dateRangePreset: '7d',
      includeAiNarrative: true,
      aiPrompt: 'Write a facility manager briefing. Summarise the overall health picture, flag anyone requiring urgent attention, note medication supply issues, and highlight overdue tasks.',
      profileFilter: { kind: 'person' },
    },
  },
];

export function toCsv(sections: ReportSectionResult[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(`# ${section.label}`);
    if (section.rows.length === 0) {
      lines.push('No data.');
      lines.push('');
      continue;
    }
    const headers = ['Profile', ...section.fields.map((f) => f.label)];
    lines.push(headers.map(csvEscape).join(','));
    for (const row of section.rows) {
      const values = [
        String(row['_profile_name'] ?? ''),
        ...section.fields.map((f) => formatValue(row[f.key])),
      ];
      lines.push(values.map(csvEscape).join(','));
    }
    lines.push('');
  }
  return lines.join('\n');
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
