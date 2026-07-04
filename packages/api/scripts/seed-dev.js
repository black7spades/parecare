#!/usr/bin/env node
/*
 * Optional development seed: a couple of demo people with a relationship, so
 * the personal-profile and relationship UI has something to show. Idempotent
 * and dev-only — never run automatically. Usage: npm run seed:dev
 */
const bcrypt = require('bcrypt');

try {
  require('dotenv').config();
} catch {
  // dotenv is unavailable in the production image
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const knex = require('knex')({ client: 'pg', connection: process.env.DATABASE_URL });

const PEOPLE = [
  { email: 'chris@example.com', display_name: 'Chris Rattray', date_of_birth: '1973-04-10' },
  { email: 'glen@example.com', display_name: 'Glen Rattray', date_of_birth: '1987-06-19' },
];

async function upsertPerson(p, passwordHash) {
  const existing = await knex('accounts').whereRaw('lower(email) = ?', [p.email]).first();
  if (existing) {
    await knex('accounts').where({ id: existing.id }).update({ date_of_birth: p.date_of_birth });
    return existing.id;
  }
  const [row] = await knex('accounts')
    .insert({
      email: p.email,
      password_hash: passwordHash,
      display_name: p.display_name,
      role: 'user',
      date_of_birth: p.date_of_birth,
    })
    .returning('id');
  return row.id ?? row;
}

async function relate(fromId, toId, relationship) {
  await knex('account_relationships')
    .insert({ from_account_id: fromId, to_account_id: toId, relationship })
    .onConflict(['from_account_id', 'to_account_id'])
    .merge({ relationship });
}

async function main() {
  const passwordHash = await bcrypt.hash('password123', 12);
  const [chrisId, glenId] = await Promise.all(PEOPLE.map((p) => upsertPerson(p, passwordHash)));
  // Chris and Glen are brothers (directed edges, both directions)
  await relate(chrisId, glenId, 'brother');
  await relate(glenId, chrisId, 'brother');
  console.log('Seeded demo people: Chris Rattray and Glen Rattray (brothers). Password: password123');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
