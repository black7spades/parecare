import type { Knex } from 'knex';

/**
 * Practitioners belong to a practice.
 *
 * Until now "organisation" was loose text on each provider, and every
 * provider carried its own copy of the address. Seeing five people at the
 * same clinic meant typing the clinic's address five times. Now:
 *
 * - practice_id: the provider this one works at. A practice is just another
 *   provider (usually of type "practice"), so it can be linked to people,
 *   booked, and shown on an emergency sheet like any other.
 * - uses_practice_address: when true, this provider's address is kept as a
 *   copy of the practice's, and moving the practice moves everyone there.
 *   The address stays in the provider's own columns, so every existing
 *   reader of a provider's address keeps working unchanged.
 * - "organisation" stays, kept in step with the practice's name.
 *
 * Existing records are grouped for the person: every distinct organisation
 * in an account becomes a practice (reusing a provider already named that
 * way), and the providers who named it are linked to it. Nobody has to
 * redo their directory.
 *
 * Provider types join the shared option lists, seeded with common
 * specialties, so "Neurologist" is a choice rather than "Other".
 */

const SEEDED = [
  'Audiologist', 'Cardiologist', 'Chiropractor', 'Counsellor', 'Dentist', 'Dermatologist', 'Dietitian',
  'Endocrinologist', 'Exercise physiologist', 'Gastroenterologist', 'Geriatrician', 'Gynaecologist',
  'Haematologist', 'Hospital', 'Nephrologist', 'Neurologist', 'Neurosurgeon', 'Nurse', 'Obstetrician',
  'Occupational therapist', 'Oncologist', 'Ophthalmologist', 'Optometrist', 'Orthopaedic surgeon', 'Osteopath',
  'Paediatrician', 'Pathology', 'Physiotherapist', 'Podiatrist', 'Psychiatrist', 'Radiology',
  'Respiratory physician', 'Rheumatologist', 'Sleep physician', 'Speech pathologist', 'Surgeon', 'Urologist',
];

const BUILT_IN = new Set(['gp', 'specialist', 'psychologist', 'vet', 'pharmacy', 'practice', 'care_facility', 'allied_health', 'legal', 'financial', 'social_worker', 'other']);

const PARTS = ['address_line1', 'address_line2', 'address_suburb', 'address_state', 'address_postcode', 'address_country'] as const;

type Row = Record<string, unknown> & { id: string; account_id: string; name: string; organisation: string | null };

const hasAddress = (r: Record<string, unknown>) => PARTS.some((k) => String(r[k] ?? '').trim() !== '') || String(r['address'] ?? '').trim() !== '';
const sameAddress = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  PARTS.every((k) => String(a[k] ?? '').trim().toLowerCase() === String(b[k] ?? '').trim().toLowerCase()) &&
  String(a['address'] ?? '').trim().toLowerCase() === String(b['address'] ?? '').trim().toLowerCase();

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.uuid('practice_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.boolean('uses_practice_address').notNullable().defaultTo(false);
    t.index('practice_id');
  });

  // Group existing providers under the organisation they named.
  const named = (await knex('providers').whereNotNull('organisation').whereRaw("trim(organisation) <> ''")) as Row[];
  const byKey = new Map<string, Row[]>();
  for (const r of named) {
    const key = `${r.account_id}|${String(r.organisation).trim().toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  for (const [key, members] of byKey) {
    const accountId = key.slice(0, key.indexOf('|'));
    const orgName = String(members[0].organisation).trim();
    let practice = (await knex('providers')
      .where({ account_id: accountId })
      .whereRaw('lower(trim(name)) = lower(?)', [orgName])
      .first()) as Row | undefined;
    if (!practice) {
      // Take the address most of them share, else the first one given.
      const withAddress = members.filter(hasAddress);
      const source = withAddress[0] ?? {};
      const [created] = await knex('providers')
        .insert({
          account_id: accountId,
          provider_type: 'practice',
          name: orgName,
          ...Object.fromEntries(PARTS.map((k) => [k, (source as Record<string, unknown>)[k] ?? null])),
          address: (source as Record<string, unknown>)['address'] ?? null,
        })
        .returning('*');
      practice = created as Row;
    }
    for (const m of members) {
      if (m.id === practice.id) continue;
      const inherit = !hasAddress(m) || sameAddress(m, practice);
      const update: Record<string, unknown> = { practice_id: practice.id, organisation: practice.name, uses_practice_address: inherit };
      if (inherit) {
        for (const k of PARTS) update[k] = (practice as Record<string, unknown>)[k] ?? null;
        update['address'] = (practice as Record<string, unknown>)['address'] ?? null;
      }
      await knex('providers').where({ id: m.id }).update(update);
    }
  }

  // Shared provider types: the seeded specialties plus every custom type
  // already in use, so nobody's own types disappear from the list.
  const inUse = (await knex('providers').distinct('provider_type')).map((r) => String(r.provider_type ?? '').trim());
  const names = [...new Set([...SEEDED, ...inUse.filter((t) => t && !BUILT_IN.has(t))])];
  for (const name of names) {
    const exists = await knex('option_catalogue').where({ category: 'provider_type' }).whereRaw('lower(name) = lower(?)', [name]).first();
    if (!exists) await knex('option_catalogue').insert({ category: 'provider_type', name });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex('option_catalogue').where({ category: 'provider_type' }).delete();
  await knex.schema.alterTable('providers', (t) => {
    t.dropIndex('practice_id');
    t.dropColumn('uses_practice_address');
    t.dropColumn('practice_id');
  });
}
