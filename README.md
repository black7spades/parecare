# PareCare

Family coordination platform for managing the care of ageing parents.

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

The Ask PareCare AI assistant requires an Anthropic API key.
Set `ANTHROPIC_API_KEY` in your `.env` file, then restart:
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
