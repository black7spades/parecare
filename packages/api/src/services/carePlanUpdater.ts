import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '../config/database';
import { uploadFile, deleteFile } from './storage';

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

export const PLAN_SECTIONS = [
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

export const SECTION_LABELS: Record<PlanSection, string> = {
  allergies: 'Allergies',
  conditions: 'Conditions',
  medications: 'Medications',
  treatments: 'Treatments',
  needs: 'Day-to-day needs',
  directive: 'Advance care directive',
  emergency_contacts: 'Emergency contacts',
  providers: 'Providers',
};

/** Which plan sections a change to a source table can affect. */
const SECTIONS_BY_SOURCE: Record<string, PlanSection[]> = {
  conditions: ['conditions'],
  allergies: ['allergies'],
  medications: ['medications'],
  treatments: ['treatments'],
  providers: ['providers'],
  plan: ['needs', 'directive', 'emergency_contacts'],
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

async function buildSection(profileId: string, section: PlanSection): Promise<PlanEntry[]> {
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
      const rows = await db('medications').where({ care_profile_id: profileId }).orderBy('name');
      return rows.map((r) => ({
        key: `medications:${r.id}`,
        fields: {
          name: r.name,
          dose: r.dose ?? null,
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
      const rows = await db('providers').where({ care_profile_id: profileId }).orderBy('name');
      return rows.map((r) => ({
        key: `providers:${r.id}`,
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

async function buildTruth(profileId: string, sections: PlanSection[]): Promise<Record<string, PlanEntry[]>> {
  const truth: Record<string, PlanEntry[]> = {};
  for (const section of sections) {
    truth[section] = await buildSection(profileId, section);
  }
  return truth;
}

// ---------------------------------------------------------------------------
// Deterministic diff: the ground truth delta for the touched sections

const sameFields = (a: PlanEntry['fields'], b: PlanEntry['fields']): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

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
  const v = fields['substance'] ?? fields['name'] ?? fields['value'] ?? fields['location'] ?? '';
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
  changelog: string | null
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
<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
h1{font-size:1.4rem}h2{font-size:1.05rem;margin-top:1.5rem}table{border-collapse:collapse;width:100%;font-size:.85rem}
th,td{border:1px solid #ccc;padding:.35rem .5rem;text-align:left}th{background:#f3f3f3}
.meta{color:#666;font-size:.8rem}.changes{white-space:pre-wrap;font-size:.85rem;background:#f8f8f8;padding:.75rem;border-radius:.375rem}</style>
</head><body>
<h1>Care plan for ${esc(profileName)}</h1>
<p class="meta">Version ${version} &middot; Created ${createdAt.toISOString()} &middot; Integrity hash ${hash}</p>
${changelog ? `<h2>What changed in this version</h2><div class="changes">${esc(changelog)}</div>` : ''}
${sections}
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
  const html = renderHtml(name, versionNumber, hash, new Date(), input.content, input.changelog);
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
  const truth = await buildTruth(profileId, [...PLAN_SECTIONS]);
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
  ] as PlanSection[];
  const truth = await buildTruth(profileId, touched);
  const ops = await proposeDelta(events, base.content, truth, touched);

  const eventIds = events.map((e) => e.id);
  if (ops.length === 0) {
    // The events cancelled out (e.g. add then delete). Mark them applied
    // so they are never offered again — idempotency without a new version.
    await db('care_plan_events').whereIn('id', eventIds).update({ processed_at: db.fn.now() });
    return { version: null, applied: events.length, status: 'no_changes' };
  }

  const highRisk = ops.some(
    (op) => op.op !== 'add' && HIGH_RISK_SECTIONS.has(op.section as PlanSection)
  );
  const needsReview = highRisk || ops.length > LARGE_DELTA_OPS || base.locked;
  const status: 'published' | 'awaiting_signoff' = needsReview ? 'awaiting_signoff' : 'published';

  const beforeByKey = new Map<string, PlanEntry>();
  for (const entries of Object.values(base.content.sections)) {
    for (const e of entries) beforeByKey.set(e.key, e);
  }
  const changelog = ops.map((op) => describeOp(op, beforeByKey.get(op.key)?.fields ?? null)).join('\n');

  const content = applyOps(base.content, ops);
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
    db('providers').where({ care_profile_id: profileId, provider_type: 'gp' }).count<{ count: string }[]>('id as count'),
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
