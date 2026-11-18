import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../config/database';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import {
  actionSchema,
  candidateProfileNames,
  executeActions,
  listReachableProfiles,
  resolveProfileByName,
  toJsonSchema,
  type AssistantAction,
} from '../services/aiActions';
import { buildProfileContext } from '../services/aiContext';
import { addPracticeMember } from '../services/providerPractices';
import { BUILT_IN_PROVIDER_TYPES } from '../lib/providerTypes';
import { formatInZone, dateInZone } from '../lib/timezone';
import { GUIDE_PROMPTS, RECORDING_GUIDE, recordingInstructions, recordingSkill } from '../services/assistantGuide';
import { batchIsReversible, undoActionBatch } from './actions';
import type { Account, CareAccess, CareProfile } from '../types';

/**
 * PareCare as a connector for outside assistants: Claude, ChatGPT, Cursor,
 * or anything else that speaks the Model Context Protocol. Someone says
 * "log that Mum had a fall and file it in PareCare" to whatever assistant
 * they already use, and it lands here.
 *
 * This is a thin door, not a second brain. Every tool is one of Pare's own
 * actions, generated from the same schema that constrains Pare, executed by
 * the same code with the caller's own permissions, recorded in the audit
 * trail as made by an outside assistant, and undoable the same way. Change
 * an action and this connector changes with it.
 *
 * Transport: streamable HTTP, stateless, JSON responses. Each POST carries
 * one JSON-RPC message or a batch. No sessions, so any API instance can
 * answer any request.
 */

export const mcpRouter = Router();

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_VERSION = '2025-06-18';

const INSTRUCTIONS = `PareCare keeps care records for the people (and pets) this person looks after: medications and doses, the care log, tasks, appointments, conditions, allergies, providers and more.

How to work with it:
- Start with list_people to see who is in their care and what access they have. Every person-level tool takes "person": the name as the user said it, or how they are related ("Mum" works when the relationship is recorded). If a name is unclear the tool says who it could be: ask, never guess.
- Use get_person before changing something when you need to know what is already recorded, such as the exact name of a medication or provider.
- Providers live in one shared directory. add_to_practice files a practitioner at their clinic ("add Dr Carly Examplename to Health Hub Morayfield") and they share its address. add_provider files a provider and links them to one person.
- Provider types are plain words when they are not one of the built-in kinds: "Neurologist", "Dentist".
- Changes to someone's medication list (add, change, stop) come back first as a preview. Read it back to the user, and only call again with "confirmed": true once they agree.
- Every change is recorded as made by an outside assistant. Most new records can be undone for 30 minutes with the undo tool and the change code the result gives you.
- Tell the user plainly what was saved. Never claim something was saved when a tool said it was not.`;

// ── Auth: a 401 that tells the assistant where to sign in ──────────────

function resourceMetadataUrl(): string {
  return `${env.APP_URL}/.well-known/oauth-protected-resource/api/v1/mcp`;
}

function mcpAuth(req: Request, res: Response, next: NextFunction): void {
  // Set before auth runs so any 401 it sends carries it; removed on success.
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl()}"`);
  void requireAuth(req, res, () => {
    res.removeHeader('WWW-Authenticate');
    next();
  });
}

// ── Tools ──────────────────────────────────────────────────────────────

interface ToolContext {
  account: Account;
  canWrite: boolean;
  timeZone: string | null;
}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

const PERSON_PROP = {
  type: 'string',
  description: 'Who this is for: the name of a person or pet in their care, as the user said it, e.g. "Margaret Smith" or "Biscuit". See list_people.',
};

/** Plain descriptions for each of Pare's actions, as an assistant needs them. */
const ACTION_DESCRIPTIONS: Record<string, string> = {
  log_event: 'Add an entry to a person\'s care log: a visit, phone call, decision, concern, observation, handover and so on.',
  record_medication: 'Record one medication dose for a person: given, refused, missed, held or self-administered.',
  record_medications: 'Record several medication doses for a person at once, such as "took all my morning meds at 8".',
  add_task: 'Add a task or reminder for a person, optionally repeating.',
  add_medication: 'Add a medication to a person\'s medication list. Comes back as a preview first; call again with confirmed true once the user agrees.',
  update_medication: 'Change a medication on a person\'s list: dose, schedule, instructions. Comes back as a preview first; call again with confirmed true once the user agrees.',
  restock_medication: 'Record that more of a medication was bought or collected, so supply counts stay right.',
  stop_medication: 'Stop a medication on a person\'s list. Comes back as a preview first; call again with confirmed true once the user agrees.',
  add_allergy: 'Record an allergy or intolerance for a person.',
  remove_allergy: 'Remove an allergy from a person\'s record.',
  add_condition: 'Record a health condition or diagnosis for a person.',
  log_condition: 'Log how a condition is going today for a person.',
  remove_condition: 'Remove a condition recorded in error.',
  resolve_condition: 'Mark a person\'s condition as resolved.',
  add_substance: 'Record substance use for a person, such as alcohol or nicotine.',
  update_substance: 'Change a substance use record for a person.',
  remove_substance: 'Remove a substance use record.',
  add_neurotype_attribute: 'Record a neurotype trait, need or support for a person.',
  remove_neurotype_attribute: 'Remove a neurotype trait, need or support.',
  add_symptom: 'Record a symptom for a person.',
  update_symptom: 'Change a symptom record for a person.',
  add_treatment: 'Add a treatment or therapy a person is having.',
  raise_question: 'Raise an open question for the person\'s care circle to answer.',
  set_care_phase: 'Set the stage of care a person is in.',
  add_provider: 'Add a provider (doctor, specialist, pharmacy, clinic and so on) and link them to this person. Set organisation to the clinic or practice they work at: it is filed if new and they share its address.',
  add_asset: 'File a piece of equipment, such as a wheelchair or CPAP machine, and link it to this person.',
  update_provider: 'Change the details of a provider linked to this person, including where they work.',
  link_provider: 'Link a provider already in the directory to this person, without making a duplicate.',
  link_address: 'Link an address already in the directory to this person as where they live.',
  update_care_plan: 'Update a person\'s care needs: diet, mobility aids, communication needs and the like.',
  update_profile: 'Update a person\'s profile details.',
  book_appointment: 'Book an appointment for a person, optionally with a provider from the directory.',
  update_appointment: 'Change or cancel one of a person\'s appointments.',
  record_appointment_outcome: 'Record how one of a person\'s appointments went and each next step it set off, such as a referral, a blood test, a sample to give or a prescription to fill. Each next step becomes a task that is tracked until done.',
  complete_task: 'Tick off one of a person\'s tasks as done. Only when the user has said it is done.',
  reschedule_task: 'Move one of a person\'s tasks to a new time.',
  record_cost: 'Record a health cost for a person, with who paid and any claim.',
  record_reading: 'Record a reading for a person\'s treatment, such as a blood pressure or CPAP session.',
};

/** Actions that change the medication list wait for the person to agree. */
const NEEDS_CONFIRMATION = new Set(['add_medication', 'update_medication', 'stop_medication']);

/** Actions that are not offered as tools: handled differently here. */
const SKIPPED_ACTIONS = new Set(['need_clarification', 'add_to_practice']);

type PersonResult =
  | { ok: true; profileId: string; name: string; access: CareAccess }
  | { ok: false; message: string };

/** Everyday words for a relationship, mapped to how it is usually recorded. */
const RELATION_WORDS: Record<string, string[]> = {
  mother: ['mum', 'mom', 'mother', 'mam', 'ma', 'mummy', 'mommy'],
  father: ['dad', 'father', 'pa', 'daddy'],
  grandmother: ['nan', 'nana', 'nanna', 'gran', 'granny', 'grandma', 'grandmother', 'oma'],
  grandfather: ['pop', 'pops', 'grandpa', 'grandad', 'granddad', 'grandfather', 'opa'],
  wife: ['wife'],
  husband: ['husband'],
  partner: ['partner'],
  son: ['son'],
  daughter: ['daughter'],
  brother: ['brother'],
  sister: ['sister'],
  self: ['me', 'myself', 'self', 'i'],
};

/**
 * "Mum", "my dad", "Nan": find the one person whose recorded relationship
 * matches, among those this account looks after. Null unless exactly one.
 */
async function resolveByRelationship(spoken: string, account: Account): Promise<PersonResult | null> {
  const word = spoken.toLowerCase().replace(/^(my|our)\s+/, '').replace(/['’]s$/, '').trim();
  const relation = Object.entries(RELATION_WORDS).find(([, words]) => words.includes(word))?.[0];
  const people = await listReachableProfiles(account.id);
  if (people.length === 0) return null;
  const rows: Array<{ id: string; owner_relationship: string | null; contact_kind?: string | null }> = await db('care_profiles')
    .whereIn('id', people.map((p) => p.id))
    .select('id', 'owner_relationship');
  const wanted = relation ? [relation, ...RELATION_WORDS[relation]] : [word];
  const hits = rows.filter((r) => {
    const rel = String(r.owner_relationship ?? '').toLowerCase().trim();
    return rel !== '' && wanted.some((w) => rel === w || rel.split(/\s+/).includes(w));
  });
  if (hits.length !== 1) return null;
  const person = people.find((p) => p.id === hits[0].id)!;
  return { ok: true, profileId: person.id, name: person.name, access: person.access };
}

async function resolvePerson(name: unknown, account: Account): Promise<PersonResult> {
  const spoken = typeof name === 'string' ? name.trim() : '';
  if (!spoken) return { ok: false, message: 'Say who this is for: the "person" field needs a name. Use list_people to see who is in their care.' };
  const resolved = await resolveProfileByName(spoken, account.id);
  if (resolved) return { ok: true, ...resolved };
  const byRelation = await resolveByRelationship(spoken, account);
  if (byRelation) return byRelation;
  const candidates = await candidateProfileNames(spoken, account.id);
  if (candidates.length > 1) {
    return { ok: false, message: `Nothing was saved: "${spoken}" could be ${candidates.join(' or ')}. Ask the user which one.` };
  }
  return { ok: false, message: `Nothing was saved: no one in their care is called "${spoken}". Use list_people to see the names.` };
}

function describePreview(type: string, args: Record<string, unknown>, person: string): string {
  const fields = Object.entries(args)
    .filter(([k, v]) => v !== undefined && v !== null && v !== '' && k !== 'type')
    .map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${Array.isArray(v) || typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n');
  const verb = type === 'add_medication' ? 'add this medication' : type === 'stop_medication' ? 'stop this medication' : 'change this medication';
  return `Not saved yet. Ready to ${verb} for ${person}:\n${fields}\n\nRead this back to the user. When they agree, call ${type} again with exactly the same details and "confirmed": true.`;
}

function actionTools(): ToolDef[] {
  const options = (actionSchema as unknown as { options: z.ZodObject<z.ZodRawShape>[] }).options;
  const tools: ToolDef[] = [];
  for (const option of options) {
    const type = (option.shape['type'] as z.ZodLiteral<string>).value;
    if (SKIPPED_ACTIONS.has(type)) continue;
    const schema = toJsonSchema(option) as { properties?: Record<string, unknown>; required?: string[] };
    const properties: Record<string, unknown> = { person: PERSON_PROP, ...(schema.properties ?? {}) };
    delete properties['type'];
    const required = ['person', ...(schema.required ?? []).filter((r) => r !== 'type')];
    if (NEEDS_CONFIRMATION.has(type)) {
      properties['confirmed'] = {
        type: 'boolean',
        description: 'Leave out the first time to get a preview. Set true only after the user has agreed to the preview.',
      };
    }
    tools.push({
      name: type,
      title: type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      description: ACTION_DESCRIPTIONS[type] ?? `Carry out "${type.replace(/_/g, ' ')}" for a person in their care.`,
      inputSchema: { type: 'object', properties, required, additionalProperties: false },
      write: true,
      run: async (args, ctx) => {
        const { person, confirmed, ...rest } = args;
        const parsed = actionSchema.safeParse({ ...rest, type });
        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
          return `Nothing was saved: some details did not fit. ${issues}`;
        }
        const target = await resolvePerson(person, ctx.account);
        if (!target.ok) return target.message;
        if (target.access.level === 'viewer') return `Nothing was saved: they have view-only access to ${target.name}.`;
        if (NEEDS_CONFIRMATION.has(type) && confirmed !== true) return describePreview(type, rest, target.name);

        const undoBatch = randomUUID();
        const outcomes = await executeActions([parsed.data as AssistantAction], target.profileId, ctx.account, target.access, ctx.timeZone, {
          source: 'assistant',
          undoBatch,
        });
        const reversible = await batchIsReversible(target.profileId, undoBatch);
        const undo = reversible ? `\n\nTo undo this within 30 minutes, call undo with person "${target.name}" and change_code "${undoBatch}".` : '';
        return `${target.name}: ${outcomes.join(' ')}${undo}`;
      },
    });
  }
  return tools;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A time zone Postgres and Intl both accept, or UTC. */
function safeZone(tz: string | null): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * Everything recorded for one person over a period, in date order within
 * each kind, for preparing a claim, a funding review or an appointment.
 */
async function recordsBetween(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const target = await resolvePerson(args['person'], ctx.account);
  if (!target.ok) return target.message.replace('Nothing was saved: ', '');
  const zone = safeZone(ctx.timeZone);
  const today = dateInZone(new Date(), zone);
  const from = typeof args['from'] === 'string' && DATE_RE.test(args['from']) ? args['from'] : null;
  const to = typeof args['to'] === 'string' && DATE_RE.test(args['to']) ? args['to'] : today;
  if (!from) return 'Give a start date as YYYY-MM-DD, for example 2026-08-01.';
  if (from > to) return 'The start date is after the end date. Swap them and try again.';
  const LIMIT = 400;
  const localDate = (col: string) => db.raw(`(${col} AT TIME ZONE ?)::date`, [zone]);
  const within = (q: import('knex').Knex.QueryBuilder, col: string) =>
    q.whereBetween(localDate(col) as unknown as string, [from, to]);
  const pid = target.profileId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>;
  const [log, tracking, readings, appointments]: Row[][] = await Promise.all([
    within(db('care_log_entries').where({ care_profile_id: pid }), 'occurred_at')
      .select('occurred_at', 'entry_type', 'title', 'body')
      .orderBy('occurred_at', 'asc')
      .limit(LIMIT),
    within(
      db('condition_log_entries as l').join('medical_conditions as c', 'c.id', 'l.medical_condition_id').where('c.care_profile_id', pid),
      'l.occurred_at'
    )
      .select('l.occurred_at', 'c.name as condition', 'l.title', 'l.body')
      .orderBy('l.occurred_at', 'asc')
      .limit(LIMIT),
    within(
      db('condition_symptom_readings as r')
        .join('condition_symptoms as s', 's.id', 'r.symptom_id')
        .join('medical_conditions as c', 'c.id', 's.condition_id')
        .where('c.care_profile_id', pid),
      'r.recorded_at'
    )
      .select('r.recorded_at', 's.name as symptom', 'r.severity', 'c.name as condition')
      .orderBy('r.recorded_at', 'asc')
      .limit(LIMIT),
    within(db('appointments as a').leftJoin('providers as p', 'p.id', 'a.provider_id').where('a.care_profile_id', pid), 'a.starts_at')
      .select('a.starts_at', 'a.title', 'a.appointment_type', 'a.status', 'a.location', 'a.notes', 'a.outcome', 'p.name as provider')
      .orderBy('a.starts_at', 'asc')
      .limit(LIMIT),
  ]);

  // The spend ledger is owner and admin only, as everywhere else.
  const seesCosts = target.access.level === 'owner' || target.access.level === 'admin';
  const costs: Row[] = seesCosts
    ? await db('health_spend_entries')
        .where({ care_profile_id: pid })
        .whereBetween('spent_on', [from, to])
        .select(db.raw("to_char(spent_on, 'YYYY-MM-DD') as spent_on"), 'amount', 'description', 'funding_source', 'claimable_amount', 'claim_status', 'status')
        .orderBy('spent_on', 'asc')
        .limit(LIMIT)
    : [];

  const when = (d: Date | string) => formatInZone(new Date(d), zone);
  const day = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : dateInZone(d, zone));
  const words = (v: unknown) => String(v ?? '').replace(/_/g, ' ');
  const section = (title: string, rows: string[]) =>
    `## ${title}: ${rows.length}${rows.length === LIMIT ? ' or more, the earliest shown' : ''}\n${rows.length ? rows.join('\n') : 'None recorded.'}`;

  const parts = [
    `# ${target.name}, ${from} to ${to}`,
    section('Care log', log.map((r) => `- ${when(r.occurred_at)}, ${words(r.entry_type)}${r.title ? `, ${r.title}` : ''}: ${r.body}`)),
    section('Condition tracking', tracking.map((r) => `- ${when(r.occurred_at)}, ${r.condition}${r.title ? `, ${r.title}` : ''}: ${r.body}`)),
    section('Symptom readings, severity out of 10', readings.map((r) => `- ${when(r.recorded_at)}, ${r.symptom} (${r.condition}): ${r.severity}`)),
    section(
      'Appointments',
      appointments.map(
        (r) =>
          `- ${when(r.starts_at)}, ${r.title}${r.provider ? ` with ${r.provider}` : ''}${r.location ? ` at ${r.location}` : ''}, ${words(r.appointment_type)}, ${words(r.status)}${r.notes ? `. Notes: ${r.notes}` : ''}${r.outcome ? `. Outcome: ${r.outcome}` : ''}`
      )
    ),
    seesCosts
      ? section(
          'Costs',
          costs.map(
            (r) =>
              `- ${day(r.spent_on)}, ${r.amount}${r.status === 'estimated' ? ' (estimated)' : ''}${r.description ? `, ${r.description}` : ''}${r.funding_source ? `, paid by ${words(r.funding_source)}` : ''}${r.claimable_amount != null ? `, claimable ${r.claimable_amount}` : ''}, claim ${words(r.claim_status)}`
          )
        )
      : '## Costs\nOnly the person who owns this record can see its costs.',
  ];
  return parts.join('\n\n');
}

const READ_TOOLS: ToolDef[] = [
  {
    name: 'get_recording_guide',
    title: 'How to keep good records',
    description: 'How to record daily check-ins, appointments, costs and notes that hold up for a claim or review. Read this before logging anything, if you have not already.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    write: false,
    run: async () => RECORDING_GUIDE,
  },
  {
    name: 'get_records_between',
    title: 'Records for a period',
    description: 'Everything recorded for one person between two dates: care log, condition tracking, symptom readings, appointments and costs with their claim status. Use it to prepare for a claim, a funding review or an appointment.',
    inputSchema: {
      type: 'object',
      properties: {
        person: PERSON_PROP,
        from: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
        to: { type: 'string', description: 'End date, YYYY-MM-DD. Defaults to today.' },
      },
      required: ['person', 'from'],
      additionalProperties: false,
    },
    write: false,
    run: recordsBetween,
  },
  {
    name: 'list_people',
    title: 'List people in their care',
    description: 'Everyone (and every pet) in this person\'s care, with whether they can change records or only look. Call this first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    write: false,
    run: async (_args, ctx) => {
      const people = await listReachableProfiles(ctx.account.id);
      if (people.length === 0) return 'No one is in their care in PareCare yet. They can add someone in the app.';
      const rel = new Map<string, string | null>(
        (await db('care_profiles').whereIn('id', people.map((p) => p.id)).select('id', 'owner_relationship')).map((r) => [r.id, r.owner_relationship])
      );
      const lines = people.map((p) => {
        const relation = rel.get(p.id);
        return `- ${p.name}${relation ? ` (their ${relation})` : ''}: ${p.access.level === 'viewer' ? 'can look only' : 'can add and change records'}`;
      });
      return `In their care:\n${lines.join('\n')}`;
    },
  },
  {
    name: 'get_person',
    title: 'Read a person\'s record',
    description: 'A summary of one person\'s current record: medications, recent doses, tasks, appointments, conditions, allergies, providers, recent care log and more.',
    inputSchema: { type: 'object', properties: { person: PERSON_PROP }, required: ['person'], additionalProperties: false },
    write: false,
    run: async (args, ctx) => {
      const target = await resolvePerson(args['person'], ctx.account);
      if (!target.ok) return target.message.replace('Nothing was saved: ', '');
      const profile = await db<CareProfile>('care_profiles').where({ id: target.profileId }).first();
      if (!profile) return 'That record could not be found.';
      return buildProfileContext(profile, target.access, ctx.timeZone);
    },
  },
  {
    name: 'list_providers',
    title: 'Search the provider directory',
    description: 'Their directory of organisations (clinics, health hubs, pharmacies, government departments, agencies) and professionals (doctors, specialists, lawyers, caseworkers). Shows whether each is an organisation or a professional, where each is based, their type, phone, address and who they are linked to. Optionally filter by a word, or to organisations or professionals only.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Part of a name, organisation or type, e.g. "Health Hub" or "neuro".' },
        kind: { type: 'string', enum: ['organisation', 'person'], description: '"organisation" for organisations only, "person" for professionals only.' },
      },
      additionalProperties: false,
    },
    write: false,
    run: async (args, ctx) => {
      const search = typeof args['search'] === 'string' ? args['search'].trim() : '';
      let q = db('providers as p')
        .where('p.account_id', ctx.account.id)
        .select(
          'p.name', 'p.kind', 'p.provider_type', 'p.organisation', 'p.phone', 'p.email', 'p.address', 'p.also_known_as',
          db.raw(`(SELECT string_agg(cp.full_name, ', ' ORDER BY cp.full_name) FROM care_profile_providers cpp JOIN care_profiles cp ON cp.id = cpp.care_profile_id WHERE cpp.provider_id = p.id) AS linked`),
          db.raw('(SELECT count(*)::int FROM providers m WHERE m.practice_id = p.id) AS member_count'),
        )
        .orderBy('p.name', 'asc')
        .limit(100);
      if (args['kind'] === 'organisation' || args['kind'] === 'person') q = q.where('p.kind', args['kind'] as string);
      if (search) {
        q = q.where((w) => {
          w.whereILike('p.name', `%${search}%`).orWhereILike('p.organisation', `%${search}%`).orWhereILike('p.provider_type', `%${search}%`).orWhereRaw("array_to_string(p.also_known_as, ' ') ilike ?", [`%${search}%`]);
        });
      }
      const rows = await q;
      if (rows.length === 0) return search ? `Nothing in the directory matches "${search}".` : 'The directory has no organisations or professionals yet.';
      const label = (t: string) => BUILT_IN_PROVIDER_TYPES.find((b) => b.value === t)?.label ?? t;
      return rows
        .map((r) => {
          const parts = [
            `${r.name}`,
            r.kind === 'organisation' ? 'organisation' : 'professional',
            `type: ${label(r.provider_type)}`,
            r.also_known_as?.length ? `also known as: ${r.also_known_as.join(', ')}` : null,
            r.organisation ? `based at: ${r.organisation}` : null,
            r.member_count ? `based here: ${r.member_count}` : null,
            r.phone ? `phone: ${r.phone}` : null,
            r.email ? `email: ${r.email}` : null,
            r.address ? `address: ${r.address}` : null,
            r.linked ? `linked to: ${r.linked}` : null,
          ].filter(Boolean);
          return `- ${parts.join('; ')}`;
        })
        .join('\n');
    },
  },
];

const ACCOUNT_TOOLS: ToolDef[] = [
  {
    name: 'add_to_practice',
    title: 'File someone at their organisation',
    description: 'File a professional, or a smaller organisation such as a clinic, at an organisation in the directory, e.g. "add Dr Carly Examplename to Health Hub Morayfield". Either side is found by name or filed if new, and whoever is filed there shares its address. Saying it twice changes nothing. Does not link them to anyone; use add_provider for that.',
    inputSchema: {
      type: 'object',
      properties: {
        practitioner: { type: 'string', description: 'Their name, e.g. "Dr Carly Examplename".' },
        practice: { type: 'string', description: 'The organisation they are based at, e.g. "Neuro Clinic", "Health Hub Morayfield" or "Department of Justice".' },
        part_of: { type: 'string', description: 'The bigger organisation that one is inside, if any, e.g. "Health Hub Morayfield". It is filed there too.' },
        provider_type: { type: 'string', description: 'What kind of professional they are, in plain words, e.g. "GP", "Neurologist", "Caseworker".' },
        phone: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['practitioner', 'practice'],
      additionalProperties: false,
    },
    write: true,
    run: async (args, ctx) => {
      const str = (k: string) => (typeof args[k] === 'string' && (args[k] as string).trim() ? (args[k] as string).trim() : null);
      const practitioner = str('practitioner');
      const practice = str('practice');
      if (!practitioner || !practice) return 'Nothing was saved: both who is being filed and the organisation need a name.';
      const { outcome } = await addPracticeMember(ctx.account.id, practitioner, practice, {
        part_of: str('part_of'),
        provider_type: str('provider_type'),
        phone: str('phone'),
        email: str('email'),
      });
      return outcome;
    },
  },
  {
    name: 'undo',
    title: 'Undo a change',
    description: 'Undo a change made through this connector in the last 30 minutes, using the change code its result gave.',
    inputSchema: {
      type: 'object',
      properties: { person: PERSON_PROP, change_code: { type: 'string', description: 'The change code from the result of the change.' } },
      required: ['person', 'change_code'],
      additionalProperties: false,
    },
    write: true,
    run: async (args, ctx) => {
      const code = typeof args['change_code'] === 'string' ? args['change_code'].trim() : '';
      if (!z.string().uuid().safeParse(code).success) return 'That change code does not look right. Use the code exactly as the change gave it.';
      const target = await resolvePerson(args['person'], ctx.account);
      if (!target.ok) return target.message.replace('Nothing was saved: ', '');
      const result = await undoActionBatch(target.profileId, code, ctx.account);
      return result.message;
    },
  },
];

let cachedTools: ToolDef[] | null = null;
function allTools(): ToolDef[] {
  cachedTools ??= [...READ_TOOLS, ...ACCOUNT_TOOLS, ...actionTools()];
  return cachedTools;
}

function toolListing(canWrite: boolean) {
  return allTools()
    .filter((t) => canWrite || !t.write)
    .map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: {
        title: t.title,
        readOnlyHint: !t.write,
        destructiveHint: t.write && /^(remove|stop|resolve|update|reschedule|complete|undo)/.test(t.name),
        idempotentHint: !t.write || t.name === 'add_to_practice',
        openWorldHint: false,
      },
    }));
}

// ── JSON-RPC ───────────────────────────────────────────────────────────

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcResult = (id: RpcMessage['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: RpcMessage['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(msg: RpcMessage, ctx: ToolContext): Promise<object | null> {
  const isNotification = msg.id === undefined || msg.id === null;
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return isNotification ? null : rpcError(msg?.id, -32600, 'Invalid request');
  }
  if (msg.method.startsWith('notifications/')) return null;

  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.['protocolVersion'] ?? '');
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : LATEST_VERSION,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: 'parecare', title: 'PareCare', version: '1.0.0' },
        // The connector notes, then the shared recording guide, so any
        // assistant that reads start-up instructions keeps records well.
        instructions: `${INSTRUCTIONS}\n\n${RECORDING_GUIDE}`,
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: toolListing(ctx.canWrite) });
    case 'tools/call': {
      const name = String(msg.params?.['name'] ?? '');
      const args = (msg.params?.['arguments'] ?? {}) as Record<string, unknown>;
      const tool = allTools().find((t) => t.name === name);
      if (!tool) return rpcError(msg.id, -32602, `There is no tool called ${name}.`);
      if (tool.write && !ctx.canWrite) {
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: 'Nothing was saved: this connection was set up to look only. The person can reconnect with permission to add records.' }],
          isError: true,
        });
      }
      try {
        const text = await tool.run(args, ctx);
        const failed = /^Nothing was saved/.test(text);
        return rpcResult(msg.id, { content: [{ type: 'text', text }], isError: failed });
      } catch (err) {
        console.warn('Connector tool failed:', name, (err as Error).message);
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: 'That could not be saved because something went wrong on the PareCare side. Nothing was changed. Try again, or do it in the app.' }],
          isError: true,
        });
      }
    }
    case 'resources/list':
      return rpcResult(msg.id, { resources: [] });
    case 'prompts/list':
      return rpcResult(msg.id, {
        prompts: GUIDE_PROMPTS.map((p) => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments })),
      });
    case 'prompts/get': {
      const prompt = GUIDE_PROMPTS.find((p) => p.name === String(msg.params?.['name'] ?? ''));
      if (!prompt) return rpcError(msg.id, -32602, 'There is no prompt by that name.');
      const raw = (msg.params?.['arguments'] ?? {}) as Record<string, unknown>;
      const args = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? '')]));
      return rpcResult(msg.id, {
        description: prompt.description,
        messages: [{ role: 'user', content: { type: 'text', text: prompt.render(args) } }],
      });
    }
    default:
      return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

mcpRouter.post('/', mcpAuth, async (req, res) => {
  const account = req.account!;
  const ctx: ToolContext = {
    account,
    canWrite: req.connectionAccess !== 'read',
    // The person's own zone, else the server's: the same zone the action
    // engine falls back to, so a time saved and a time read back agree.
    timeZone: (req.headers['x-time-zone'] as string) || account.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  };
  const body = req.body as RpcMessage | RpcMessage[];
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handle(m, ctx)))).filter((r): r is object => r !== null);
    if (replies.length === 0) {
      res.status(202).end();
      return;
    }
    res.json(replies);
    return;
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json(rpcError(null, -32700, 'Parse error'));
    return;
  }
  const reply = await handle(body, ctx);
  if (!reply) {
    res.status(202).end();
    return;
  }
  res.json(reply);
});

// No server-initiated stream and no sessions: say so plainly.
mcpRouter.get('/', (_req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({ error: 'Connect with POST. This connector does not keep a stream open.' });
});
mcpRouter.delete('/', (_req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({ error: 'There is no session to end.' });
});

/**
 * The recording guide for people to give their assistant by hand: plain
 * standing instructions for a custom instructions box, or a skill file for
 * assistants that load skills. Same text the connector itself serves.
 */
export const assistantGuideRouter = Router();

assistantGuideRouter.get('/', requireAuth, (_req, res) => {
  const address = `${env.APP_URL}/api/v1/mcp`;
  res.json({ instructions: recordingInstructions(address), skill: recordingSkill(address) });
});
