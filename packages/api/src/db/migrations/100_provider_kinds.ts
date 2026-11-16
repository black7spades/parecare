import type { Knex } from 'knex';
import { ORGANISATION_TYPES, isBuiltInProviderType, kindFor, placeTypeFromName } from '../../lib/providerTypes';

/**
 * Organisations and professionals, filed apart.
 *
 * The directory held clinics, health hubs, government departments and the
 * doctors and caseworkers in them as one list of "providers". Each record
 * now says which it is, worked out from what is already there: anything
 * with someone based at it, or filed under a kind of place, or named like
 * one ("Department of Justice"), is an organisation; a name with a title
 * ("Dr Karen Sank") is always a professional.
 *
 * Kinds of organisation get a shared list of their own, apart from the
 * kinds of professional, so each form offers only the kinds that fit.
 */
const NEW_PERSON_TYPES = ['Accountant', 'Case manager', 'Doctor', 'Support coordinator', 'Support worker'];

async function ensure(knex: Knex, category: string, name: string): Promise<void> {
  const exists = await knex('option_catalogue').where({ category }).whereRaw('lower(name) = lower(?)', [name]).first();
  if (!exists) await knex('option_catalogue').insert({ category, name });
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.text('kind').notNullable().defaultTo('person');
    t.index(['account_id', 'kind']);
  });
  await knex.raw("ALTER TABLE providers ADD CONSTRAINT providers_kind_check CHECK (kind IN ('organisation', 'person'))");

  const rows = (await knex('providers').select('id', 'name', 'provider_type')) as Array<{ id: string; name: string; provider_type: string }>;
  const parents = new Set(
    ((await knex('providers').whereNotNull('practice_id').distinct('practice_id')) as Array<{ practice_id: string }>).map((r) => r.practice_id)
  );
  const orgIds: string[] = [];
  const doctorIds: string[] = [];
  const retyped: Array<{ id: string; type: string }> = [];
  const PERSON_ONLY = new Set(['gp', 'specialist', 'psychologist', 'vet', 'allied_health', 'legal', 'financial', 'social_worker', 'other']);
  for (const r of rows) {
    const kind = parents.has(r.id) ? 'organisation' : kindFor(r.provider_type, r.name);
    if (kind === 'organisation') {
      orgIds.push(r.id);
      // An organisation filed as "Other" or as a kind of professional gets a
      // kind of organisation from its name: the Department of Justice becomes
      // a Government department, Smith Lawyers a Law firm.
      if (PERSON_ONLY.has(String(r.provider_type))) retyped.push({ id: r.id, type: placeTypeFromName(r.name) });
    } else if (ORGANISATION_TYPES.some((t) => t.toLowerCase() === String(r.provider_type).toLowerCase())) {
      // A doctor filed as a place: keep them a doctor, not a "Practice".
      doctorIds.push(r.id);
    }
  }
  for (let i = 0; i < orgIds.length; i += 500) {
    await knex('providers').whereIn('id', orgIds.slice(i, i + 500)).update({ kind: 'organisation' });
  }
  if (doctorIds.length > 0) await knex('providers').whereIn('id', doctorIds).update({ provider_type: 'Doctor' });
  for (const r of retyped) await knex('providers').where({ id: r.id }).update({ provider_type: r.type });

  // Kinds of organisation get their own list.
  for (const name of ORGANISATION_TYPES.filter((t) => !isBuiltInProviderType(t))) await ensure(knex, 'organisation_type', name);
  const orgCustom = (await knex('providers').where({ kind: 'organisation' }).distinct('provider_type')) as Array<{ provider_type: string }>;
  const personCustom = new Set(
    ((await knex('providers').where({ kind: 'person' }).distinct('provider_type')) as Array<{ provider_type: string }>).map((r) =>
      String(r.provider_type).toLowerCase()
    )
  );
  for (const { provider_type } of orgCustom) {
    if (!provider_type || isBuiltInProviderType(provider_type)) continue;
    await ensure(knex, 'organisation_type', provider_type);
    // Only organisations use it: it is no longer offered for professionals.
    if (!personCustom.has(provider_type.toLowerCase())) {
      await knex('option_catalogue').where({ category: 'provider_type' }).whereRaw('lower(name) = lower(?)', [provider_type]).delete();
    }
  }
  for (const name of ORGANISATION_TYPES) {
    if (!personCustom.has(name.toLowerCase())) {
      await knex('option_catalogue').where({ category: 'provider_type' }).whereRaw('lower(name) = lower(?)', [name]).delete();
    }
  }
  for (const name of NEW_PERSON_TYPES) await ensure(knex, 'provider_type', name);
}

export async function down(knex: Knex): Promise<void> {
  const orgTypes = (await knex('option_catalogue').where({ category: 'organisation_type' }).select('name')) as Array<{ name: string }>;
  for (const { name } of orgTypes) await ensure(knex, 'provider_type', name);
  await knex('option_catalogue').where({ category: 'organisation_type' }).delete();
  await knex.raw('ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_kind_check');
  await knex.schema.alterTable('providers', (t) => {
    t.dropIndex(['account_id', 'kind']);
    t.dropColumn('kind');
  });
}
