import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireProfileOwner } from '../middleware/permissions';
import { getStorageConfig, getFinancialYearStartMonth } from '../config/settings';
import { uploadFile, deleteFile, getDownloadUrl } from '../services/storage';
import {
  summarizeSpend,
  serializeEntry,
  financialYearRange,
  toNum,
  SPEND_CATEGORIES,
  FUNDING_SOURCES,
  CLAIM_STATUSES,
} from '../services/healthSpend';

/**
 * The health spend ledger for one person. Reads and writes are owner or admin
 * only, so the wider care circle does not see the household's care costs.
 * Medication and appointment entries are created by their own flows; this
 * router handles the ledger view, hand-entered costs, the accounting fields
 * (tax, funding source, claims and reimbursements), receipts, and the
 * financial-year accounting export.
 */
export const healthSpendRouter = Router({ mergeParams: true });

healthSpendRouter.use(requireAuth, requireProfileOwner);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// The care profile id comes from the parent route via mergeParams.
const profileIdOf = (req: { params: unknown }): string => String((req.params as Record<string, string>)['id']);

// Resolve the date window: an explicit from/to, or the current financial year
// when range=fy is asked for.
function resolveRange(query: Record<string, unknown>): { from: string | null; to: string | null } {
  if (String(query['range']) === 'fy') {
    return financialYearRange(getFinancialYearStartMonth());
  }
  return {
    from: query['from'] ? String(query['from']).slice(0, 10) : null,
    to: query['to'] ? String(query['to']).slice(0, 10) : null,
  };
}

const entrySelect = () =>
  db('health_spend_entries as e')
    .leftJoin('medication_catalogue as mc', function joinMed() {
      this.on('mc.id', '=', db.raw('(select medication_catalogue_id from medications where id = e.medication_id)'));
    })
    .leftJoin('appointments as ap', 'ap.id', 'e.appointment_id')
    .select(
      'e.*',
      db.raw("coalesce(mc.name, ap.title, e.description) as item_name"),
      db.raw(`(
        SELECT json_agg(json_build_object('id', r.id, 'filename', r.filename) ORDER BY r.created_at)
        FROM health_spend_receipts r WHERE r.entry_id = e.id
      ) as receipts`),
    );

healthSpendRouter.get('/', async (req, res) => {
  const profileId = profileIdOf(req);
  const range = resolveRange(req.query as Record<string, unknown>);

  const summary = await summarizeSpend(profileId, range, db);

  let query = entrySelect().where('e.care_profile_id', profileId);
  if (range.from) query = query.where('e.spent_on', '>=', range.from);
  if (range.to) query = query.where('e.spent_on', '<=', range.to);
  const rows = await query.orderBy('e.spent_on', 'desc');

  res.json({ summary, entries: rows.map(serializeEntry) });
});

// The accounting fields shared by create and edit.
const accountingFields = {
  tax_amount: z.coerce.number().min(0).max(1e9).optional().nullable(),
  funding_source: z.enum(FUNDING_SOURCES as unknown as [string, ...string[]]).optional().nullable(),
  claimable_amount: z.coerce.number().min(0).max(1e9).optional().nullable(),
  claim_status: z.enum(CLAIM_STATUSES as unknown as [string, ...string[]]).optional(),
  reimbursed_amount: z.coerce.number().min(0).max(1e9).optional().nullable(),
  account_code: z.string().max(50).optional().nullable(),
};

const manualSchema = z.object({
  amount: z.coerce.number().min(0).max(1e9),
  spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(2000).optional().nullable(),
  ...accountingFields,
});

healthSpendRouter.post('/', async (req, res) => {
  const parsed = manualSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const d = parsed.data;
  // A claimable cost with no explicit status starts as unclaimed; otherwise none.
  const claimStatus = d.claim_status ?? (d.claimable_amount != null && d.claimable_amount > 0 ? 'unclaimed' : 'none');
  const [entry] = await db('health_spend_entries')
    .insert({
      care_profile_id: profileIdOf(req),
      amount: d.amount,
      spent_on: d.spent_on,
      category: 'other',
      status: 'confirmed',
      description: d.description ?? null,
      tax_amount: d.tax_amount ?? null,
      funding_source: d.funding_source ?? null,
      claimable_amount: d.claimable_amount ?? null,
      claim_status: claimStatus,
      reimbursed_amount: d.reimbursed_amount ?? null,
      account_code: d.account_code ?? null,
      created_by_account_id: req.account!.id,
    })
    .returning('*');
  res.status(201).json({ entry: serializeEntry(entry as Record<string, unknown>) });
});

const editSchema = z.object({
  amount: z.coerce.number().min(0).max(1e9).optional(),
  spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['confirmed', 'estimated']).optional(),
  category: z.enum(SPEND_CATEGORIES as unknown as [string, ...string[]]).optional(),
  description: z.string().max(2000).optional().nullable(),
  ...accountingFields,
});

healthSpendRouter.patch('/:entryId', async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const d = parsed.data;
  const update: Record<string, unknown> = { updated_at: db.fn.now() };
  const set = <K extends keyof typeof d>(k: K, col = k as string) => {
    if (d[k] !== undefined) update[col] = d[k] ?? null;
  };
  set('amount');
  set('spent_on');
  set('status');
  set('category');
  set('description');
  set('tax_amount');
  set('funding_source');
  set('claimable_amount');
  set('claim_status');
  set('reimbursed_amount');
  set('account_code');

  const [entry] = await db('health_spend_entries')
    .where({ id: req.params['entryId'], care_profile_id: profileIdOf(req) })
    .update(update)
    .returning('*');
  if (!entry) {
    res.status(404).json({ error: 'Spend entry not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ entry: serializeEntry(entry as Record<string, unknown>) });
});

healthSpendRouter.delete('/:entryId', async (req, res) => {
  // Remove any stored receipt files before the rows cascade away.
  const receipts = await db('health_spend_receipts as r')
    .join('health_spend_entries as e', 'e.id', 'r.entry_id')
    .where({ 'r.entry_id': req.params['entryId'], 'e.care_profile_id': profileIdOf(req) })
    .select('r.file_url');
  const deleted = await db('health_spend_entries')
    .where({ id: req.params['entryId'], care_profile_id: profileIdOf(req) })
    .del();
  if (!deleted) {
    res.status(404).json({ error: 'Spend entry not found', code: 'NOT_FOUND' });
    return;
  }
  for (const r of receipts) {
    await deleteFile((r as { file_url: string }).file_url).catch(() => {});
  }
  res.json({ ok: true });
});

// ── Receipts ───────────────────────────────────────────────────────────
// A receipt or invoice attached to a spend entry as evidence for a claim or
// the tax return. Stored the same way documents are.

async function entryBelongs(entryId: string, profileId: string): Promise<boolean> {
  const row = await db('health_spend_entries').where({ id: entryId, care_profile_id: profileId }).first();
  return !!row;
}

healthSpendRouter.post('/:entryId/receipts', upload.single('file'), async (req, res) => {
  if (!(await entryBelongs(req.params['entryId']!, profileIdOf(req)))) {
    res.status(404).json({ error: 'Spend entry not found', code: 'NOT_FOUND' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'No file provided', code: 'VALIDATION_ERROR' });
    return;
  }
  const ext = path.extname(req.file.originalname);
  const key = `${profileIdOf(req)}/receipts/${Date.now()}${ext}`;
  const fileUrl = await uploadFile(req.file.buffer, key, req.file.mimetype);
  const [receipt] = await db('health_spend_receipts')
    .insert({
      entry_id: req.params['entryId'],
      account_id: req.account!.id,
      filename: req.file.originalname.slice(0, 400),
      file_url: fileUrl,
      content_type: req.file.mimetype,
      size_bytes: req.file.size,
      created_by_account_id: req.account!.id,
    })
    .returning(['id', 'filename']);
  res.status(201).json({ receipt });
});

healthSpendRouter.get('/:entryId/receipts/:receiptId/download', async (req, res) => {
  const receipt = await db('health_spend_receipts as r')
    .join('health_spend_entries as e', 'e.id', 'r.entry_id')
    .where({ 'r.id': req.params['receiptId'], 'r.entry_id': req.params['entryId'], 'e.care_profile_id': profileIdOf(req) })
    .select('r.file_url', 'r.filename', 'r.content_type')
    .first();
  if (!receipt) {
    res.status(404).json({ error: 'Receipt not found', code: 'NOT_FOUND' });
    return;
  }
  const fileUrl = (receipt as { file_url: string }).file_url;
  if (!fileUrl.startsWith('/uploads/')) {
    res.redirect(await getDownloadUrl(fileUrl));
    return;
  }
  const localPath = path.join(getStorageConfig().localPath, fileUrl.slice('/uploads/'.length));
  const r = receipt as { filename: string; content_type: string | null };
  if (r.content_type) res.setHeader('Content-Type', r.content_type);
  res.setHeader('Content-Disposition', `attachment; filename="${r.filename.replace(/[^\w .-]/g, '_')}"`);
  res.sendFile(localPath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File missing from storage', code: 'NOT_FOUND' });
  });
});

healthSpendRouter.delete('/:entryId/receipts/:receiptId', async (req, res) => {
  const receipt = await db('health_spend_receipts as r')
    .join('health_spend_entries as e', 'e.id', 'r.entry_id')
    .where({ 'r.id': req.params['receiptId'], 'r.entry_id': req.params['entryId'], 'e.care_profile_id': profileIdOf(req) })
    .select('r.id', 'r.file_url')
    .first();
  if (!receipt) {
    res.status(404).json({ error: 'Receipt not found', code: 'NOT_FOUND' });
    return;
  }
  await db('health_spend_receipts').where({ id: (receipt as { id: string }).id }).del();
  await deleteFile((receipt as { file_url: string }).file_url).catch(() => {});
  res.json({ ok: true });
});

// ── Accounting export ──────────────────────────────────────────────────
// A CSV shaped for an accountant or accounting software: every confirmed cost
// over the window, with the tax split out and the claim and reimbursement
// columns. range=fy exports the current financial year.

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

healthSpendRouter.get('/export', async (req, res) => {
  const profileId = profileIdOf(req);
  const range = resolveRange(req.query as Record<string, unknown>);

  const profile = await db('care_profiles').where({ id: profileId }).select('full_name').first();
  const personName = (profile as { full_name?: string } | undefined)?.full_name ?? '';

  let query = entrySelect().where('e.care_profile_id', profileId).where('e.status', 'confirmed');
  if (range.from) query = query.where('e.spent_on', '>=', range.from);
  if (range.to) query = query.where('e.spent_on', '<=', range.to);
  const rows = await query.orderBy('e.spent_on', 'asc');

  const headers = [
    'Date', 'Person', 'Description', 'Category', 'Funding source', 'Account code',
    'Total', 'Tax', 'Ex tax', 'Claimable', 'Reimbursed', 'Outstanding', 'Claim status',
  ];
  const lines = [headers.map(csvCell).join(',')];
  for (const raw of rows) {
    const e = serializeEntry(raw as Record<string, unknown>) as Record<string, unknown>;
    const total = toNum(e['amount']) ?? 0;
    const tax = toNum(e['tax_amount']) ?? 0;
    const claimable = toNum(e['claimable_amount']) ?? 0;
    const reimbursed = toNum(e['reimbursed_amount']) ?? 0;
    const status = String(e['claim_status'] ?? 'none');
    const outstanding = status === 'unclaimed' || status === 'submitted' ? Math.max(0, claimable - reimbursed) : 0;
    lines.push([
      csvCell(e['spent_on']),
      csvCell(personName),
      csvCell(e['item_name'] ?? e['description'] ?? ''),
      csvCell(e['category']),
      csvCell(e['funding_source'] ?? ''),
      csvCell(e['account_code'] ?? ''),
      csvCell(total.toFixed(2)),
      csvCell(tax.toFixed(2)),
      csvCell((total - tax).toFixed(2)),
      csvCell(claimable ? claimable.toFixed(2) : ''),
      csvCell(reimbursed ? reimbursed.toFixed(2) : ''),
      csvCell(outstanding ? outstanding.toFixed(2) : ''),
      csvCell(status),
    ].join(','));
  }

  const label = range.from ? `${range.from}_to_${range.to}` : 'all';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="health-spend-${label}.csv"`);
  res.send(lines.join('\n'));
});
