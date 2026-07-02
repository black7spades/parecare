# CLAUDE.md

Guidance for Claude Code sessions in this repository.

## Project overview

PareCare is a family coordination platform for managing care of ageing
parents. Monorepo with two packages:

- `packages/api` — Express + TypeScript REST API, Postgres (via Knex),
  Redis, JWT auth. Routes in `src/routes`, DB migrations in
  `src/db/migrations`.
- `packages/web` — React + TypeScript + Vite + Tailwind frontend,
  Zustand for state (`src/stores`).

Deployment is Docker Compose (`docker-compose.yml`): postgres, redis,
api, web, nginx. Two modes via `SELF_HOSTED` env var: self-hosted
(everything unlocked) and SaaS (Stripe subscriptions gate features).

## Key concepts

- **Subscription tiers** (`free`/`family`/`professional`) are billing
  plans on the `accounts` table — not permissions.
- **Platform roles** (`super_admin`/`admin`/`user`) are permissions,
  also on `accounts`. Enforced by `requireRole` middleware; admin
  endpoints live under `/api/v1/admin`. The account matching
  `SUPER_ADMIN_EMAIL` is auto-promoted to super admin.
- **Care circle roles** are per-care-profile membership roles in
  `care_circle_members`, unrelated to platform roles.

## Commands

Run inside the package directory (`packages/api` or `packages/web`):

- Install dependencies: `npm install` (lock files are intentionally not
  committed; Docker builds also use `npm install`)
- Typecheck: `npx tsc --noEmit`
- Build web app: `npx vite build` (in `packages/web`)
- Migrations (in `packages/api`, needs `DATABASE_URL`):
  `npm run migrate`, `npm run migrate:rollback`, `npm run seed`

There is no automated test suite yet.
