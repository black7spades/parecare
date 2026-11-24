import { DOSE_MEASURES, MED_ROUTES, MED_TYPES, supplierLabel } from '../../../../lib/care';
import { SELECT } from './shared';
import type { MedicalCondition } from '../../../../lib/care';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input, Textarea } from '../../../../components/ui/Input';
import { limitsFromText } from '../../../../lib/asNeeded';
import { Modal } from '../../../../components/ui/Modal';
import { TimeField } from './TimeField';
import { SupplierModal } from './SupplierModal';
import type { CareDocument, MedicationRecord, Supplier } from '../../../../lib/care';
import type { Appointment } from '../AppointmentsPage';
import { ContactPicker, contactProblem, changedContactFieldsAs, contactFieldsAs, pickedFrom, type PickedContact } from '../../../../components/ContactPicker';
import { format } from 'date-fns';

/**
 * The medication editor, laid out as three plain-language sentences:
 * the treatment, the schedule, and the supply. Every value in the
 * sentences is its own field underneath.
 */
export function MedicationForm({
  profileId,
  med,
  selfCare,
  initialName = '',
  initialCondition = '',
  initialSourceAppointmentId = '',
  initialPrescriber,
  onClose,
  onSaved,
}: {
  profileId: string;
  med?: MedicationRecord;
  selfCare: boolean;
  /** Prefill a new medication, e.g. from a prescription an appointment gave. */
  initialName?: string;
  initialCondition?: string;
  /** The visit it came from, when added from that visit's prescription step. */
  initialSourceAppointmentId?: string;
  /** Who wrote it, when known, e.g. the doctor at that visit. */
  initialPrescriber?: { id: string | null; name: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const subject = selfCare ? 'I' : 'They';
  const [name, setName] = useState(med?.name ?? initialName);
  const [condition, setCondition] = useState(med?.condition_name ?? initialCondition);
  const [units, setUnits] = useState(med?.units_per_dose != null ? String(med.units_per_dose) : '1');
  const [doseAmount, setDoseAmount] = useState(med?.dose_amount ?? '');
  const [doseUnit, setDoseUnit] = useState(med?.dose_unit ?? '');
  const [type, setType] = useState(med?.form ?? '');
  const [route, setRoute] = useState(med?.route ?? '');
  const [withFood, setWithFood] = useState(med?.with_food ?? false);
  const [critical, setCritical] = useState(med?.critical ?? false);
  const [instructions, setInstructions] = useState(med?.instructions ?? '');
  const [asNeededFor, setAsNeededFor] = useState(med?.as_needed_for ?? '');
  const [gapHours, setGapHours] = useState(med?.min_hours_between_doses != null ? String(med.min_hours_between_doses) : '');
  const [mostPerDay, setMostPerDay] = useState(med?.max_doses_per_day != null ? String(med.max_doses_per_day) : '');
  // Limits typed by a person stay; until then they follow the instructions.
  // Saved limits that the instructions do not say were typed, so they stay.
  const [limitsTouched, setLimitsTouched] = useState(() => {
    if (!med) return false;
    const read = limitsFromText(med.instructions ?? '', med.units_per_dose ?? null);
    return (med.min_hours_between_doses ?? null) !== read.min_hours_between_doses || (med.max_doses_per_day ?? null) !== read.max_doses_per_day;
  });
  // Times a day drives how many time fields show; 0 means as needed.
  const initialTimes = med?.schedule_times ?? [];
  const [perDay, setPerDay] = useState(med?.as_needed ? 0 : initialTimes.length || 1);
  const [slots, setSlots] = useState<string[]>(initialTimes.length ? initialTimes : ['08:00']);
  const [packSize, setPackSize] = useState(med?.supply != null ? String(med.supply) : '');
  const [remaining, setRemaining] = useState(med?.supply_remaining != null ? String(med.supply_remaining) : '');
  const [packs, setPacks] = useState(med?.packs_on_hand != null ? String(med.packs_on_hand) : '');
  const [repeatsDue, setRepeatsDue] = useState(med?.repeats_due ?? '');
  const [repeatsLeft, setRepeatsLeft] = useState(med?.repeats_left != null ? String(med.repeats_left) : '');
  const [courseEnds, setCourseEnds] = useState(med?.course_ends_on ?? '');
  // Why the dose or times changed and where from, asked only when they did.
  const [changeReason, setChangeReason] = useState('');
  const [changeSource, setChangeSource] = useState('');
  const [changeDocId, setChangeDocId] = useState('');
  // The supplier is chosen from the account's shared suppliers; picking one
  // autofills the reorder link, which is saved on the supplier itself.
  const [supplierId, setSupplierId] = useState(med?.supplier_id ?? '');
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  // Suppliers created from within this form, merged into the list so the new
  // one is immediately selectable before the list refetches.
  const [newSuppliers, setNewSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState('');
  const [prescriber, setPrescriber] = useState<PickedContact>(pickedFrom(med?.prescriber ?? initialPrescriber ?? null));
  const [sourceAppointmentId, setSourceAppointmentId] = useState(med?.source_appointment_id ?? initialSourceAppointmentId);
  const formQueryClient = useQueryClient();

  // Visits that have happened, newest first, for "Started at".
  const { data: apptData } = useQuery({
    queryKey: ['appointments', profileId],
    queryFn: () => api.get<{ appointments: Appointment[] }>(`/care-profiles/${profileId}/appointments`),
  });
  const pastVisits = useMemo(() => {
    const now = Date.now();
    return (apptData?.appointments ?? [])
      .filter((a) => a.starts_at && new Date(a.starts_at).getTime() <= now)
      .sort((a, b) => new Date(b.starts_at!).getTime() - new Date(a.starts_at!).getTime());
  }, [apptData]);

  // Letters on file, for "Where did the change come from?".
  const { data: docData } = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
    enabled: !!med,
  });
  const letters = docData?.documents ?? [];

  // The dose or times moved from what is on file: ask why, and where from.
  const sameTimes = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const timesNow = perDay < 1 ? [] : slots.slice(0, perDay);
  const changed =
    !!med &&
    ((doseAmount.trim() || '') !== (med.dose_amount ?? '') ||
      (doseUnit.trim() || '') !== (med.dose_unit ?? '') ||
      !sameTimes(timesNow, med.as_needed ? [] : med.schedule_times ?? []));

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
        instructions: instructions.trim() || null,
        as_needed_for: asNeeded ? asNeededFor.trim() || null : null,
        // Only an as-needed medicine has limits.
        min_hours_between_doses: !asNeeded || gapHours.trim() === '' ? null : Number(gapHours),
        max_doses_per_day: !asNeeded || mostPerDay.trim() === '' ? null : Number(mostPerDay),
        critical,
        schedule_times: asNeeded ? [] : slots.slice(0, perDay),
        supply: packSize.trim() === '' ? null : Number(packSize),
        supply_remaining: remaining.trim() === '' ? null : Number(remaining),
        packs_on_hand: packs.trim() === '' ? null : Number(packs),
        repeats_due: repeatsDue || null,
        repeats_left: repeatsLeft.trim() === '' ? null : Number(repeatsLeft),
        course_ends_on: courseEnds || null,
        ...(changed
          ? {
              change_reason: changeReason.trim() || null,
              change_source_appointment_id: changeSource.startsWith('appt:') ? changeSource.slice(5) : null,
              change_source_document_id: changeSource === 'letter' && changeDocId ? changeDocId : null,
            }
          : {}),
        // The chosen supplier is authoritative: the server derives the name
        // and reorder link from it. No supplier clears all three.
        ...(supplierId
          ? { supplier_id: supplierId }
          : { supplier_id: null, supplier: null, supplier_order_url: null }),
        // Who writes the script, picked or named; and the visit it started at.
        ...(med ? changedContactFieldsAs('prescriber', pickedFrom(med.prescriber ?? null), prescriber) : contactFieldsAs('prescriber', prescriber)),
        source_appointment_id: sourceAppointmentId || null,
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
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          // Save always answers: say what is missing and go to it.
          if (!name.trim()) {
            setError('Write the medication name first, then save.');
            document.getElementById('med-name')?.focus();
            return;
          }
          const unpicked = contactProblem(prescriber, 'who prescribed it');
          if (unpicked) {
            setError(unpicked);
            document.getElementById('med-prescriber')?.focus();
            return;
          }
          setError('');
          mutation.mutate();
        }}
      >
        <Input id="med-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Metformin" list="med-catalogue-options" hint="Pick an existing medication to reuse it, or type a new one." />
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

        <section className="grid gap-4 sm:grid-cols-2">
          <ContactPicker
            id="med-prescriber"
            label="Prescribed by"
            profileId={profileId}
            value={prescriber}
            onChange={setPrescriber}
            kind="person"
            hint="Who writes the script."
            placeholder="Search Contacts or type their name"
          />
          <div>
            <label htmlFor="med-started-at" className="block text-sm font-medium text-ink mb-1">Started at</label>
            <select id="med-started-at" className={`${SELECT} w-full`} value={sourceAppointmentId} onChange={(e) => setSourceAppointmentId(e.target.value)}>
              <option value="">Not from an appointment</option>
              {pastVisits.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}, {format(new Date(a.starts_at!), 'd MMM yyyy')}
                </option>
              ))}
              {sourceAppointmentId && !pastVisits.some((a) => a.id === sourceAppointmentId) ? (
                <option value={sourceAppointmentId}>{med?.source_appointment?.title ?? 'The visit it came from'}</option>
              ) : null}
            </select>
          </div>
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
            <div className="space-y-3">
              <label className="inline-flex items-center gap-1.5 text-sm text-ink">
                <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={withFood} onChange={(e) => setWithFood(e.target.checked)} />
                Taken with food
              </label>
              <Input id="med-as-needed-for" label="What it is for" value={asNeededFor} onChange={(e) => setAsNeededFor(e.target.value)} placeholder="e.g. Breakthrough pain" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  id="med-gap-hours"
                  type="number"
                  min="0"
                  step="0.5"
                  label="Hours between doses"
                  value={gapHours}
                  onChange={(e) => { setGapHours(e.target.value); setLimitsTouched(true); }}
                  placeholder="e.g. 4"
                />
                <Input
                  id="med-most-per-day"
                  type="number"
                  min="0"
                  step="1"
                  label="Most in 24 hours"
                  value={mostPerDay}
                  onChange={(e) => { setMostPerDay(e.target.value); setLimitsTouched(true); }}
                  placeholder="e.g. 4"
                />
              </div>
              {!limitsTouched && (gapHours || mostPerDay) && (() => {
                const read = limitsFromText(instructions, units.trim() === '' ? null : Number(units));
                return String(read.min_hours_between_doses ?? '') === gapHours && String(read.max_doses_per_day ?? '') === mostPerDay;
              })() ? (
                <p className="text-xs text-muted">Worked out from the instructions.</p>
              ) : null}
              <p className="text-xs text-muted">A dose given sooner, or more often, asks why. It is never stopped.</p>
            </div>
          )}
          <div className="mt-3">
            <Textarea
              id="med-instructions"
              label="Instructions"
              value={instructions}
              onChange={(e) => {
                setInstructions(e.target.value);
                // The limits follow what the instructions say until someone types their own.
                if (!limitsTouched) {
                  const read = limitsFromText(e.target.value, units.trim() === '' ? null : Number(units));
                  setGapHours(read.min_hours_between_doses != null ? String(read.min_hours_between_doses) : '');
                  setMostPerDay(read.max_doses_per_day != null ? String(read.max_doses_per_day) : '');
                }
              }}
              rows={2}
              placeholder="e.g. Minimum 4 hours between doses"
            />
          </div>
          <div className="mt-3 max-w-xs">
            <Input
              id="med-course-ends"
              type="date"
              label="Last day of the course"
              value={courseEnds}
              onChange={(e) => setCourseEnds(e.target.value)}
              hint="Only for a course, such as antibiotics. After this day its doses stop being due."
            />
          </div>
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
            Repeats left on the script:{' '}
            <input className={inlineInput} aria-label="Repeats left on the script" type="number" min="0" max="99" step="1" value={repeatsLeft} onChange={(e) => setRepeatsLeft(e.target.value)} />
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

        {changed ? (
          <section className="rounded-md border border-border bg-surface-2 p-3 space-y-3">
            <p className="text-sm text-ink">The {(doseAmount.trim() || '') !== (med?.dose_amount ?? '') || (doseUnit.trim() || '') !== (med?.dose_unit ?? '') ? 'dose' : 'times'} changed. This is kept in its history.</p>
            <Input
              id="med-change-reason"
              label="Why did it change?"
              placeholder="e.g. Blood pressure low after a fall"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
            />
            <div>
              <label htmlFor="med-change-source" className="block text-sm font-medium text-ink mb-1">Where did the change come from?</label>
              <select id="med-change-source" className={`${SELECT} w-full`} value={changeSource} onChange={(e) => setChangeSource(e.target.value)}>
                <option value="">Choose one</option>
                {pastVisits.slice(0, 10).map((a) => (
                  <option key={a.id} value={`appt:${a.id}`}>
                    {a.title}, {format(new Date(a.starts_at!), 'd MMM yyyy')}
                  </option>
                ))}
                <option value="letter">A letter on file</option>
                <option value="unsure">Not sure</option>
              </select>
            </div>
            {changeSource === 'letter' ? (
              <div>
                <label htmlFor="med-change-letter" className="block text-sm font-medium text-ink mb-1">Which letter</label>
                <select id="med-change-letter" className={`${SELECT} w-full`} value={changeDocId} onChange={(e) => setChangeDocId(e.target.value)}>
                  <option value="">Choose a document</option>
                  {letters.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
                {letters.length === 0 ? <p className="mt-1 text-xs text-muted">No documents on file yet. Upload the letter in Documents, then pick it here.</p> : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Save</Button>
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
