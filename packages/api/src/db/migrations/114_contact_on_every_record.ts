import type { Knex } from 'knex';

/**
 * A contact on every record.
 *
 * 1. Contacts gain an after-hours phone, a fax and opening hours. A contact
 *    linked to a person can be the main one of its kind for them (their GP,
 *    their pharmacy) and can be marked as no longer seen from a date.
 * 2. A medicine knows who prescribes it and the visit it started at; a
 *    condition who treats it; a treatment who provides it; equipment its
 *    supplier. A supplier knows when it is the same business as a contact.
 * 3. The account holder has a phone of their own, kept once.
 * 4. Emergency contacts point at the person or contact they are, so a
 *    number changed in one place changes everywhere. Only someone not in
 *    PareCare keeps a typed name and phone.
 * 5. A care plan reviewer can be picked from Contacts or the circle.
 * 6. New kinds of contact, and two new circle roles: support worker, nurse.
 */

const NEW_PERSON_TYPES = [
  'Behaviour support practitioner',
  'Care coordinator',
  'Local Area Coordinator',
  'Pharmacist',
  'Plan manager',
  'Teacher',
  'Teacher aide',
];
const NEW_ORG_TYPES = ['Plan management provider', 'Respite service'];

async function ensure(knex: Knex, category: string, name: string): Promise<void> {
  const exists = await knex('option_catalogue').where({ category }).whereRaw('lower(name) = lower(?)', [name]).first();
  if (!exists) await knex('option_catalogue').insert({ category, name });
}

const norm = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.string('fax', 50).nullable();
    t.string('after_hours_phone', 50).nullable();
    t.jsonb('opening_hours').nullable();
  });
  await knex.schema.alterTable('care_profile_providers', (t) => {
    t.boolean('is_main').notNullable().defaultTo(false);
    t.date('ended_on').nullable();
  });
  await knex.schema.alterTable('medications', (t) => {
    t.uuid('prescriber_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.uuid('source_appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
    t.index(['prescriber_provider_id']);
    t.index(['source_appointment_id']);
  });
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.uuid('treating_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.index(['treating_provider_id']);
  });
  await knex.schema.alterTable('treatments', (t) => {
    t.uuid('practitioner_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.index(['practitioner_provider_id']);
  });
  await knex.schema.alterTable('assets', (t) => {
    t.uuid('supplier_id').nullable().references('id').inTable('suppliers').onDelete('SET NULL');
    t.index(['supplier_id']);
  });
  await knex.schema.alterTable('suppliers', (t) => {
    t.uuid('provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.index(['provider_id']);
  });
  await knex.schema.alterTable('accounts', (t) => {
    t.string('phone', 50).nullable();
  });
  await knex.schema.alterTable('care_plan_reviews', (t) => {
    t.uuid('provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.uuid('circle_member_id').nullable().references('id').inTable('care_circle_members').onDelete('SET NULL');
    t.index(['provider_id']);
    t.index(['circle_member_id']);
  });

  await knex.schema.createTable('emergency_contacts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.uuid('circle_member_id').nullable().references('id').inTable('care_circle_members').onDelete('CASCADE');
    t.uuid('account_id').nullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.uuid('provider_id').nullable().references('id').inTable('providers').onDelete('CASCADE');
    t.string('name', 255).nullable();
    t.string('phone', 50).nullable();
    t.string('relationship', 100).nullable();
    t.timestamps(true, true);
    t.index(['care_profile_id']);
    t.index(['circle_member_id']);
    t.index(['account_id']);
    t.index(['provider_id']);
  });
  // Exactly one source: one of the three references, or a typed name.
  await knex.raw(`
    ALTER TABLE emergency_contacts ADD CONSTRAINT emergency_contacts_one_source CHECK (
      ((circle_member_id IS NOT NULL)::int + (account_id IS NOT NULL)::int + (provider_id IS NOT NULL)::int
        + (CASE WHEN circle_member_id IS NULL AND account_id IS NULL AND provider_id IS NULL AND name IS NOT NULL THEN 1 ELSE 0 END)) = 1
    )
  `);
  await knex.raw('CREATE UNIQUE INDEX emergency_contacts_member_unique ON emergency_contacts (care_profile_id, circle_member_id) WHERE circle_member_id IS NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX emergency_contacts_account_unique ON emergency_contacts (care_profile_id, account_id) WHERE account_id IS NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX emergency_contacts_provider_unique ON emergency_contacts (care_profile_id, provider_id) WHERE provider_id IS NOT NULL');

  // ── Backfills ──────────────────────────────────────────────────────────

  // The first contact of each kind linked to a person is their main one.
  await knex.raw(`
    UPDATE care_profile_providers cpp SET is_main = true
      FROM (
        SELECT DISTINCT ON (c.care_profile_id, lower(p.provider_type)) c.id
          FROM care_profile_providers c JOIN providers p ON p.id = c.provider_id
         ORDER BY c.care_profile_id, lower(p.provider_type), c.created_at ASC, c.id
      ) first_link
     WHERE cpp.id = first_link.id
  `);

  // Equipment: the supplier typed in words becomes the supplier on file,
  // filed new when the account has none of that name.
  await knex.raw(`
    INSERT INTO suppliers (account_id, name)
    SELECT DISTINCT ON (a.account_id, lower(trim(a.supplier))) a.account_id, trim(a.supplier)
      FROM assets a
     WHERE a.supplier IS NOT NULL AND trim(a.supplier) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM suppliers s WHERE s.account_id = a.account_id AND lower(trim(s.name)) = lower(trim(a.supplier))
       )
     ORDER BY a.account_id, lower(trim(a.supplier))
  `);
  await knex.raw(`
    UPDATE assets a SET supplier_id = s.id
      FROM suppliers s
     WHERE s.account_id = a.account_id AND a.supplier IS NOT NULL
       AND lower(trim(s.name)) = lower(trim(a.supplier))
  `);

  // A supplier that is also an organisation in Contacts is the same business.
  await knex.raw(`
    UPDATE suppliers s SET provider_id = (
      SELECT p.id FROM providers p
       WHERE p.account_id = s.account_id AND p.kind = 'organisation'
         AND lower(regexp_replace(trim(p.name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(s.name), '\\s+', ' ', 'g'))
       ORDER BY p.created_at ASC LIMIT 1)
     WHERE s.provider_id IS NULL
  `);

  // The account holder's phone, from the circle rows of their account when
  // those all give the same number.
  await knex.raw(`
    UPDATE accounts a SET phone = one.phone
      FROM (
        SELECT account_id, min(trim(phone)) AS phone
          FROM care_circle_members
         WHERE account_id IS NOT NULL AND phone IS NOT NULL AND trim(phone) <> ''
         GROUP BY account_id
        HAVING count(DISTINCT regexp_replace(phone, '[^0-9+]', '', 'g')) = 1
      ) one
     WHERE a.id = one.account_id AND (a.phone IS NULL OR trim(a.phone) = '')
  `);

  // Circle roles: support worker and nurse join the list.
  await knex.raw(
    `UPDATE care_circle_members SET role = CASE lower(trim(role))
        WHEN 'support worker' THEN 'support_worker' WHEN 'support_worker' THEN 'support_worker'
        WHEN 'nurse' THEN 'nurse' END
      WHERE lower(trim(role)) IN ('support worker', 'support_worker', 'nurse')`
  );
  await knex.raw(
    `UPDATE documents d
        SET visible_to_roles = (
          SELECT array_agg(DISTINCT CASE
                   WHEN lower(trim(r)) IN ('support worker', 'support_worker') THEN 'support_worker'
                   WHEN lower(trim(r)) = 'nurse' THEN 'nurse'
                   ELSE r END)
            FROM unnest(d.visible_to_roles) AS r
        )
      WHERE d.visible_to_roles IS NOT NULL AND cardinality(d.visible_to_roles) > 0`
  );

  // New kinds of contact.
  for (const name of NEW_PERSON_TYPES) await ensure(knex, 'provider_type', name);
  for (const name of NEW_ORG_TYPES) await ensure(knex, 'organisation_type', name);

  // Emergency contacts move from the typed list to rows that point at who
  // they are: someone in the circle (their empty phone filled), a linked
  // contact, the account holder, or else a typed name and phone.
  const plans = (await knex('care_plans as pl')
    .join('care_profiles as cp', 'cp.id', 'pl.care_profile_id')
    .join('accounts as a', 'a.id', 'cp.account_id')
    .whereNotNull('pl.emergency_contacts')
    .select('pl.care_profile_id', 'pl.emergency_contacts', 'a.id as account_id', 'a.display_name as account_name')) as Array<{
    care_profile_id: string;
    emergency_contacts: unknown;
    account_id: string;
    account_name: string | null;
  }>;
  for (const plan of plans) {
    const list = Array.isArray(plan.emergency_contacts) ? (plan.emergency_contacts as Array<Record<string, unknown>>) : [];
    if (list.length === 0) continue;
    const members = (await knex('care_circle_members').where({ care_profile_id: plan.care_profile_id }).select('id', 'display_name', 'phone')) as Array<{
      id: string;
      display_name: string;
      phone: string | null;
    }>;
    const linked = (await knex('care_profile_providers as cpp')
      .join('providers as p', 'p.id', 'cpp.provider_id')
      .where('cpp.care_profile_id', plan.care_profile_id)
      .select('p.id', 'p.name')) as Array<{ id: string; name: string }>;
    const used = new Set<string>();
    let order = 0;
    for (const c of list) {
      const name = String(c['name'] ?? '').trim();
      const phone = String(c['phone'] ?? '').trim() || null;
      const relationship = String(c['relationship'] ?? '').trim() || null;
      if (!name) continue;
      const row: Record<string, unknown> = { care_profile_id: plan.care_profile_id, sort_order: order, relationship: relationship?.slice(0, 100) ?? null };
      const member = members.find((m) => norm(m.display_name) === norm(name));
      const contact = member ? undefined : linked.find((p) => norm(p.name) === norm(name));
      if (member) {
        row['circle_member_id'] = member.id;
        if (phone && !String(member.phone ?? '').trim()) await knex('care_circle_members').where({ id: member.id }).update({ phone: phone.slice(0, 50) });
      } else if (contact) {
        row['provider_id'] = contact.id;
      } else if (norm(plan.account_name) && norm(plan.account_name) === norm(name)) {
        row['account_id'] = plan.account_id;
        if (phone) {
          await knex('accounts')
            .where({ id: plan.account_id })
            .where((w) => w.whereNull('phone').orWhereRaw("trim(phone) = ''"))
            .update({ phone: phone.slice(0, 50) });
        }
      } else {
        row['name'] = name.slice(0, 255);
        row['phone'] = phone?.slice(0, 50) ?? null;
      }
      const key = String(row['circle_member_id'] ?? row['provider_id'] ?? row['account_id'] ?? `typed:${norm(name)}`);
      if (used.has(key)) continue;
      used.add(key);
      await knex('emergency_contacts').insert(row);
      order += 1;
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Put the rows back into the typed list, so nothing is lost.
  const rows = (await knex('emergency_contacts as e')
    .leftJoin('care_circle_members as m', 'm.id', 'e.circle_member_id')
    .leftJoin('accounts as a', 'a.id', 'e.account_id')
    .leftJoin('providers as p', 'p.id', 'e.provider_id')
    .orderBy(['e.care_profile_id', 'e.sort_order'])
    .select(
      'e.care_profile_id',
      'e.relationship',
      knex.raw('coalesce(m.display_name, a.display_name, p.name, e.name) as name'),
      knex.raw('coalesce(a.phone, m.phone, p.phone, e.phone) as phone')
    )) as Array<{ care_profile_id: string; relationship: string | null; name: string | null; phone: string | null }>;
  const byProfile = new Map<string, Array<{ name: string; relationship?: string; phone: string }>>();
  for (const r of rows) {
    const list = byProfile.get(r.care_profile_id) ?? [];
    list.push({ name: r.name ?? '', ...(r.relationship ? { relationship: r.relationship } : {}), phone: r.phone ?? '' });
    byProfile.set(r.care_profile_id, list);
  }
  for (const [profileId, list] of byProfile) {
    const plan = await knex('care_plans').where({ care_profile_id: profileId }).first('id');
    if (plan) await knex('care_plans').where({ id: plan.id }).update({ emergency_contacts: JSON.stringify(list) });
    else await knex('care_plans').insert({ care_profile_id: profileId, emergency_contacts: JSON.stringify(list) });
  }
  await knex.schema.dropTableIfExists('emergency_contacts');

  await knex('option_catalogue').where({ category: 'organisation_type' }).whereIn('name', NEW_ORG_TYPES).delete();
  await knex('option_catalogue').where({ category: 'provider_type' }).whereIn('name', NEW_PERSON_TYPES).delete();
  await knex.raw("UPDATE care_circle_members SET role = 'carer' WHERE role IN ('support_worker', 'nurse')");

  await knex.schema.alterTable('care_plan_reviews', (t) => {
    t.dropColumn('circle_member_id');
    t.dropColumn('provider_id');
  });
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('phone');
  });
  await knex.schema.alterTable('suppliers', (t) => {
    t.dropColumn('provider_id');
  });
  await knex.schema.alterTable('assets', (t) => {
    t.dropColumn('supplier_id');
  });
  await knex.schema.alterTable('treatments', (t) => {
    t.dropColumn('practitioner_provider_id');
  });
  await knex.schema.alterTable('medical_conditions', (t) => {
    t.dropColumn('treating_provider_id');
  });
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('source_appointment_id');
    t.dropColumn('prescriber_provider_id');
  });
  await knex.schema.alterTable('care_profile_providers', (t) => {
    t.dropColumn('ended_on');
    t.dropColumn('is_main');
  });
  await knex.schema.alterTable('providers', (t) => {
    t.dropColumn('opening_hours');
    t.dropColumn('after_hours_phone');
    t.dropColumn('fax');
  });
}
