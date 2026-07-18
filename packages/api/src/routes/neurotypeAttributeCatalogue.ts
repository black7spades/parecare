import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

/**
 * Instance-wide library of neurotype traits, needs and supports, mirroring the
 * condition, medication and substance catalogues. Seeded from widely accepted
 * clinical and neurodiversity descriptions, and grown whenever someone records
 * something new via resolveNeurotypeAttributeCatalogueId, so a trait or support
 * described once becomes a suggestion for everyone from then on.
 */
export const neurotypeAttributeCatalogueRouter = Router();

export const ATTRIBUTE_KINDS = ['trait', 'need', 'support'] as const;
export type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];

export const ATTRIBUTE_DOMAINS = [
  'sensory',
  'social_communication',
  'executive_function',
  'motor',
  'cognitive',
  'emotional',
  'language',
  'self_care',
  'attention',
  'other',
] as const;

/**
 * Find the shared library entry for a trait, need or support, creating it if
 * it is new. Matched on kind and label, so the same label under a different
 * kind stays a separate entry.
 */
export async function resolveNeurotypeAttributeCatalogueId(
  kind: AttributeKind,
  label: string,
  opts: { neurotype?: string | null; domain?: string | null; description?: string | null; accountId?: string } = {}
): Promise<string> {
  const l = label.trim();
  const find = () =>
    db('neurotype_attribute_catalogue').where('kind', kind).whereRaw('lower(label) = lower(?)', [l]).first();
  const existing = await find();
  if (existing) return existing.id as string;
  const domain =
    opts.domain && (ATTRIBUTE_DOMAINS as readonly string[]).includes(opts.domain) ? opts.domain : null;
  try {
    const [row] = await db('neurotype_attribute_catalogue')
      .insert({
        kind,
        label: l,
        neurotype: opts.neurotype ?? null,
        domain,
        description: opts.description?.trim() || null,
        created_by_account_id: opts.accountId ?? null,
      })
      .returning('id');
    return (row as { id: string }).id;
  } catch {
    // Lost a race on insert — the entry now exists, so reuse it.
    const again = await find();
    if (again) return again.id as string;
    throw new Error('Could not resolve neurotype attribute catalogue entry');
  }
}

/**
 * Search the library for typeahead. Filters by kind, and by neurotype when
 * given, always including cross-cutting entries (neurotype is null) so shared
 * traits and supports are offered too.
 */
neurotypeAttributeCatalogueRouter.get('/', requireAuth, async (req, res) => {
  const kind = String(req.query['kind'] ?? '').trim();
  const neurotype = String(req.query['neurotype'] ?? '').trim();
  const q = String(req.query['search'] ?? '').trim();

  // `name` aliases `label` so the shared CatalogueCombo (which reads name) can
  // drive this list unchanged.
  let query = db('neurotype_attribute_catalogue').select(
    'id',
    'kind',
    'neurotype',
    'label',
    db.ref('label').as('name'),
    'domain',
    'description'
  );
  if ((ATTRIBUTE_KINDS as readonly string[]).includes(kind)) query = query.where('kind', kind);
  if (neurotype) query = query.where((qb) => qb.where('neurotype', neurotype).orWhereNull('neurotype'));
  if (q) query = query.whereILike('label', `%${q}%`);
  const items = await query.orderBy('label', 'asc').limit(100);
  res.json({ items });
});
