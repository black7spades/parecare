# CLAUDE.md

Guidance for Claude Code sessions in this repository.

## Working with this user

- **"The same as X" means identical, not similar.** When asked to build
  something "the same as" an existing feature, mirror it field-for-field and
  wire in every shared piece it uses (e.g. the address finder, link-to-profiles
  flow, bulk actions). Do not ship a partial version and call it done.
- **The user is impressed when you don't make more work for him.** Finish the
  whole job the first time; anticipate the shared plumbing a feature needs
  rather than leaving gaps to be reported back. If a request is genuinely
  ambiguous, ask before building, not after.

## Who we build for, and the bar

Read this before designing anything. It outranks every other section here.

PareCare exists to help people organise what they have been putting off,
cannot face, or keep finding reasons to avoid. The person using it is
usually tired, often worried, and rarely at a desk. They are not stupid and
they are not lazy: they are carrying something heavy and this is one more
thing. If a feature adds to that load, it has failed, however correct it is
underneath.

Assume nothing about technical knowledge, ever. Someone with thirty years
in this industry still should not need to know what a bucket, a cron
expression, a passphrase, an endpoint or a shell is in order to keep their
mother's medication list safe. Terms like those are ours, not theirs, and
they never belong on a screen.

The rules that follow are how that becomes real work rather than a slogan.

- **Protection is on by default.** Anything that keeps a person's data safe
  or their care on track runs from install, with sensible defaults and no
  setup. Configuration is for changing our choice, never for making it.
- **A setting is a decision we failed to make.** Every option is work handed
  to someone who has less time than we do. Earn each one, or pick a good
  default and move on.
- **Keep the clever part, hide it.** Sophistication belongs in the code, not
  on the screen. Tiered retention, fuzzy name matching, scheduling logic:
  all good, none of it named in the interface. The user picks "30 days" and
  we do the rest.
- **Never ask for what we can work out.** Infer from the record, act, and
  make it easy to correct. Ask only when a wrong guess would do harm, and
  then ask one plain question with the choices spelled out.
- **Never punish a mistake.** Prefer undo to a confirmation dialog. Nothing
  should be one click from unrecoverable, and no one should feel stupid for
  having clicked it.
- **Silence is not success.** When something fails, say so in a sentence a
  worried person can act on, and say what happens next. Never a stack trace,
  an error code, or nothing at all.
- **The empty state is the most important screen.** It is where people give
  up. It must say what this is for and offer one obvious first step.
- **One screen, one job.** If a page needs explaining, it is doing too much.
- **Write like a person, not a system.** "Checked and working", not
  "integrity verification passed". See the UI copy rules below, which are
  the enforceable form of this.

When a design decision is hard, the tie-break is always: which version asks
less of someone who is already stretched? Build that one.

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

**Every data table has sortable headers by default.** Any table listing
records uses the shared `SortableTh` + `useDataView` + `DataToolbar` pattern,
with every column sortable ascending/descending. This is the standing
default: never ship or leave a data table with fixed, unsortable headers, and
never wait to be asked for it.

## UI copy

- **Never use parentheses in headings.** Name a thing one way and spell it
  out (e.g. "Medication Administration Record", not "Administration record
  (MAR)").
- **No jargon without a plain-language equivalent, tooltip or legend.** Users
  may not be trained carers. Replace clinical shorthand (e.g. "PRN" → "as
  needed") or provide inline meaning for terms like "omitted" or "held".
- Never use em dashes in UI copy.
- **Never write "lets you" or "you can".** They are filler. Replace "lets you"
  with "allows you to", and drop "you can" entirely: the sentence reads fine
  without it (e.g. "you can add a cost" becomes "add a cost"). This applies to
  all copy, release notes and changelog entries.

## Commands

Run inside the package directory (`packages/api` or `packages/web`):

- Install dependencies: `npm install` (lock files are intentionally not
  committed; Docker builds also use `npm install`)
- Typecheck: `npx tsc --noEmit`
- Build web app: `npx vite build` (in `packages/web`)
- Migrations (in `packages/api`, needs `DATABASE_URL`):
  `npm run migrate`, `npm run migrate:rollback`, `npm run seed`

There is no automated test suite yet.
