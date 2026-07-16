# CLAUDE.md

Guidance for Claude Code sessions in this repository.

## Project overview

PareCare is a care coordination platform for anyone in your care: your own
health needs, a child with complex needs, an ageing relative, or the
residents of an aged care home. Monorepo with two packages:

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

## Data conventions

**Never combine discrete data points into one field.** Every distinct piece
of data is captured, stored, displayed, exported and imported as its own
field. Dose and route are two data points, so they are two columns, two
inputs, two CSV columns — never `"500 mg · Oral"` in a single cell. This is
non-negotiable and applies across the whole stack:

- **Tables/grids:** one column per data point. Never a merged
  `"Dose / route"` column. Each column must stay independently sortable and
  filterable.
- **Forms:** one input per data point. Do not ask for two facts in one box.
- **Storage:** one DB column per data point (no packing two values into a
  string).
- **Import/export:** one CSV/JSON column per data point.

The only thing you may join for display is a **single multi-valued field**
— a list of values of the *same* kind (e.g. several conditions, several
schedule times, several roles). That is one data point with many values, not
two data points. Clearly-labelled prose caption lines (e.g. a subtitle like
`DOB 14 Mar 1948 · Language: English`) are descriptive text, not data
fields, but prefer structure whenever the values are queryable.

When adding or reviewing any feature, check every table, form, DB column and
export against this rule before shipping.

**AI actions must track the data model.** Whenever a table, column or status
vocabulary changes (a migration, a renamed field, a new feature like packs or
symptom readings), update in the same change:

- the action schemas and executors in `packages/api/src/services/aiActions.ts`
- the action documentation in both system prompts in
  `packages/api/src/services/ai.ts`
- the slash commands in `packages/web/src/lib/assistantCommands.ts` if a new
  action deserves one

An AI action writing to a stale model silently corrupts records; this check is
mandatory, not optional.

## UI style guide

**Every UI change must comply with `packages/web/STYLE_GUIDE.md`.** Read it
before touching any component or page, and walk its review checklist before
shipping. Core rules: links navigate, buttons act (all actions use the
`Button` component, never a hand-rolled `<button>` styled as a link); one
`primary` button per surface; four-step typography scale; one word per
action concept (Hide, Dismiss, Delete, Remove, Unlink each have a fixed
meaning).

## UI copy

- **Never use parentheses in headings.** Name a thing one way and spell it
  out (e.g. "Medication Administration Record", not "Administration record
  (MAR)").
- **No jargon without a plain-language equivalent, tooltip or legend.** Users
  may not be trained carers. Replace clinical shorthand (e.g. "PRN" → "as
  needed") or provide inline meaning for terms like "omitted" or "held".
- Never use em dashes in UI copy.

## Commands

Run inside the package directory (`packages/api` or `packages/web`):

- Install dependencies: `npm install` (lock files are intentionally not
  committed; Docker builds also use `npm install`)
- Typecheck: `npx tsc --noEmit`
- Build web app: `npx vite build` (in `packages/web`)
- Migrations (in `packages/api`, needs `DATABASE_URL`):
  `npm run migrate`, `npm run migrate:rollback`, `npm run seed`

There is no automated test suite yet.
