---
name: verify
description: Build, run and drive the PareCare stack in a sandbox without Docker, so a web or API change can be observed end to end in a real browser.
---

# Verifying PareCare changes without Docker

## On the owner's Windows machine (check first)

If the platform is win32, the Linux recipe below does not apply. There is no
native Postgres or Redis, and Docker Desktop is off on purpose: starting it
wakes the owner's other containers. Ask once before starting anything, then:

1. In a fresh folder in the scratchpad: `npm init -y` and
   `npm install embedded-postgres@16.14.0-beta.17` (plain `@16` has no
   matching version). Copy `windows-stack.mjs` from this skill folder into
   it and run `node windows-stack.mjs` in the background. It starts a
   portable Postgres on 5433 (user and password `parecare`, database
   `parecare`, data kept in `pgdata` next to the script) and a tiny Redis
   stand-in on 6380 that answers the few commands the API uses.
2. API in `packages/api`, node_modules already installed:
   `DATABASE_URL=postgres://parecare:parecare@127.0.0.1:5433/parecare`,
   `REDIS_URL=redis://127.0.0.1:6380`, any 16+ character `JWT_SECRET`,
   `SELF_HOSTED=true`, `PORT=3001`. Run `npm run migrate`, then
   `npx ts-node-dev --transpile-only src/index.ts` in the background.
   Health check: `/api/v1/health`.
3. Web: the Vite proxy targets `http://api:3001`. Instead of editing the
   hosts file, run `npx vite --config <path>/vite.verify.config.ts` from
   `packages/web`. Copy that file from this skill folder first, and fix the
   repo path inside it if the checkout has moved. Vite then answers on
   `http://localhost:5173`; 127.0.0.1 does not work, because it listens on
   IPv6 only. Drive the browser with the Playwright MCP tools, not a fresh
   Playwright install.
4. Git Bash on this machine chokes on long heredocs that contain
   apostrophes or backticks. Write patch scripts to a scratchpad file and
   run them, rather than inlining them.
5. Stop everything afterwards: the API, Vite, and the stack script.
   Stopping the background shell does not kill the node servers here. Find
   whatever still listens on 3001, 5173, 5433 and 6380 (Get-NetTCPConnection
   in PowerShell), check the command line is ours, and stop it. The
   Playwright MCP tools write snapshots to `.playwright-mcp` in the repo
   root; delete that folder before committing.

The container has no Docker daemon, but Postgres 16 and Redis binaries are
installed natively, and Chromium lives at `/opt/pw-browsers/chromium`.

## Bring up the stack

Postgres refuses to run as root; run it as the `postgres` user in a
directory that user can traverse (`/var/lib/postgresql`, not the
scratchpad):

```bash
mkdir -p /var/lib/postgresql/pgdata && chown postgres:postgres /var/lib/postgresql/pgdata
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/pgdata -U parecare --auth=trust -E UTF8"
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/pgdata -l /var/lib/postgresql/pg.log -o '-p 5433 -c listen_addresses=127.0.0.1 -k /tmp' start"
psql -h 127.0.0.1 -p 5433 -U parecare -d postgres -c "CREATE DATABASE parecare"
redis-server --port 6380 --daemonize yes
```

API (in `packages/api`, after `npm install`):

```bash
export DATABASE_URL=postgres://parecare@127.0.0.1:5433/parecare REDIS_URL=redis://127.0.0.1:6380 JWT_SECRET=any-16-char-secret
npm run migrate
DATABASE_URL=... REDIS_URL=... JWT_SECRET=... npx ts-node-dev --transpile-only src/index.ts &   # health: /api/v1/health
```

Web (in `packages/web`, after `npm install`): the Vite proxy targets
`http://api:3001`, so add `127.0.0.1 api` to `/etc/hosts`, then `npx vite`.

## Seed data through the API

- `POST /api/v1/auth/register` `{email, password, first_name}` returns `{token}`.
- `POST /api/v1/care-profiles` `{first_name, last_name}` returns `{profile:{id}}`.
- `POST /api/v1/care-profiles/:id/medications` — note `dose_amount` is a
  **string**, e.g. `{"name":"Paracetamol","dose_amount":"500","dose_unit":"mg","schedule_times":["08:00","20:00"]}`.
  Calendar medication events are expanded server-side from `schedule_times`
  for every day in the requested range.
- `POST /api/v1/care-profiles/:id/reminders` `{title, reminder_type:"once", next_due_at}` for appointments.
- `POST /api/v1/care-profiles/:id/medications/:medId/administrations` `{}` records a dose as given.

## Drive it

Playwright installed fresh in the scratchpad works with
`chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })` (do not
run `playwright install`). Log in via the real form at `/login`
(`waitForURL(/\/app/)` after clicking Sign in — networkidle fires too
early), then go to `/app/<profileId>/calendar` or any other profile tab.
