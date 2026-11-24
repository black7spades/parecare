import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { COUNTRY_CODES, preset, type CountryCode } from '../lib/countries';
import { accountCountry } from '../services/country';

/** Option values that belong to one country, so another country never sees them. */
const COUNTRY_ONLY: Partial<Record<string, Partial<Record<CountryCode, string[]>>>> = {
  provider_type: { AU: ['Local Area Coordinator', 'NDIS support coordinator'] },
  health_fund: Object.fromEntries(COUNTRY_CODES.map((c) => [c, preset(c).health_funds])),
};

function countryOptionFilter(category: string, country: CountryCode): ((name: string) => boolean) | null {
  const lists = COUNTRY_ONLY[category];
  if (!lists) return null;
  const mine = new Set((lists[country] ?? []).map((n) => n.toLowerCase()));
  const others = new Set(
    Object.entries(lists)
      .filter(([c]) => c !== country)
      .flatMap(([, names]) => names ?? [])
      .map((n) => n.toLowerCase())
  );
  return (name: string) => mine.has(name.toLowerCase()) || !others.has(name.toLowerCase());
}

/**
 * Instance-wide shared lists of selectable values, categorised, backing
 * every dropdown that used to be a free-text box. Any signed-in user can
 * search a category for typeahead suggestions. New entries are created
 * implicitly when someone saves a value that is not listed yet (via
 * resolveOptions), so a value typed once is offered to everyone after.
 */
export const optionCatalogueRouter = Router();

export const OPTION_CATEGORIES = [
  'allergen',
  'allergy_reaction',
  'dietary_requirement',
  'mobility_aid',
  'communication_need',
  'directive_location',
  // Kinds of provider beyond the built-in few: Neurologist, Dentist, and
  // whatever else people type.
  'provider_type',
  // Kinds of organisation: Health hub, Government department, and whatever
  // else people type when filing an organisation.
  'organisation_type',
  // What keeps eating and drinking safe: Sit upright to eat and drink,
  // Thickened fluids, and whatever else people type.
  'swallowing_need',
  // Health funds and insurers, for the ID numbers form. Each country's own
  // are offered there (lib/countries.ts).
  'health_fund',
] as const;

export type OptionCategory = (typeof OPTION_CATEGORIES)[number];

/** Ensure every value exists in the category's shared list. */
export async function resolveOptions(
  category: OptionCategory,
  values: Array<string | null | undefined>,
  accountId?: string
): Promise<void> {
  const unique = [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))];
  for (const name of unique) {
    const existing = await db('option_catalogue')
      .where({ category })
      .whereRaw('lower(name) = lower(?)', [name])
      .first();
    if (existing) continue;
    try {
      await db('option_catalogue').insert({ category, name, created_by_account_id: accountId ?? null });
    } catch {
      // Lost a race on the unique index — the entry now exists, fine.
    }
  }
}

optionCatalogueRouter.get('/', requireAuth, async (req, res) => {
  const category = String(req.query['category'] ?? '');
  if (!(OPTION_CATEGORIES as readonly string[]).includes(category)) {
    res.status(400).json({ error: 'Unknown option category', code: 'VALIDATION_ERROR' });
    return;
  }
  const q = String(req.query['search'] ?? '').trim();
  let query = db('option_catalogue').where({ category }).select('id', 'name');
  if (q) query = query.whereILike('name', `%${q}%`);
  let items = (await query.orderBy('name', 'asc').limit(category === 'health_fund' ? 500 : 50)) as Array<{ id: string; name: string }>;
  // Lists that belong to one country show only that country's: Australian
  // health funds in Australia, UK insurers in the UK. Anything someone typed
  // themselves is always offered.
  const country = await accountCountry(db, req.account!.id);
  const keep = countryOptionFilter(category, country);
  if (keep) items = items.filter((i) => keep(i.name)).slice(0, 50);
  if (category === 'health_fund' && !q) {
    // The country's own funds are offered even before anyone has typed one.
    const have = new Set(items.map((i) => i.name.toLowerCase()));
    for (const name of preset(country).health_funds) if (!have.has(name.toLowerCase())) items.push({ id: `preset:${name}`, name });
    items.sort((a, b) => a.name.localeCompare(b.name));
  }
  res.json({ items });
});
