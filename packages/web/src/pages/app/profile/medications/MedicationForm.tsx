import { DOSE_MEASURES, MED_ROUTES, MED_TYPES, supplierLabel } from '../../../../lib/care';
import { SELECT } from './shared';
import type { MedicalCondition } from '../../../../lib/care';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';
import { TimeField } from './TimeField';
import { SupplierModal } from './SupplierModal';
import type { MedicationRecord, Supplier } from '../../../../lib/care';

/**
 * The medication editor, laid out as three plain-language sentences:
 * the treatment, the schedule, and the supply. Every value in the
 * sentences is its own field underneath.
 */
export function MedicationForm({ profileId, med, selfCare, onClose, onSaved }: { profileId: string; med?: MedicationRecord; selfCare: boolean; onClose: () => void; onSaved: () => void }) {
  const subject = selfCare ? 'I' : 'They';
  const [name, setName] = useState(med?.name ?? '');
  const [condition, setCondition] = useState(med?.condition_name ?? '');
  const [units, setUnits] = useState(med?.units_per_dose != null ? String(med.units_per_dose) : '1');
  const [doseAmount, setDoseAmount] = useState(med?.dose_amount ?? '');
  const [doseUnit, setDoseUnit] = useState(med?.dose_unit ?? '');
  const [type, setType] = useState(med?.form ?? '');
  const [route, setRoute] = useState(med?.route ?? '');
  const [withFood, setWithFood] = useState(med?.with_food ?? false);
  const [critical, setCritical] = useState(med?.critical ?? false);
  // Times a day drives how many time fields show; 0 means as needed.
  const initialTimes = med?.schedule_times ?? [];
  const [perDay, setPerDay] = useState(med?.as_needed ? 0 : initialTimes.length || 1);
  const [slots, setSlots] = useState<string[]>(initialTimes.length ? initialTimes : ['08:00']);
  const [packSize, setPackSize] = useState(med?.supply != null ? String(med.supply) : '');
  const [remaining, setRemaining] = useState(med?.supply_remaining != null ? String(med.supply_remaining) : '');
  const [packs, setPacks] = useState(med?.packs_on_hand != null ? String(med.packs_on_hand) : '');
  const [repeatsDue, setRepeatsDue] = useState(med?.repeats_due ?? '');
  // The supplier is chosen from the account's shared suppliers; picking one
  // autofills the reorder link, which is saved on the supplier itself.
  const [supplierId, setSupplierId] = useState(med?.supplier_id ?? '');
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  // Suppliers created from within this form, merged into the list so the new
  // one is immediately selectable before the list refetches.
  const [newSuppliers, setNewSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState('');
  const formQueryClient = useQueryClient();

  const typeMeta = MED_TYPES.find((t) => t.value.toLowerCase() === type.toLowerCase());

  // Shared catalogue drives the name autocomplete, so the same drug is reused.
  const { data: catalogue } = useQuery({
    queryKey: ['medication-catalogue'],
    queryFn: () => api.get<{ items: { id: string; name: string; form: string | null }[] }>('/medication-catalogue'),
  });
  const suggestions = catalogue?.items ?? [];

  const { data: conditionData } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const conditions = conditionData?.conditions ?? [];

  // The account's shared suppliers drive the "reordered from" picker.
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
  const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null;

  // The type suggests the route; the route stays editable.
  const pickType = (value: string) => {
    setType(value);
    const t = MED_TYPES.find((x) => x.value === value);
    if (t && (!route || MED_ROUTES.includes(route as (typeof MED_ROUTES)[number]))) setRoute(t.defaultRoute);
  };

  // Keep the number of time slots in step with the times-a-day number.
  const setPerDayCount = (n: number) => {
    const count = Math.max(0, Math.min(12, Math.floor(n)));
    setPerDay(count);
    setSlots((prev) => {
      if (count <= prev.length) return prev.slice(0, count);
      const next = [...prev];
      const defaults = ['08:00', '12:00', '18:00', '22:00'];
      while (next.length < count) next.push(defaults[next.length] ?? '08:00');
      return next;
    });
  };

  const setSlot = (i: number, v: string) => setSlots((prev) => prev.map((s, j) => (j === i ? v : s)));

  const mutation = useMutation({
    mutationFn: () => {
      const asNeeded = perDay < 1;
      const body = {
        name: name.trim(),
        medical_condition_name: condition.trim() || '',
        units_per_dose: units.trim() === '' ? null : Number(units),
        dose_amount: doseAmount.trim() || null,
        dose_unit: doseUnit.trim() || null,
        form: type || null,
        route: route || null,
        with_food: withFood,
        as_needed: asNeeded,
        critical,
        schedule_times: asNeeded ? [] : slots.slice(0, perDay),
        supply: packSize.trim() === '' ? null : Number(packSize),
        supply_remaining: remaining.trim() === '' ? null : Number(remaining),
        packs_on_hand: packs.trim() === '' ? null : Number(packs),
        repeats_due: repeatsDue || null,
        // The chosen supplier is authoritative: the server derives the name
        // and reorder link from it. No supplier clears all three.
        ...(supplierId
          ? { supplier_id: supplierId }
          : { supplier_id: null, supplier: null, supplier_order_url: null }),
      };
      return med ? api.patch(`/care-profiles/${profileId}/medications/${med.id}`, body) : api.post(`/care-profiles/${profileId}/medications`, body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  const routeOptions: string[] = [...MED_ROUTES];
  if (route && !routeOptions.includes(route)) routeOptions.unshift(route);

  const inlineSelect = `${SELECT} inline-block w-auto`;
  const inlineInput = 'inline-block w-20 rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
  const containerWord = typeMeta?.container ?? 'pack';
  // A liquid or cream is stocked by volume in its dose measure (mL);
  // everything else by count of its unit (tablets, puffs).
  const supplyWord = typeMeta?.measured ? doseUnit.trim() || 'mL' : typeMeta ? typeMeta.plural.toLowerCase() : 'units';

  return (
    <Modal open onClose={onClose} title={med ? 'Edit medication' : 'Add medication'} wide>
      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(); }}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Metformin" list="med-catalogue-options" hint="Pick an existing medication to reuse it, or type a new one." />
        <datalist id="med-catalogue-options">
          {suggestions.map((s) => <option key={s.id} value={s.name} />)}
        </datalist>

        <section>
          <h3 className="text-sm font-semibold text-ink mb-2">Treatment</h3>
          <p className="text-sm text-ink leading-8">
            To treat{' '}
            <input
              className={`${inlineInput} w-44`}
              aria-label="Condition"
              placeholder="condition"
              list="condition-options"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            />
            <datalist id="condition-options">
              {conditions.map((c) => <option key={c.id} value={c.name} />)}
            </datalist>{' '}
            {subject} take{' '}
            <input className={inlineInput} aria-label="Units per dose" type="number" min="0" step="any" value={units} onChange={(e) => setUnits(e.target.value)} />{' '}
            <input className={`${inlineInput} w-16`} aria-label="Dose amount" placeholder="20" value={doseAmount} onChange={(e) => setDoseAmount(e.target.value)} />
            <input className={`${inlineInput} w-16`} aria-label="Dose measure" placeholder="mg" list="dose-measures" value={doseUnit} onChange={(e) => setDoseUnit(e.target.value)} />
            <datalist id="dose-measures">
              {DOSE_MEASURES.map((m) => <option key={m} value={m} />)}
            </datalist>{' '}
            in{' '}
            <select className={inlineSelect} aria-label="Type" value={type} onChange={(e) => pickType(e.target.value)}>
              <option value="">…</option>
              {MED_TYPES.map((t) => <option key={t.value} value={t.value}>{t.value}</option>)}
              {type && !MED_TYPES.some((t) => t.value === type) ? <option value={type}>{type}</option> : null}
            </select>{' '}
            form via{' '}
            <select className={inlineSelect} aria-label="Route" value={route} onChange={(e) => setRoute(e.target.value)}>
              <option value="">…</option>
              {routeOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>.
          </p>
          <p className="text-xs text-muted mt-1">A condition that isn't already recorded is added to this person's conditions.</p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink mb-2">Schedule</h3>
          <label className="flex items-start gap-2 text-sm text-ink mb-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={perDay < 1}
              onChange={(e) => setPerDayCount(e.target.checked ? 0 : 1)}
            />
            <span>
              Taken only as needed
              <span className="block text-xs text-muted">
                For a medication with no set schedule, such as a painkiller or diazepam taken when required. It sits in
                the as needed group, and a dose is logged with the Record dose button whenever one is taken.
              </span>
            </span>
          </label>
          {perDay >= 1 ? (
            <>
              <p className="text-sm text-ink leading-8">
                It's taken{' '}
                <input className={inlineInput} aria-label="Times a day" type="number" min="1" max="12" value={perDay} onChange={(e) => setPerDayCount(Number(e.target.value))} />{' '}
                {perDay === 1 ? 'time a day' : 'times a day'},{' '}
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={withFood} onChange={(e) => setWithFood(e.target.checked)} />
                  with food
                </label>
                , at
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {slots.slice(0, perDay).map((s, i) => (
                  <TimeField key={i} value={s} onChange={(v) => setSlot(i, v)} />
                ))}
              </div>
            </>
          ) : (
            <label className="inline-flex items-center gap-1.5 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={withFood} onChange={(e) => setWithFood(e.target.checked)} />
              Taken with food
            </label>
          )}
          <label className="mt-3 flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={critical}
              onChange={(e) => setCritical(e.target.checked)}
            />
            <span>
              Dangerous to miss
              <span className="block text-xs text-muted">
                Some medications are harmful to stop suddenly. When ticked, an overdue dose or an empty supply raises an
                urgent alert; otherwise it is a normal notification.
              </span>
            </span>
          </label>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink mb-2">Supply</h3>
          <p className="text-sm text-ink leading-8">
            A new {containerWord} provides{' '}
            <input className={inlineInput} aria-label="A full pack provides" type="number" min="0" step="any" value={packSize} onChange={(e) => setPackSize(e.target.value)} />{' '}
            {supplyWord}.
          </p>
          <p className="text-sm text-ink leading-8">
            Unopened, we have{' '}
            <input className={inlineInput} aria-label="Unopened packs on hand" type="number" min="0" step="any" value={packs} onChange={(e) => setPacks(e.target.value)} />{' '}
            {packs.trim() === '1' ? containerWord : `${containerWord}s`}, plus{' '}
            <input className={inlineInput} aria-label="Amount left in the open pack" type="number" min="0" step="any" value={remaining} onChange={(e) => setRemaining(e.target.value)} />{' '}
            {supplyWord} loose in an open {containerWord} ({`0 if none is open yet`}).
          </p>
          <p className="text-sm text-ink leading-8">
            Repeats due:{' '}
            <input className={`${inlineInput} w-40`} aria-label="Repeats due" type="date" value={repeatsDue} onChange={(e) => setRepeatsDue(e.target.value)} />
          </p>
          <p className="text-sm text-ink leading-8">
            Reordered from{' '}
            <select
              className={inlineSelect}
              aria-label="Supplier"
              value={supplierId}
              onChange={(e) => {
                if (e.target.value === '__new__') { setSupplierModalOpen(true); return; }
                setSupplierId(e.target.value);
              }}
            >
              <option value="">no supplier yet</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{supplierLabel(s, suppliers)}</option>)}
              <option value="__new__">＋ Add a new supplier…</option>
            </select>.
          </p>
          {selectedSupplier ? (
            <p className="text-xs text-muted mt-1">
              {[
                selectedSupplier.address_suburb ? `Branch: ${selectedSupplier.address_suburb}` : null,
                selectedSupplier.phone,
                selectedSupplier.order_url ? 'Reorder link saved on this supplier.' : 'No reorder link saved on this supplier yet.',
              ].filter(Boolean).join(' · ')}
            </p>
          ) : (
            <p className="text-xs text-muted mt-1">
              Pick the pharmacy or shop this is reordered from, or add a new one. The reorder link is saved on the supplier.
            </p>
          )}
          <p className="text-xs text-muted mt-1">
            When supply drops to a week or less, this medication is highlighted in the list and an Order button links straight to the supplier's reorder link.
          </p>
          <p className="text-xs text-muted mt-1">
            A {containerWord} stays unopened until a dose is taken from it; then it becomes the open {containerWord} and counts down.{' '}
            {typeMeta?.measured
              ? `Each dose given counts the ${supplyWord} on hand down by the dose volume.`
              : 'Each dose given counts the units on hand down by the number taken each time.'}{' '}
            When the open {containerWord} runs out, the next unopened one is opened automatically.
          </p>
        </section>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>Save</Button>
        </div>
      </form>

      {supplierModalOpen ? (
        <SupplierModal
          onClose={() => setSupplierModalOpen(false)}
          onCreated={(s) => {
            setNewSuppliers((prev) => [...prev, s]);
            setSupplierId(s.id);
            setSupplierModalOpen(false);
            void formQueryClient.invalidateQueries({ queryKey: ['suppliers'] });
          }}
        />
      ) : null}
    </Modal>
  );
}
