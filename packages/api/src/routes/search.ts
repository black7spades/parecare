import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { accessibleProfiles } from '../services/aiDashboardContext';

/**
 * One place to search across everything a person can reach: the profiles
 * themselves and, on each, medications, conditions, appointments, documents,
 * providers and tasks. Each hit carries the route it lands on, so the command
 * bar can go straight there. Scoped to the caller's accessible profiles, capped
 * per kind, and ranked on the client. No new extension, no migration.
 */
export const searchRouter = Router();

interface Hit {
  type: 'profile' | 'medication' | 'condition' | 'appointment' | 'document' | 'provider' | 'task';
  id: string;
  profile_id: string;
  profile_name: string;
  title: string;
  subtitle: string | null;
  route: string;
}

const PER_KIND = 6;

searchRouter.get('/', requireAuth, async (req, res) => {
  const q = String(req.query['q'] ?? '').trim();
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }

  const profiles = await accessibleProfiles(req.account!.id);
  const ids = profiles.map((p) => p.id);
  if (ids.length === 0) {
    res.json({ results: [] });
    return;
  }
  const nameOf = new Map(ids.map((id, i) => [id, profiles[i]!.preferred_name || profiles[i]!.full_name]));
  const like = `%${q}%`;
  const named = (pid: string) => nameOf.get(pid) ?? '';

  const [meds, conds, appts, docs, tasks, provs] = await Promise.all([
    db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .whereIn('m.care_profile_id', ids)
      .where('m.active', true)
      .whereRaw('c.name ILIKE ?', [like])
      .select('m.id as id', 'm.care_profile_id as pid', 'c.name as name')
      .limit(PER_KIND),
    db('medical_conditions')
      .whereIn('care_profile_id', ids)
      .whereRaw('name ILIKE ?', [like])
      .select('id', 'care_profile_id as pid', 'name')
      .limit(PER_KIND),
    db('appointments')
      .whereIn('care_profile_id', ids)
      .whereRaw('title ILIKE ?', [like])
      .select('id', 'care_profile_id as pid', 'title', 'starts_at')
      .orderBy('starts_at', 'desc')
      .limit(PER_KIND),
    db('documents')
      .whereIn('care_profile_id', ids)
      .whereRaw('label ILIKE ?', [like])
      .select('id', 'care_profile_id as pid', 'label')
      .limit(PER_KIND),
    db('reminders')
      .whereIn('care_profile_id', ids)
      .whereRaw('title ILIKE ?', [like])
      .select('id', 'care_profile_id as pid', 'title', 'completed')
      .orderBy('completed', 'asc')
      .limit(PER_KIND),
    db('care_profile_providers as cpp')
      .join('providers as p', 'p.id', 'cpp.provider_id')
      .whereIn('cpp.care_profile_id', ids)
      .whereRaw('p.name ILIKE ?', [like])
      .select('p.id as id', 'cpp.care_profile_id as pid', 'p.name as name', 'p.organisation as organisation')
      .limit(PER_KIND),
  ]);

  const results: Hit[] = [];

  const ql = q.toLowerCase();
  for (const p of profiles) {
    if (`${p.full_name} ${p.preferred_name ?? ''}`.toLowerCase().includes(ql)) {
      results.push({
        type: 'profile',
        id: p.id,
        profile_id: p.id,
        profile_name: p.preferred_name || p.full_name,
        title: p.preferred_name || p.full_name,
        subtitle: p.relationship ?? null,
        route: `/app/${p.id}`,
      });
    }
    if (results.filter((r) => r.type === 'profile').length >= PER_KIND) break;
  }

  for (const m of meds as Array<{ id: string; pid: string; name: string }>) {
    results.push({ type: 'medication', id: String(m.id), profile_id: m.pid, profile_name: named(m.pid), title: m.name, subtitle: null, route: `/app/${m.pid}/medications` });
  }
  for (const c of conds as Array<{ id: string; pid: string; name: string }>) {
    results.push({ type: 'condition', id: String(c.id), profile_id: c.pid, profile_name: named(c.pid), title: c.name, subtitle: null, route: `/app/${c.pid}/conditions` });
  }
  for (const a of appts as Array<{ id: string; pid: string; title: string; starts_at: string | Date }>) {
    results.push({
      type: 'appointment',
      id: String(a.id),
      profile_id: a.pid,
      profile_name: named(a.pid),
      title: a.title,
      subtitle: a.starts_at ? new Date(a.starts_at).toISOString().slice(0, 10) : null,
      route: `/app/${a.pid}/appointments`,
    });
  }
  for (const d of docs as Array<{ id: string; pid: string; label: string }>) {
    results.push({ type: 'document', id: String(d.id), profile_id: d.pid, profile_name: named(d.pid), title: d.label, subtitle: null, route: `/app/${d.pid}/documents` });
  }
  for (const t of tasks as Array<{ id: string; pid: string; title: string; completed: boolean }>) {
    results.push({ type: 'task', id: String(t.id), profile_id: t.pid, profile_name: named(t.pid), title: t.title, subtitle: t.completed ? 'Done' : null, route: `/app/${t.pid}/tasks` });
  }
  for (const pr of provs as Array<{ id: string; pid: string; name: string; organisation: string | null }>) {
    results.push({ type: 'provider', id: String(pr.id), profile_id: pr.pid, profile_name: named(pr.pid), title: pr.name, subtitle: pr.organisation, route: `/app/${pr.pid}/providers` });
  }

  res.json({ results });
});
