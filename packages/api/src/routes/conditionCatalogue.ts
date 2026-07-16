import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

/**
 * Instance-wide shared condition catalogue, mirroring the medication
 * catalogue. Any signed-in user can search it for typeahead suggestions.
 * New entries are created implicitly when someone records a condition
 * that is not in it yet (via resolveConditionCatalogueId), so a condition
 * typed once becomes a suggestion for everyone from then on.
 */
export const conditionCatalogueRouter = Router();

/** Find the shared catalogue entry for a condition, creating it if new. */
export async function resolveConditionCatalogueId(name: string, accountId?: string): Promise<string> {
  const n = name.trim();
  const find = () => db('condition_catalogue').whereRaw('lower(name) = lower(?)', [n]).first();
  const existing = await find();
  if (existing) return existing.id as string;
  try {
    const [row] = await db('condition_catalogue')
      .insert({ name: n, created_by_account_id: accountId ?? null })
      .returning('id');
    return (row as { id: string }).id;
  } catch {
    // Lost a race on the unique index — the entry now exists, so reuse it.
    const again = await find();
    if (again) return again.id as string;
    throw new Error('Could not resolve condition catalogue entry');
  }
}

/**
 * Common ways well-known conditions are managed, used to suggest
 * treatment rows when someone records a condition. Curated, not
 * exhaustive; a suggestion only pre-fills a row the user can change.
 */
const COMMON_TREATMENTS: Record<string, { kind: string; name: string }[]> = {
  hypertension: [
    { kind: 'medication', name: 'Amlodipine' },
    { kind: 'medication', name: 'Lisinopril' },
    { kind: 'exercise', name: 'Regular aerobic exercise' },
    { kind: 'diet', name: 'Low-sodium diet' },
  ],
  'high blood pressure': [
    { kind: 'medication', name: 'Amlodipine' },
    { kind: 'medication', name: 'Lisinopril' },
    { kind: 'exercise', name: 'Regular aerobic exercise' },
    { kind: 'diet', name: 'Low-sodium diet' },
  ],
  'type 2 diabetes': [
    { kind: 'medication', name: 'Metformin' },
    { kind: 'diet', name: 'Low-sugar diet' },
    { kind: 'exercise', name: 'Regular exercise program' },
    { kind: 'device', name: 'Blood glucose monitor' },
  ],
  'type 1 diabetes': [
    { kind: 'medication', name: 'Insulin' },
    { kind: 'device', name: 'Blood glucose monitor' },
    { kind: 'device', name: 'Insulin pump' },
  ],
  asthma: [
    { kind: 'medication', name: 'Salbutamol' },
    { kind: 'medication', name: 'Fluticasone' },
    { kind: 'device', name: 'Spacer' },
    { kind: 'device', name: 'Peak flow meter' },
  ],
  copd: [
    { kind: 'medication', name: 'Tiotropium' },
    { kind: 'therapy', name: 'Pulmonary rehabilitation' },
    { kind: 'device', name: 'Oxygen concentrator' },
    { kind: 'lifestyle', name: 'Smoking cessation' },
  ],
  osteoarthritis: [
    { kind: 'medication', name: 'Paracetamol' },
    { kind: 'therapy', name: 'Physiotherapy' },
    { kind: 'exercise', name: 'Low-impact exercise' },
  ],
  arthritis: [
    { kind: 'medication', name: 'Paracetamol' },
    { kind: 'therapy', name: 'Physiotherapy' },
    { kind: 'exercise', name: 'Low-impact exercise' },
  ],
  depression: [
    { kind: 'medication', name: 'Sertraline' },
    { kind: 'therapy', name: 'Cognitive behavioural therapy' },
    { kind: 'exercise', name: 'Regular exercise program' },
  ],
  anxiety: [
    { kind: 'medication', name: 'Sertraline' },
    { kind: 'therapy', name: 'Cognitive behavioural therapy' },
  ],
  'high cholesterol': [
    { kind: 'medication', name: 'Atorvastatin' },
    { kind: 'diet', name: 'Low-fat diet' },
    { kind: 'exercise', name: 'Regular aerobic exercise' },
  ],
  'heart failure': [
    { kind: 'medication', name: 'Furosemide' },
    { kind: 'medication', name: 'Bisoprolol' },
    { kind: 'diet', name: 'Fluid restriction' },
  ],
  'atrial fibrillation': [
    { kind: 'medication', name: 'Apixaban' },
    { kind: 'medication', name: 'Bisoprolol' },
  ],
  epilepsy: [
    { kind: 'medication', name: 'Levetiracetam' },
    { kind: 'lifestyle', name: 'Sleep routine' },
  ],
  migraine: [
    { kind: 'medication', name: 'Sumatriptan' },
    { kind: 'lifestyle', name: 'Trigger avoidance' },
  ],
  gerd: [
    { kind: 'medication', name: 'Omeprazole' },
    { kind: 'diet', name: 'Reflux diet' },
  ],
  reflux: [
    { kind: 'medication', name: 'Omeprazole' },
    { kind: 'diet', name: 'Reflux diet' },
  ],
  hypothyroidism: [{ kind: 'medication', name: 'Levothyroxine' }],
  osteoporosis: [
    { kind: 'medication', name: 'Alendronate' },
    { kind: 'medication', name: 'Vitamin D and calcium' },
    { kind: 'exercise', name: 'Weight-bearing exercise' },
  ],
  dementia: [
    { kind: 'medication', name: 'Donepezil' },
    { kind: 'therapy', name: 'Occupational therapy' },
  ],
  "alzheimer's disease": [
    { kind: 'medication', name: 'Donepezil' },
    { kind: 'therapy', name: 'Occupational therapy' },
  ],
  "parkinson's disease": [
    { kind: 'medication', name: 'Levodopa' },
    { kind: 'therapy', name: 'Physiotherapy' },
    { kind: 'assistive_device', name: 'Walking frame' },
  ],
  eczema: [
    { kind: 'medication', name: 'Emollient cream' },
    { kind: 'medication', name: 'Hydrocortisone cream' },
  ],
  'back pain': [
    { kind: 'therapy', name: 'Physiotherapy' },
    { kind: 'exercise', name: 'Core strengthening exercises' },
    { kind: 'medication', name: 'Paracetamol' },
  ],
  'sleep apnoea': [
    { kind: 'device', name: 'CPAP unit' },
    { kind: 'lifestyle', name: 'Weight management' },
  ],
  'sleep apnea': [
    { kind: 'device', name: 'CPAP unit' },
    { kind: 'lifestyle', name: 'Weight management' },
  ],
  gout: [
    { kind: 'medication', name: 'Allopurinol' },
    { kind: 'diet', name: 'Low-purine diet' },
  ],
};

// Classic Levenshtein edit distance, for allergy screening below.
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[n]!;
}

/**
 * Whether a suggested treatment could be the thing a person is allergic
 * to. Deliberately over-cautious: a substring match either way, or a
 * close spelling (so a recorded allergy to "amlopidine" still blocks a
 * suggestion of "Amlodipine"). Suppressing a safe suggestion costs
 * nothing; suggesting an allergen is dangerous.
 */
function conflictsWithAllergy(suggestionName: string, allergen: string): boolean {
  const s = suggestionName.trim().toLowerCase();
  const a = allergen.trim().toLowerCase();
  if (!s || !a) return false;
  if (s.includes(a) || a.includes(s)) return true;
  const dist = editDistance(s, a);
  return 1 - dist / Math.max(s.length, a.length) >= 0.75;
}

// Suggest common treatments for a condition by name. Matches loosely so
// "Essential hypertension" still suggests the hypertension set. When a
// profile is given, anything the person is allergic to is never suggested.
conditionCatalogueRouter.get('/common-treatments', requireAuth, async (req, res) => {
  const name = String(req.query['condition'] ?? '').trim().toLowerCase();
  if (!name) {
    res.json({ suggestions: [] });
    return;
  }
  let suggestions = COMMON_TREATMENTS[name];
  if (!suggestions) {
    const partial = Object.entries(COMMON_TREATMENTS).find(
      ([key]) => name.includes(key) || key.includes(name)
    );
    suggestions = partial ? partial[1] : [];
  }

  const profileId = String(req.query['profile_id'] ?? '').trim();
  if (profileId && suggestions.length > 0) {
    const allergies = (await db('allergies')
      .where({ care_profile_id: profileId })
      .select('substance')) as Array<{ substance: string }>;
    suggestions = suggestions.filter(
      (s) => !allergies.some((al) => conflictsWithAllergy(s.name, al.substance))
    );
  }

  res.json({ suggestions });
});

conditionCatalogueRouter.get('/', requireAuth, async (req, res) => {
  const q = String(req.query['search'] ?? '').trim();
  let query = db('condition_catalogue').select('id', 'name', 'icd10_code', 'snomed_code');
  // A search by standard code finds the condition too, so a clinician can
  // type "E11" and land on Type 2 diabetes.
  if (q) {
    query = query.where((qb) => {
      qb.whereILike('name', `${q}%`).orWhereILike('icd10_code', `${q}%`).orWhereILike('snomed_code', `${q}%`);
    });
  }
  const items = await query.orderBy('name', 'asc').limit(50);
  res.json({ items });
});
