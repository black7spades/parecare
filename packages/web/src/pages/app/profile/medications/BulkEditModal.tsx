import { MED_ROUTES, supplierLabel } from '../../../../lib/care';
import { BULK_SELECT } from './shared';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';
import { SupplierModal } from './SupplierModal';
import type { MedicationRecord, Supplier } from '../../../../lib/care';

export function BulkEditModal({ profileId, meds, onClose, onSaved }: { profileId: string; meds: MedicationRecord[]; onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [chSupplier, setChSupplier] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [newSuppliers, setNewSuppliers] = useState<Supplier[]>([]);
  const [chRoute, setChRoute] = useState(false);
  const [route, setRoute] = useState('');
  const [chFood, setChFood] = useState(false);
  const [withFood, setWithFood] = useState('yes');
  const [chCritical, setChCritical] = useState(false);
  const [critical, setCritical] = useState('yes');
  const [chActive, setChActive] = useState(false);
  const [active, setActive] = useState('active');
  const [error, setError] = useState('');

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<{ suppliers: Supplier[] }>('/suppliers'),
  });
  const suppliers = useMemo(() => {
    const base = suppliersData?.suppliers ?? [];
    const seen = new Set(base.map((s) => s.id));
    return [...base, ...newSuppliers.filter((s) => !seen.has(s.id))].sort((a, b) =>
      a.name.localeCompare(b.name) || (a.address_suburb ?? '').localeCompare(b.address_suburb ?? '')
    );
  }, [suppliersData, newSuppliers]);

  const anyChange = chSupplier || chRoute || chFood || chCritical || chActive;

  const mutation = useMutation({
    mutationFn: () => {
      const fields: Record<string, unknown> = {};
      if (chSupplier) fields.supplier_id = supplierId || null;
      if (chRoute) fields.route = route || null;
      if (chFood) fields.with_food = withFood === 'yes';
      if (chCritical) fields.critical = critical === 'yes';
      if (chActive) fields.active = active === 'active';
      return api.post(`/care-profiles/${profileId}/medications/bulk`, { action: 'update', ids: meds.map((m) => m.id), fields });
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  return (
    <Modal open onClose={onClose} title={`Edit ${meds.length} medication${meds.length === 1 ? '' : 's'}`} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (anyChange) mutation.mutate(); }}>
        <p className="text-sm text-muted">
          Tick a field to change it, then set the new value. Only the ticked fields are applied, and each is set the
          same on every selected medication.
        </p>

        <div className="flex items-start gap-3">
          <label className="flex items-center gap-2 w-44 shrink-0 pt-1.5 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={chSupplier} onChange={(e) => setChSupplier(e.target.checked)} />
            Reordered from
          </label>
          <div className={`flex-1 ${chSupplier ? '' : 'opacity-40 pointer-events-none'}`}>
            <select
              className={BULK_SELECT}
              aria-label="Supplier"
              value={supplierId}
              onChange={(e) => { if (e.target.value === '__new__') { setSupplierModalOpen(true); return; } setSupplierId(e.target.value); }}
            >
              <option value="">No supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{supplierLabel(s, suppliers)}</option>)}
              <option value="__new__">＋ Add a new supplier…</option>
            </select>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <label className="flex items-center gap-2 w-44 shrink-0 pt-1.5 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={chRoute} onChange={(e) => setChRoute(e.target.checked)} />
            Route
          </label>
          <div className={`flex-1 ${chRoute ? '' : 'opacity-40 pointer-events-none'}`}>
            <select className={BULK_SELECT} aria-label="Route" value={route} onChange={(e) => setRoute(e.target.value)}>
              <option value="">Clear route</option>
              {MED_ROUTES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <label className="flex items-center gap-2 w-44 shrink-0 pt-1.5 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={chFood} onChange={(e) => setChFood(e.target.checked)} />
            Taken with food
          </label>
          <div className={`flex-1 ${chFood ? '' : 'opacity-40 pointer-events-none'}`}>
            <select className={BULK_SELECT} aria-label="With food" value={withFood} onChange={(e) => setWithFood(e.target.value)}>
              <option value="yes">With food</option>
              <option value="no">Not with food</option>
            </select>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <label className="flex items-center gap-2 w-44 shrink-0 pt-1.5 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={chCritical} onChange={(e) => setChCritical(e.target.checked)} />
            Dangerous to miss
          </label>
          <div className={`flex-1 ${chCritical ? '' : 'opacity-40 pointer-events-none'}`}>
            <select className={BULK_SELECT} aria-label="Dangerous to miss" value={critical} onChange={(e) => setCritical(e.target.value)}>
              <option value="yes">Yes, dangerous to miss</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <label className="flex items-center gap-2 w-44 shrink-0 pt-1.5 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={chActive} onChange={(e) => setChActive(e.target.checked)} />
            Status
          </label>
          <div className={`flex-1 ${chActive ? '' : 'opacity-40 pointer-events-none'}`}>
            <select className={BULK_SELECT} aria-label="Status" value={active} onChange={(e) => setActive(e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!anyChange}>Apply to {meds.length}</Button>
        </div>
      </form>

      {supplierModalOpen ? (
        <SupplierModal
          onClose={() => setSupplierModalOpen(false)}
          onCreated={(s) => {
            setNewSuppliers((prev) => [...prev, s]);
            setSupplierId(s.id);
            setSupplierModalOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
          }}
        />
      ) : null}
    </Modal>
  );
}
