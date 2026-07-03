# PareCare

Family coordination platform for managing the care of ageing parents.

## Features

Each person in care gets a profile with:

- **Care journey pipeline** — six life phases from early concern to end of
  life, each seeding its own checklist when entered. Checklist items carry
  a note thread, so a ticked box keeps its story: when it happened, who
  was there, and where the information lives now
- **Your relationship, your words** — everyone records who the person is
  to them (Mum, Uncle, or a custom term like "Oma") and the whole app
  speaks in those terms, per viewer
- **Care circle** — invite family, friends and organisations by email;
  members see the shared profile on their own dashboard. Each member is
  a **contributor** (can add and edit records) or a **viewer** (read +
  conversation only); circle management is owner-only. Power of
  attorney is a checkbox on any member (type + activated flag) and shows
  as a badge everywhere they appear
- **Activity trail** — an append-only record of every change (who,
  what, when), visible to the whole circle
- **Document visibility** — restrict sensitive documents (wills,
  financials) to selected circle roles; the owner always has access
- **Care plan** — conditions, medications, dietary needs, mobility aids,
  GP, advance care directive, emergency contacts
- **Tasks** — one-off or recurring, assignable to circle members
- **Calendar** — in-app month view of tasks and appointments, plus a
  read-only ICS feed URL that Google Calendar / Outlook / Apple Calendar
  can subscribe to
- **Messages** — a shared conversation space per care profile
- **Documents** — categorised repository (medical records, will, POA,
  insurance…) stored locally or in S3
- **Care log** — timestamped record of visits, calls and decisions
- **Open questions with AI mediation** — track family decisions with
  discussion threads and recorded resolutions; on disputed questions, one
  click asks a neutral AI mediator to summarise common ground, each
  person's view (stated fairly), options, and a suggested next step
- **Memory Book** — stories, messages and photos for the person in care,
  written while there's still time to share them together
- **Emergency sheet** — a printable one-pager (conditions, medications,
  GP, POA holders, emergency contacts) generated from the care plan
- **Reminder emails** — due tasks are emailed to their assignee (needs
  SMTP configured); recurring tasks roll forward automatically
- **Providers** — directory of doctors, facilities and services
- **Ask PareCare** — AI assistant with context on the person's situation
  (requires `ANTHROPIC_API_KEY`)

## Running with Docker (self-hosted)

### Requirements
- Docker Desktop (Mac/Windows) or Docker Engine + Compose plugin (Linux)
- 2 GB RAM minimum

### Setup

1. Clone the repository
   ```
   git clone https://github.com/your-org/parecare.git
   cd parecare
   ```

2. Copy the example environment file
   ```
   cp .env.example .env
   ```

3. Edit `.env` and set at minimum:
   - `DB_PASSWORD` — any strong password
   - `JWT_SECRET` — generate with: `openssl rand -hex 32`
   - `SUPER_ADMIN_EMAIL` — your email; the account registered with it becomes the super admin

4. Start the stack
   ```
   docker compose up -d
   ```
   Database migrations run automatically when the api container starts.

5. Open http://localhost in your browser

### Optional: AI assistant

Ask PareCare and question mediation work with any popular AI provider,
or a model running on your own hardware. Set `AI_PROVIDER` in `.env`:

| Provider | Set |
|---|---|
| `anthropic` (default) | `ANTHROPIC_API_KEY` |
| `openai` | `AI_API_KEY` |
| `google` (Gemini) | `AI_API_KEY` from Google AI Studio |
| `ollama` | `AI_MODEL` (e.g. `gemma3`); base URL defaults to the host machine's port 11434 |
| `lmstudio` | `AI_MODEL` matching the model loaded in LM Studio; port 1234 |
| `openai-compatible` | `AI_BASE_URL` (ending in `/v1`) + `AI_MODEL`, for anything else |

`AI_MEDIATION_MODEL` optionally uses a stronger model for dispute
mediation than for everyday chat. Then restart:
```
docker compose restart api
```

### Upgrading

```
docker compose pull
docker compose up -d
```

Migrations apply automatically on startup. To undo the most recent
migration batch manually:
```
docker compose exec api npm run migrate:rollback
```

---

## SaaS deployment

Set `SELF_HOSTED=false` in `.env` to enable:
- Stripe subscription checks
- Per-plan feature gating
- AI usage metering

Required additional env vars for SaaS:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_FAMILY`
- `STRIPE_PRICE_PROFESSIONAL`
- `APP_URL` — your public URL (used for Stripe redirect URLs)

### Stripe setup

1. Create two recurring products in Stripe Dashboard:
   - Family plan — $12/month
   - Professional plan — $39/month

2. Copy the price IDs into `STRIPE_PRICE_FAMILY` and `STRIPE_PRICE_PROFESSIONAL`

3. Configure a webhook endpoint pointing to `https://your-domain.com/webhooks/stripe` with these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

4. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`

---

## User roles

Every account has a platform role, independent of its subscription tier:

| Role | Capabilities |
|---|---|
| Super admin | Everything admins can do, plus promote/demote admins and manage admin accounts. Only super admins can change roles. |
| Admin | View all accounts and platform stats; edit details, change subscription tier, and delete **regular user** accounts. Cannot touch admin or super admin accounts. |
| User | Default role for every registered account. |

The account whose email matches `SUPER_ADMIN_EMAIL` is promoted to super admin
automatically — on registration for fresh installs, or at api startup / next
login for existing installs after running migrations. Safety rails: the last
super admin can't be demoted or deleted, and admins can't delete themselves
from the admin panel. Admin tools live at `/admin` in the web app and under
`/api/v1/admin` in the API.

## Signing in

- **Email + password** always works. Email matching is case-insensitive.
- **Google / Facebook sign-in** appears automatically once credentials are
  configured. Register an OAuth app with the provider using the redirect
  URI `<APP_URL>/api/v1/auth/oauth/google/callback` (or `/facebook/…`),
  then set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or
  `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` in `.env` and restart the api.
  Accounts are matched by verified email, so someone invited by email can
  accept with their Google account.
- **The super admin signs in with email + password only** — social sign-in
  is refused for that account by design.
- **Two-factor authentication** (authenticator app): enable it under
  Account settings — scan the QR code or type the setup key, confirm with
  a 6-digit code. Sign-in then requires a current code. If someone is
  locked out, an admin can clear it in the database:
  `UPDATE accounts SET mfa_enabled = false, mfa_secret = NULL WHERE email = '…';`

## Subscription tiers

| Feature | Free (self-host) | Family | Professional |
|---|---|---|---|
| Care profiles | 2 | Unlimited | Unlimited |
| Care circle members | Unlimited | 6 | Unlimited |
| Care log entries | Unlimited | Unlimited | Unlimited |
| Document storage | Local only | S3 | S3 |
| Ask PareCare AI | Requires own API key | 100k tokens/mo | Unlimited |
| Email reminders | SMTP required | Yes | Yes |
| Priority support | No | No | Yes |
