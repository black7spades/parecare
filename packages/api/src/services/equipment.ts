import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../config/database';
import { resolveAssetSupplier, supplierContacts } from './professionals';
import { keepTask } from './keptTasks';
import { addDays } from './documentDates';

type Conn = Knex | Knex.Transaction;

/**
 * Equipment: the wheelchair, the hoist, the CPAP machine. One record shared
 * by the account's register and each person's Equipment page. Equipment on
 * loan or hired says when it goes back, and anything can say when it is due
 * a service; each of those dates makes a task, kept in step with the date.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const OWNERSHIP = ['owned', 'loaned', 'hired'] as const;
export const OWNERSHIP_LABELS: Record<(typeof OWNERSHIP)[number], string> = { owned: 'Owned', loaned: 'On loan', hired: 'Hired' };

/** "On loan" or "loan" or "hired" in plain words, for Pare and imports. */
export function ownershipFrom(textIn: string | null | undefined): (typeof OWNERSHIP)[number] | null {
  const t = String(textIn ?? '').trim().toLowerCase();
  if (!t) return null;
  if ((OWNERSHIP as readonly string[]).includes(t)) return t as (typeof OWNERSHIP)[number];
  if (/loan|borrow|lent/.test(t)) return 'loaned';
  if (/hire|rent/.test(t)) return 'hired';
  if (/own|bought|purchas/.test(t)) return 'owned';
  return null;
}

export const assetSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().max(100).optional().nullable(),
  serial_number: z.string().max(120).optional().nullable(),
  make_model: z.string().max(255).optional().nullable(),
  price: z.coerce.number().min(0).max(1e9).optional().nullable(),
  purchase_date: day.optional().nullable(),
  supplier: z.string().max(255).optional().nullable(),
  // The supplier on file; a bare name above is found or filed as one.
  supplier_id: z.string().uuid().optional().nullable(),
  warranty_expiry: day.optional().nullable(),
  condition: z.string().max(30).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  // Years the equipment is written down over, for straight-line depreciation.
  useful_life_years: z.coerce.number().int().min(0).max(100).optional().nullable(),
  // Owned, on loan or hired; when it goes back; when it is due a service.
  ownership: z.enum(OWNERSHIP).optional().nullable(),
  return_by: day.optional().nullable(),
  service_due_on: day.optional().nullable(),
});
export type AssetInput = z.infer<typeof assetSchema>;

const cleanField = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * Straight-line depreciation from the price, purchase date and useful life:
 * the yearly write-down, how much has been written down so far, and the
 * current book value. Each is its own figure, computed, never stored.
 */
export function assetDepreciation(price: number | null, purchaseDate: string | null, usefulLife: number | null): {
  annual_depreciation: number | null;
  depreciated_amount: number | null;
  book_value: number | null;
} {
  if (price == null) return { annual_depreciation: null, depreciated_amount: null, book_value: null };
  if (usefulLife == null || usefulLife <= 0) {
    return { annual_depreciation: null, depreciated_amount: null, book_value: price };
  }
  const annual = price / usefulLife;
  let elapsedYears = 0;
  if (purchaseDate) {
    const ms = Date.now() - new Date(`${purchaseDate}T00:00:00Z`).getTime();
    elapsedYears = Math.max(0, ms / (365.25 * 24 * 3600 * 1000));
  }
  const depreciated = Math.min(price, annual * elapsedYears);
  const round2n = (n: number) => Math.round(n * 100) / 100;
  return {
    annual_depreciation: round2n(annual),
    depreciated_amount: round2n(depreciated),
    book_value: round2n(price - depreciated),
  };
}

// Postgres returns a decimal as a string; hand the client a real number and
// a plain YYYY-MM-DD so the list and form get what they expect.
const assetDate = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

export const serializeAsset = <T extends Record<string, unknown>>(a: T): T => {
  const price = a['price'] == null || a['price'] === '' ? null : Number(a['price']);
  const purchaseDate = assetDate(a['purchase_date']);
  const usefulLife = a['useful_life_years'] == null || a['useful_life_years'] === '' ? null : Number(a['useful_life_years']);
  return {
    ...a,
    price,
    purchase_date: purchaseDate,
    warranty_expiry: assetDate(a['warranty_expiry']),
    return_by: assetDate(a['return_by']),
    service_due_on: assetDate(a['service_due_on']),
    useful_life_years: usefulLife,
    ...assetDepreciation(price, purchaseDate, usefulLife),
  };
};

/** Turn a validated body into the columns to write, cleaning blank strings to null. */
export function assetColumns(data: Partial<AssetInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('name' in data) out['name'] = (data.name ?? '').trim();
  if ('category' in data) out['category'] = cleanField(data.category);
  if ('serial_number' in data) out['serial_number'] = cleanField(data.serial_number);
  if ('make_model' in data) out['make_model'] = cleanField(data.make_model);
  if ('price' in data) out['price'] = data.price ?? null;
  if ('purchase_date' in data) out['purchase_date'] = data.purchase_date ?? null;
  if ('warranty_expiry' in data) out['warranty_expiry'] = data.warranty_expiry ?? null;
  if ('condition' in data) out['condition'] = cleanField(data.condition);
  if ('location' in data) out['location'] = cleanField(data.location);
  if ('notes' in data) out['notes'] = cleanField(data.notes);
  if ('useful_life_years' in data) out['useful_life_years'] = data.useful_life_years ?? null;
  if ('ownership' in data) out['ownership'] = data.ownership ?? null;
  if ('return_by' in data) out['return_by'] = data.return_by ?? null;
  if ('service_due_on' in data) out['service_due_on'] = data.service_due_on ?? null;
  return out;
}

/**
 * The supplier columns for an equipment write: the supplier picked, or the
 * name found or filed as a supplier. Nothing when the write does not
 * mention one; null when the picked supplier belongs elsewhere.
 */
export async function assetSupplierColumns(conn: Conn, accountId: string, data: Partial<AssetInput>): Promise<Record<string, unknown> | null> {
  if (!('supplier_id' in data) && !('supplier' in data)) return {};
  return resolveAssetSupplier(conn, accountId, { supplier_id: data.supplier_id, supplier: data.supplier });
}

/** One equipment record with who supplies it, as screens read it. */
export async function assetOut(asset: Record<string, unknown>, conn: Conn = db) {
  const contacts = await supplierContacts(conn, [asset['supplier_id'] as string | null]);
  return serializeAsset({ ...asset, supplier_contact: (asset['supplier_id'] && contacts.get(asset['supplier_id'] as string)) || null });
}

const friendly = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * The return and service tasks for a piece of equipment, for each person it
 * is linked to: "Return the walker to Box Hill Hospital by 4 Dec 2026" a
 * week before it goes back, and "Book a service for the hoist" two weeks
 * before the service is due. Kept in step when the dates move; gone when
 * the date is cleared or the equipment is owned again.
 */
export async function syncEquipmentTasks(conn: Conn, assetId: string, actorId: string | null): Promise<void> {
  const a = (await conn('assets').where({ id: assetId }).first()) as Record<string, unknown> | undefined;
  if (!a) return;
  const profileIds = (await conn('care_profile_assets').where({ asset_id: assetId }).pluck('care_profile_id')) as string[];
  const name = String(a['name']);
  const supplier = (a['supplier'] as string | null) ?? null;
  const returnBy = assetDate(a['return_by']);
  const serviceDue = assetDate(a['service_due_on']);
  const goesBack = returnBy && (a['ownership'] === 'loaned' || a['ownership'] === 'hired');
  for (const profileId of profileIds) {
    const tasks = (await conn('reminders').where({ care_profile_id: profileId, asset_id: assetId }).select('id', 'title')) as Array<{ id: string; title: string }>;
    const returnTask = tasks.find((t) => t.title.startsWith('Return the '))?.id ?? null;
    const serviceTask = tasks.find((t) => t.title.startsWith('Book a service for '))?.id ?? null;
    await keepTask(conn, {
      profileId,
      actorId,
      taskId: returnTask,
      want: goesBack
        ? { title: `Return the ${name}${supplier ? ` to ${supplier}` : ''} by ${friendly(returnBy!)}`, due_on: addDays(returnBy!, -7), links: { asset_id: assetId } }
        : null,
    });
    await keepTask(conn, {
      profileId,
      actorId,
      taskId: serviceTask,
      want: serviceDue ? { title: `Book a service for the ${name}`, due_on: addDays(serviceDue, -14), links: { asset_id: assetId } } : null,
    });
  }
}

/** The equipment linked to one person, newest first, with its open tasks. */
export async function equipmentFor(conn: Conn, profileId: string) {
  const rows = (await conn('assets as a')
    .join('care_profile_assets as cpa', 'cpa.asset_id', 'a.id')
    .where('cpa.care_profile_id', profileId)
    .orderBy('a.name', 'asc')
    .select('a.*')) as Array<Record<string, unknown> & { id: string; supplier_id: string | null }>;
  const contacts = await supplierContacts(conn, rows.map((r) => r.supplier_id));
  const tasks = rows.length
    ? ((await conn('reminders')
        .where({ care_profile_id: profileId })
        .whereIn('asset_id', rows.map((r) => r.id))
        .select('id', 'title', 'next_due_at', 'all_day', 'completed', 'asset_id')) as Array<Record<string, unknown>>)
    : [];
  return rows.map((r) =>
    serializeAsset({
      ...r,
      supplier_contact: (r.supplier_id && contacts.get(r.supplier_id)) || null,
      tasks: tasks.filter((t) => t['asset_id'] === r.id),
    })
  );
}
