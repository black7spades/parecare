#!/usr/bin/env node
/*
 * Migration runner that works everywhere the API runs:
 * - development checkout: loads the TypeScript migrations in src/ via ts-node
 * - production Docker image: loads the compiled JavaScript migrations in dist/
 *
 * The knex CLI can't do this — the production image has no knexfile and no
 * ts-node. Migrations also run automatically at API startup; this script is
 * for manual use (mainly `rollback`).
 *
 * Usage: node scripts/migrate.js [latest|rollback|status]
 */
const path = require('path');
const fs = require('fs');

try {
  require('dotenv').config();
} catch {
  // dotenv is unavailable in the production image; env vars come from Docker
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const distDir = path.join(__dirname, '..', 'dist', 'db', 'migrations');
const srcDir = path.join(__dirname, '..', 'src', 'db', 'migrations');

let directory;
let loadExtensions;
if (fs.existsSync(distDir)) {
  directory = distDir;
  // dist also contains .d.ts declaration files, which knex must not load
  loadExtensions = ['.js'];
} else {
  require('ts-node/register/transpile-only');
  directory = srcDir;
  loadExtensions = ['.ts'];
}

const knex = require('knex')({ client: 'pg', connection: process.env.DATABASE_URL });
const command = process.argv[2] || 'latest';

async function main() {
  if (command === 'latest') {
    const [batch, applied] = await knex.migrate.latest({ directory, loadExtensions });
    if (applied.length === 0) {
      console.log('Database schema is already up to date.');
    } else {
      console.log(`Applied ${applied.length} migration(s) (batch ${batch}):`);
      applied.forEach((m) => console.log(`  - ${m}`));
    }
  } else if (command === 'rollback') {
    const [batch, rolledBack] = await knex.migrate.rollback({ directory, loadExtensions });
    if (rolledBack.length === 0) {
      console.log('Nothing to roll back.');
    } else {
      console.log(`Rolled back batch ${batch} (${rolledBack.length} migration(s)):`);
      rolledBack.forEach((m) => console.log(`  - ${m}`));
    }
  } else if (command === 'status') {
    const [completed, pending] = await Promise.all([
      knex.migrate.list({ directory, loadExtensions }).then(([done]) => done),
      knex.migrate.list({ directory, loadExtensions }).then(([, todo]) => todo),
    ]);
    console.log(`Completed: ${completed.length}, pending: ${pending.length}`);
    pending.forEach((m) => console.log(`  pending: ${m.file ?? m}`));
  } else {
    console.error(`Unknown command: ${command} (expected latest, rollback, or status)`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
