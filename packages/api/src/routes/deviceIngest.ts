import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { hashDeviceToken } from './treatments';

/**
 * The receiving end of the device API. A machine (a CPAP unit, a glucose
 * meter bridge, a home-automation script) authenticates with a device key
 * created on its treatment, discovers the treatment's measures, and pushes
 * each session's readings in the units the device itself reports.
 *
 * Authenticated by the key alone — no user session — so it is scoped hard:
 * a key can only read and write the one treatment it was created for.
 */

export const deviceRouter = Router();

interface DeviceContext {
  key: { id: string; name: string; treatment_id: string; care_profile_id: string };
  treatment: { id: string; name: string; active: boolean };
}

// Resolve the bearer token to an active device key and its treatment.
async function requireDeviceKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing device key. Send it as: Authorization: Bearer <key>', code: 'UNAUTHORIZED' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const key = await db('device_keys').where({ token_hash: hashDeviceToken(token) }).first();
  if (!key || !key.active) {
    res.status(401).json({ error: 'Unknown or revoked device key', code: 'UNAUTHORIZED' });
    return;
  }
  const treatment = await db('treatments').where({ id: key.treatment_id }).first();
  if (!treatment) {
    res.status(401).json({ error: 'The treatment this key belongs to no longer exists', code: 'UNAUTHORIZED' });
    return;
  }
  (req as Request & { device: DeviceContext }).device = { key, treatment };
  void db('device_keys').where({ id: key.id }).update({ last_used_at: db.fn.now() });
  next();
}

const deviceOf = (req: Request): DeviceContext => (req as Request & { device: DeviceContext }).device;

// What this key can log against: the treatment and its measures, so an
// integrator can discover metric ids and expected units programmatically.
deviceRouter.get('/treatment', requireDeviceKey, async (req, res) => {
  const { treatment } = deviceOf(req);
  const metrics = await db('treatment_metrics')
    .where({ treatment_id: treatment.id })
    .orderBy('sort_order', 'asc')
    .select('id', 'name', 'unit', 'value_type');
  res.json({
    treatment: { id: treatment.id, name: treatment.name, active: treatment.active },
    metrics,
  });
});

// One reading: the measure it belongs to (by id or by exact name) and its
// value. The value's JSON type must suit the measure's value type.
const deviceReadingSchema = z.object({
  metric_id: z.string().uuid().optional(),
  metric: z.string().max(255).optional(),
  value: z.union([z.number().finite(), z.string().max(2000), z.boolean()]),
});

const deviceObservationSchema = z.object({
  observed_at: z.string().optional(),
  status: z.enum(['completed', 'partial', 'skipped', 'refused']).default('completed'),
  notes: z.string().max(4000).optional().nullable(),
  readings: z.array(deviceReadingSchema).min(1).max(50),
});

const truthy = new Set(['yes', 'true', 'y', '1', 'on']);
const falsy = new Set(['no', 'false', 'n', '0', 'off']);

// Push one session's readings. Example body:
// { "observed_at": "2026-07-11T06:30:00Z",
//   "readings": [ { "metric": "Hours used", "value": 7.4 },
//                 { "metric": "Events per hour", "value": 3.1 } ] }
deviceRouter.post('/observations', requireDeviceKey, async (req, res) => {
  const { key, treatment } = deviceOf(req);
  const parsed = deviceObservationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.issues.map((i) => i.message) });
    return;
  }
  const observedAt = parsed.data.observed_at ? new Date(parsed.data.observed_at) : new Date();
  if (Number.isNaN(observedAt.getTime())) {
    res.status(400).json({ error: 'observed_at is not a valid timestamp', code: 'VALIDATION_ERROR' });
    return;
  }

  const metrics = await db('treatment_metrics').where({ treatment_id: treatment.id });
  const byId = new Map(metrics.map((m) => [m.id, m]));
  const byName = new Map(metrics.map((m) => [String(m.name).toLowerCase(), m]));

  const rows: Record<string, unknown>[] = [];
  for (const r of parsed.data.readings) {
    const metric = r.metric_id ? byId.get(r.metric_id) : byName.get((r.metric ?? '').toLowerCase());
    if (!metric) {
      res.status(400).json({
        error: `Unknown measure ${r.metric_id ?? JSON.stringify(r.metric ?? '')}. GET /api/v1/device/treatment lists this treatment's measures.`,
        code: 'UNKNOWN_METRIC',
      });
      return;
    }
    // Coerce the value into the column matching the measure's type.
    let value_number: number | null = null;
    let value_text: string | null = null;
    let value_boolean: boolean | null = null;
    if (metric.value_type === 'number') {
      const n = typeof r.value === 'number' ? r.value : Number(r.value);
      if (!Number.isFinite(n)) {
        res.status(400).json({ error: `The measure "${metric.name}" takes a number.`, code: 'VALIDATION_ERROR' });
        return;
      }
      value_number = n;
    } else if (metric.value_type === 'yes_no') {
      if (typeof r.value === 'boolean') value_boolean = r.value;
      else if (truthy.has(String(r.value).toLowerCase())) value_boolean = true;
      else if (falsy.has(String(r.value).toLowerCase())) value_boolean = false;
      else {
        res.status(400).json({ error: `The measure "${metric.name}" takes yes or no.`, code: 'VALIDATION_ERROR' });
        return;
      }
    } else {
      value_text = String(r.value);
    }
    rows.push({ treatment_metric_id: metric.id, value_number, value_text, value_boolean });
  }

  const [observation] = await db('observations')
    .insert({
      care_profile_id: key.care_profile_id,
      treatment_id: treatment.id,
      observed_at: observedAt,
      recorded_by_name: key.name,
      source: 'device',
      device_key_id: key.id,
      status: parsed.data.status,
      notes: parsed.data.notes ?? null,
    })
    .returning(['id', 'observed_at']);
  await db('observation_values').insert(rows.map((r) => ({ ...r, observation_id: observation.id })));

  res.status(201).json({ observation: { id: observation.id, observed_at: observation.observed_at, readings: rows.length } });
});
