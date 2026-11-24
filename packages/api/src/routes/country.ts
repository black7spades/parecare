import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { COUNTRY_CODES, isCountryCode, preset, type CountryCode } from '../lib/countries';
import {
  ServiceProblem,
  accountCountry,
  addService,
  checkTask,
  countryChoices,
  countryConfig,
  effectiveServices,
  finishCheck,
  guessedCountry,
  loadCountrySettings,
  markServiceChecked,
  profileAccountId,
  profileCountry,
  resetService,
  saveService,
  serviceForProfile,
  setAccountCountry,
  setSystemCountry,
  systemCountryNow,
  type EffectiveService,
} from '../services/country';
import { complete, isAiConfigured } from '../services/aiProvider';

/**
 * Country and services.
 *
 *   /country                 what the signed-in account's country is, its
 *                            words and formats, and its services; an
 *                            account owner changes these for themselves.
 *   /admin/country           whoever runs PareCare: the country for
 *                            everyone, services for everyone, and the
 *                            yearly check.
 *   /care-profiles/:id/country  the person's country and services, and
 *                            adding a number a step needs.
 */

const serviceBody = z.object({
  name: z.string().max(160).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  website: z.string().max(500).optional().nullable(),
  label: z.string().max(160).optional().nullable(),
});

function problem(res: Response, err: unknown): boolean {
  if (err instanceof ServiceProblem) {
    res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
    return true;
  }
  return false;
}

const kindOf = (req: Request) => String(req.params['kind'] ?? '').slice(0, 60);

// ---------------------------------------------------------------- the account

export const countryRouter = Router();
countryRouter.use(requireAuth);

countryRouter.get('/', async (req, res) => {
  const account = req.account!;
  const row = (await db('accounts').where({ id: account.id }).first('country')) as { country: string | null } | undefined;
  const code = await accountCountry(db, account.id);
  const system = await systemCountryNow();
  res.json({
    config: countryConfig(code),
    system_country: { code: system, name: preset(system).name },
    own_country: isCountryCode(row?.country) ? row!.country : null,
    choices: countryChoices(),
    services: await effectiveServices(db, code, account.id),
  });
});

countryRouter.put('/account', async (req, res) => {
  const parsed = z.object({ country: z.enum(COUNTRY_CODES).nullable() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Pick a country from the list.', code: 'VALIDATION_ERROR' });
    return;
  }
  await setAccountCountry(db, req.account!.id, parsed.data.country);
  const code = await accountCountry(db, req.account!.id);
  res.json({ config: countryConfig(code), own_country: parsed.data.country, services: await effectiveServices(db, code, req.account!.id) });
});

async function accountScope(req: Request) {
  return { accountId: req.account!.id, country: await accountCountry(db, req.account!.id) };
}

countryRouter.post('/account/services', async (req, res) => {
  const parsed = serviceBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Those details could not be read.', code: 'VALIDATION_ERROR' });
    return;
  }
  try {
    const scope = await accountScope(req);
    const kind = await addService(db, { ...scope, actorId: req.account!.id, input: parsed.data });
    res.status(201).json({ kind, services: await effectiveServices(db, scope.country, scope.accountId) });
  } catch (err) {
    if (!problem(res, err)) throw err;
  }
});

countryRouter.put('/account/services/:kind', async (req, res) => {
  const parsed = serviceBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Those details could not be read.', code: 'VALIDATION_ERROR' });
    return;
  }
  try {
    const scope = await accountScope(req);
    await saveService(db, { ...scope, kind: kindOf(req), actorId: req.account!.id, input: parsed.data });
    res.json({ services: await effectiveServices(db, scope.country, scope.accountId) });
  } catch (err) {
    if (!problem(res, err)) throw err;
  }
});

countryRouter.delete('/account/services/:kind', async (req, res) => {
  const scope = await accountScope(req);
  const was = await resetService(db, { ...scope, kind: kindOf(req) });
  if (!was) {
    res.status(404).json({ error: 'There is no change of yours to put back for this service.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ was, services: await effectiveServices(db, scope.country, scope.accountId) });
});

countryRouter.post('/account/services/:kind/checked', async (req, res) => {
  try {
    const scope = await accountScope(req);
    await markServiceChecked(db, { ...scope, kind: kindOf(req), actorId: req.account!.id });
    res.json({ services: await effectiveServices(db, scope.country, scope.accountId) });
  } catch (err) {
    if (!problem(res, err)) throw err;
  }
});

// ---------------------------------------------------------------- whoever runs PareCare

export const adminCountryRouter = Router();
// The country sets the currency and the financial year too, which only a super admin may change.
adminCountryRouter.use(requireAuth, requireRole('super_admin'));

async function adminState() {
  const row = await loadCountrySettings();
  const country = await systemCountryNow();
  return {
    country: { code: country, name: preset(country).name },
    confirmed: !!row?.confirmed_at,
    guessed: guessedCountry(),
    choices: countryChoices(),
    services: await effectiveServices(db, country, null),
    check: await checkTask(),
    pare_can_check: isAiConfigured(),
  };
}

adminCountryRouter.get('/', async (_req, res) => {
  res.json(await adminState());
});

adminCountryRouter.put('/', async (req, res) => {
  const parsed = z.object({ country: z.enum(COUNTRY_CODES) }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Pick a country from the list.', code: 'VALIDATION_ERROR' });
    return;
  }
  await setSystemCountry(db, parsed.data.country, req.account!.id);
  res.json(await adminState());
});

const systemScope = async () => ({ accountId: null, country: await systemCountryNow() });

adminCountryRouter.post('/services', async (req, res) => {
  const parsed = serviceBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Those details could not be read.', code: 'VALIDATION_ERROR' });
    return;
  }
  try {
    const kind = await addService(db, { ...(await systemScope()), actorId: req.account!.id, input: parsed.data });
    res.status(201).json({ kind, ...(await adminState()) });
  } catch (err) {
    if (!problem(res, err)) throw err;
  }
});

adminCountryRouter.put('/services/:kind', async (req, res) => {
  const parsed = serviceBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Those details could not be read.', code: 'VALIDATION_ERROR' });
    return;
  }
  try {
    await saveService(db, { ...(await systemScope()), kind: kindOf(req), actorId: req.account!.id, input: parsed.data });
    res.json(await adminState());
  } catch (err) {
    if (!problem(res, err)) throw err;
  }
});

adminCountryRouter.delete('/services/:kind', async (req, res) => {
  const was = await resetService(db, { ...(await systemScope()), kind: kindOf(req) });
  if (!was) {
    res.status(404).json({ error: 'There is no change to put back for this service.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ was, ...(await adminState()) });
});

adminCountryRouter.post('/services/:kind/checked', async (req, res) => {
  try {
    await markServiceChecked(db, { ...(await systemScope()), kind: kindOf(req), actorId: req.account!.id });
    res.json(await adminState());
  } catch (err) {
    if (!problem(res, err)) throw err;
  }
});

adminCountryRouter.post('/check/done', async (req, res) => {
  await finishCheck(db, req.account!.id);
  res.json(await adminState());
});

/**
 * Check current services, with Pare: Pare reads each service's details and
 * says which it believes have changed, one proposal per service, for the
 * person to accept or skip one at a time. Nothing changes until they do.
 */
adminCountryRouter.post('/check/look-up', async (_req, res) => {
  if (!isAiConfigured()) {
    res.status(409).json({ error: 'Pare is not switched on, so check each service on its own website instead. Each one is linked in the list.', code: 'AI_NOT_CONFIGURED' });
    return;
  }
  const country = await systemCountryNow();
  const services = await effectiveServices(db, country, null);
  const proposals = await lookUpServices(country, services);
  res.json({ proposals });
});

interface Proposal {
  kind: string;
  name: string | null;
  phone: string | null;
  website: string | null;
  why: string;
}

async function lookUpServices(country: CountryCode, services: EffectiveService[]): Promise<Proposal[]> {
  const list = services.map((s) => ({ kind: s.kind, for: s.label, name: s.name, phone: s.phone, website: s.website }));
  const system =
    'You check a list of national health and support services for one country. For each service, say whether its name, public phone number or website ' +
    'has changed, or fill in one that is missing, using only details you are confident are current and public. Never guess a number. ' +
    'Reply with JSON only: {"proposals":[{"kind":"...","name":"...","phone":"...","website":"https://...","why":"one plain sentence"}]}. ' +
    'Leave out any service that is right as it is, or that you are not sure about.';
  const user = `Country: ${preset(country).name}\nServices:\n${JSON.stringify(list, null, 1)}`;
  const schema = {
    name: 'service_proposals',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['proposals'],
      properties: {
        proposals: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'name', 'phone', 'website', 'why'],
            properties: { kind: { type: 'string' }, name: { type: ['string', 'null'] }, phone: { type: ['string', 'null'] }, website: { type: ['string', 'null'] }, why: { type: 'string' } },
          },
        },
      },
    },
  };
  const result = await complete(system, [{ role: 'user', content: user }], 2000, 'mediation', { schema });
  let parsed: unknown = result.structured;
  if (!parsed) {
    const m = /\{[\s\S]*\}/.exec(result.text);
    try {
      parsed = m ? JSON.parse(m[0]) : null;
    } catch {
      parsed = null;
    }
  }
  const raw = ((parsed as { proposals?: unknown[] } | null)?.proposals ?? []) as Array<Record<string, unknown>>;
  const byKind = new Map(services.map((s) => [s.kind, s]));
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return raw
    .map((p) => ({ kind: String(p['kind'] ?? ''), name: str(p['name']), phone: str(p['phone']), website: str(p['website']), why: str(p['why']) ?? 'Pare thinks these details have changed.' }))
    .filter((p) => {
      const now = byKind.get(p.kind);
      if (!now) return false;
      return (p.name ?? now.name) !== now.name || (p.phone ?? now.phone) !== now.phone || (p.website ?? now.website) !== now.website;
    })
    .map((p) => {
      const now = byKind.get(p.kind)!;
      return { ...p, name: p.name ?? now.name, phone: p.phone ?? now.phone, website: p.website ?? now.website };
    });
}

// ---------------------------------------------------------------- a person

export const profileCountryRouter = Router({ mergeParams: true });

profileCountryRouter.get('/', async (req, res) => {
  const profileId = String((req.params as Record<string, string>)['id']);
  const code = await profileCountry(db, profileId);
  res.json({ config: countryConfig(code), services: await effectiveServices(db, code, await profileAccountId(db, profileId)) });
});

/**
 * Add the number for this service: a step whose service has no number
 * where the person lives. It is kept for everyone on their account. A
 * service that already has details is changed on the account's own
 * settings, not from here.
 */
profileCountryRouter.put('/services/:kind', async (req, res) => {
  const profileId = String((req.params as Record<string, string>)['id']);
  const parsed = serviceBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Those details could not be read.', code: 'VALIDATION_ERROR' });
    return;
  }
  const kind = kindOf(req);
  const now = await serviceForProfile(db, profileId, kind);
  if (!now) {
    res.status(404).json({ error: 'That service was not found.', code: 'NOT_FOUND' });
    return;
  }
  const accountId = await profileAccountId(db, profileId);
  if (!accountId) {
    res.status(404).json({ error: 'That service was not found.', code: 'NOT_FOUND' });
    return;
  }
  const isOwner = accountId === req.account!.id;
  if (!now.missing && !isOwner) {
    res.status(409).json({ error: 'This service already has a number. The person who set up this profile can change it in their account settings.', code: 'CONFLICT' });
    return;
  }
  try {
    await saveService(db, { accountId, country: await profileCountry(db, profileId), kind, actorId: req.account!.id, input: parsed.data });
    res.json({ service: await serviceForProfile(db, profileId, kind) });
  } catch (err) {
    if (!problem(res, err)) throw err;
  }
});
