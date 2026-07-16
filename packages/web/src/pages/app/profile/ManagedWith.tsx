import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { fuzzyRank, similarity } from '../../../lib/fuzzy';
import {
  DOSE_MEASURES,
  MED_ROUTES,
  MED_TYPES,
  TREATMENT_CATEGORIES,
  TREATMENT_STATUS_OPTIONS,
  treatmentCategoryLabel,
  treatmentStatusLabel,
  type Allergy,
  type MedicalCondition,
} from '../../../lib/care';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
const smallInput =
  'rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/** The kinds a management row can be: a medication or any treatment. */
const ROW_KINDS = [
  { value: 'medication', label: 'Medication' },
  ...TREATMENT_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
];

const rowKindLabel = (k: string) => ROW_KINDS.find((x) => x.value === k)?.label ?? k;

/** One thing managing the condition, still being filled in. */
export interface ManagedRow {
  key: string;
  kind: string;
  /** The medication or treatment name. */
  name: string;
  // Medication details — the full data set for that type.
  unitsPerDose: string;
  doseAmount: string;
  doseUnit: string;
  form: string;
  route: string;
  withFood: boolean;
  critical: boolean;
  perDay: number;
  slots: string[];
  packSize: string;
  remaining: string;
  packs: string;
  repeatsDue: string;
  // Treatment details.
  status: string;
  reviewDate: string;
}

let rowCounter = 0;

export function emptyManagedRow(kind = 'medication', name = ''): ManagedRow {
  rowCounter += 1;
  return {
    key: `row-${Date.now()}-${rowCounter}`,
    kind,
    name,
    unitsPerDose: '1',
    doseAmount: '',
    doseUnit: '',
    form: '',
    route: '',
    withFood: false,
    critical: false,
    perDay: 1,
    slots: ['08:00'],
    packSize: '',
    remaining: '',
    packs: '',
    repeatsDue: '',
    status: 'active',
    reviewDate: '',
  };
}

/** A row counts once it has a name; empty rows are skipped on save. */
export const rowIsFilled = (r: ManagedRow) => r.name.trim().length > 0;

/** Persist every filled row against the saved condition. */
export async function persistManagedRows(
  profileId: string,
  conditionId: string,
  rows: ManagedRow[]
): Promise<void> {
  for (const r of rows) {
    if (!rowIsFilled(r)) continue;
    if (r.kind === 'medication') {
      const asNeeded = r.perDay < 1;
      await api.post(`/care-profiles/${profileId}/medications`, {
        name: r.name.trim(),
        medical_condition_id: conditionId,
        units_per_dose: r.unitsPerDose.trim() === '' ? null : Number(r.unitsPerDose),
        dose_amount: r.doseAmount.trim() || null,
        dose_unit: r.doseUnit.trim() || null,
        form: r.form || null,
        route: r.route || null,
        with_food: r.withFood,
        as_needed: asNeeded,
        critical: r.critical,
        schedule_times: asNeeded ? [] : r.slots.slice(0, r.perDay),
        supply: r.packSize.trim() === '' ? null : Number(r.packSize),
        supply_remaining: r.remaining.trim() === '' ? null : Number(r.remaining),
        packs_on_hand: r.packs.trim() === '' ? null : Number(r.packs),
        repeats_due: r.repeatsDue || null,
      });
    } else {
      await api.post(`/care-profiles/${profileId}/treatments`, {
        name: r.name.trim(),
        category: r.kind,
        current_status: r.status,
        last_review_date: r.reviewDate || null,
        medical_condition_id: conditionId,
      });
    }
  }
}

/**
 * "[Person] has [condition]. It's managed with:" — the management plan
 * as rows the user adds and removes. Each row picks what kind of thing
 * manages the condition and the form adapts to collect the full data
 * for that kind. Suggestions come from how the condition is commonly
 * managed, and medication names reuse the shared catalogue with fuzzy
 * matching so near-duplicates are caught before they are created.
 */
export function ManagedWithSection({
  profileId,
  careName,
  conditionName,
  condition,
  rows,
  onRowsChange,
}: {
  profileId: string;
  careName: string;
  conditionName: string;
  condition: MedicalCondition | null;
  rows: ManagedRow[];
  onRowsChange: (rows: ManagedRow[]) => void;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['medications', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['treatments', profileId] });
  };

  // How this condition is commonly managed, offered as one-tap rows.
  // The server screens the list against this person's recorded allergies,
  // so nothing they are allergic to is ever suggested.
  const { data: suggestionData } = useQuery({
    queryKey: ['common-treatments', profileId, conditionName],
    queryFn: () =>
      api.get<{ suggestions: { kind: string; name: string }[] }>(
        `/condition-catalogue/common-treatments?condition=${encodeURIComponent(conditionName)}&profile_id=${encodeURIComponent(profileId)}`
      ),
    enabled: conditionName.trim().length > 1,
  });

  // This person's allergies, to warn when a typed medication matches one.
  const { data: allergyData } = useQuery({
    queryKey: ['allergies', profileId],
    queryFn: () => api.get<{ allergies: Allergy[] }>(`/care-profiles/${profileId}/allergies`),
  });
  const allergies = allergyData?.allergies ?? [];

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [dismissedAll, setDismissedAll] = useState(false);

  const existingMeds = condition?.medications ?? [];
  const existingTreatments = condition?.treatments ?? [];
  const suggestions = dismissedAll
    ? []
    : (suggestionData?.suggestions ?? []).filter(
        (s) =>
          !dismissed.has(s.name) &&
          !rows.some((r) => r.name.trim().toLowerCase() === s.name.toLowerCase()) &&
          !existingMeds.some((m) => m.name.toLowerCase() === s.name.toLowerCase()) &&
          !existingTreatments.some((t) => t.name.toLowerCase() === s.name.toLowerCase())
      );

  const unlinkMed = useMutation({
    mutationFn: (medId: string) =>
      api.patch(`/care-profiles/${profileId}/medications/${medId}`, { medical_condition_id: null }),
    onSuccess: invalidate,
  });

  const deleteTreatment = useMutation({
    mutationFn: (treatmentId: string) =>
      api.delete(`/care-profiles/${profileId}/treatments/${treatmentId}`),
    onSuccess: invalidate,
  });

  const treatmentStatus = useMutation({
    mutationFn: ({ id, current_status }: { id: string; current_status: string }) =>
      api.patch(`/care-profiles/${profileId}/treatments/${id}`, { current_status }),
    onSuccess: invalidate,
  });

  const setRow = (key: string, patch: Partial<ManagedRow>) =>
    onRowsChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => onRowsChange(rows.filter((r) => r.key !== key));
  const addRow = (kind = 'medication', name = '') => onRowsChange([...rows, emptyManagedRow(kind, name)]);

  return (
    <div className="border-t border-border pt-3">
      <p className="text-sm text-ink mb-2">
        <span className="font-medium">{careName}</span> has{' '}
        <span className="font-medium">{conditionName.trim() || 'this condition'}</span>. It's managed
        with:
      </p>

      {suggestions.length > 0 ? (
        <div className="mb-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-xs text-muted">
              Commonly used for {conditionName.trim().toLowerCase()}. Tap to add one; every detail stays
              editable. Anything {careName} is allergic to is never suggested.
            </p>
            <Button size="xs" variant="ghost" onClick={() => setDismissedAll(true)}>
              Dismiss all
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <span
                key={`${s.kind}-${s.name}`}
                className="inline-flex items-center rounded-full border border-border bg-surface-2 text-xs text-ink"
              >
                <button
                  type="button"
                  className="inline-flex items-center gap-1 pl-2.5 py-1 hover:text-primary"
                  onClick={() => addRow(s.kind, s.name)}
                >
                  <span aria-hidden>+</span> {s.name}
                  <span className="text-muted">· {rowKindLabel(s.kind)}</span>
                </button>
                <button
                  type="button"
                  className="px-2 py-1 text-muted hover:text-ink"
                  aria-label={`Dismiss ${s.name}`}
                  onClick={() => setDismissed((prev) => new Set(prev).add(s.name))}
                >
                  <span aria-hidden>×</span>
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* What already manages it, for a condition being edited. */}
      {existingMeds.length > 0 || existingTreatments.length > 0 ? (
        <div className="space-y-1.5 mb-3">
          {existingMeds.map((m) => (
            <div key={m.id ?? m.name} className="flex items-center gap-2 text-sm">
              <span className="badge bg-surface-2 text-muted text-xs w-28 justify-center">Medication</span>
              <span className="text-ink">{m.name}</span>
              <span className="text-muted text-xs">{m.active ? 'Active' : 'Stopped'}</span>
              {m.id ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={`Remove ${m.name} from this condition`}
                  onClick={() => unlinkMed.mutate(m.id!)}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          {existingTreatments.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <span className="badge bg-surface-2 text-muted text-xs w-28 justify-center">
                {treatmentCategoryLabel(t.category)}
              </span>
              <span className="text-ink">{t.name}</span>
              <select
                aria-label={`Status of ${t.name}`}
                className="ml-auto rounded-md border border-border bg-card px-2 py-1 text-xs"
                value={t.current_status}
                onChange={(e) => treatmentStatus.mutate({ id: t.id, current_status: e.target.value })}
              >
                {TREATMENT_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{treatmentStatusLabel(s.value)}</option>
                ))}
              </select>
              <Button
                size="xs"
                variant="ghost-danger"
                aria-label={`Remove ${t.name}`}
                onClick={() => deleteTreatment.mutate(t.id)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        {rows.map((row, i) => (
          <ManagedRowCard
            key={row.key}
            row={row}
            index={i}
            careName={careName}
            allergies={allergies}
            onChange={(patch) => setRow(row.key, patch)}
            onRemove={() => removeRow(row.key)}
          />
        ))}
      </div>

      <div className="mt-2">
        <Button size="sm" variant="secondary" onClick={() => addRow()}>
          Add another
        </Button>
        {rows.some(rowIsFilled) ? (
          <p className="text-xs text-muted mt-1.5">Each one is saved when the condition is saved.</p>
        ) : null}
      </div>
    </div>
  );
}

function ManagedRowCard({
  row,
  index,
  careName,
  allergies,
  onChange,
  onRemove,
}: {
  row: ManagedRow;
  index: number;
  careName: string;
  allergies: Allergy[];
  onChange: (patch: Partial<ManagedRow>) => void;
  onRemove: () => void;
}) {
  const kindMeta = TREATMENT_CATEGORIES.find((c) => c.value === row.kind);

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <select
          className={smallInput}
          aria-label={`Kind of management ${index + 1}`}
          value={row.kind}
          onChange={(e) => onChange({ kind: e.target.value })}
        >
          {ROW_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
        {kindMeta ? <span className="text-xs text-muted hidden sm:inline">{kindMeta.description}</span> : null}
        <Button size="xs" variant="ghost-danger" className="ml-auto" aria-label={`Remove row ${index + 1}`} onClick={onRemove}>
          Remove
        </Button>
      </div>

      {row.kind === 'medication' ? (
        <MedicationRowFields row={row} careName={careName} allergies={allergies} onChange={onChange} />
      ) : (
        <TreatmentRowFields row={row} onChange={onChange} />
      )}
    </div>
  );
}

/**
 * The full medication data set, matching the Medications page form:
 * identity, dose, schedule, and supply, each its own field.
 */
function MedicationRowFields({
  row,
  careName,
  allergies,
  onChange,
}: {
  row: ManagedRow;
  careName: string;
  allergies: Allergy[];
  onChange: (patch: Partial<ManagedRow>) => void;
}) {
  const typeMeta = MED_TYPES.find((t) => t.value.toLowerCase() === row.form.toLowerCase());
  const routeOptions: string[] = [...MED_ROUTES];
  if (row.route && !routeOptions.includes(row.route)) routeOptions.unshift(row.route);

  const pickType = (value: string) => {
    const t = MED_TYPES.find((x) => x.value === value);
    const patch: Partial<ManagedRow> = { form: value };
    if (t && (!row.route || MED_ROUTES.includes(row.route as (typeof MED_ROUTES)[number]))) {
      patch.route = t.defaultRoute;
    }
    onChange(patch);
  };

  const setPerDay = (n: number) => {
    const count = Math.max(0, Math.min(12, Math.floor(n)));
    const defaults = ['08:00', '12:00', '18:00', '22:00'];
    const slots = [...row.slots];
    while (slots.length < count) slots.push(defaults[slots.length] ?? '08:00');
    onChange({ perDay: count, slots: slots.slice(0, Math.max(count, 1)) });
  };

  const supplyWord = typeMeta?.measured
    ? row.doseUnit.trim() || 'mL'
    : typeMeta
      ? typeMeta.plural.toLowerCase()
      : 'units';

  return (
    <div className="space-y-3">
      <MedicationNameCombo
        value={row.name}
        careName={careName}
        allergies={allergies}
        onChange={(name) => onChange({ name })}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="block">
          <span className="block text-xs text-muted mb-1">Units per dose</span>
          <input
            className={`${smallInput} w-full`}
            type="number"
            min="0"
            step="any"
            value={row.unitsPerDose}
            onChange={(e) => onChange({ unitsPerDose: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Dose amount</span>
          <input
            className={`${smallInput} w-full`}
            placeholder="500"
            value={row.doseAmount}
            onChange={(e) => onChange({ doseAmount: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Dose measure</span>
          <input
            className={`${smallInput} w-full`}
            placeholder="mg"
            list="managed-dose-measures"
            value={row.doseUnit}
            onChange={(e) => onChange({ doseUnit: e.target.value })}
          />
          <datalist id="managed-dose-measures">
            {DOSE_MEASURES.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Type</span>
          <select className={`${smallInput} w-full`} value={row.form} onChange={(e) => pickType(e.target.value)}>
            <option value="">Not set</option>
            {MED_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.value}</option>
            ))}
            {row.form && !MED_TYPES.some((t) => t.value === row.form) ? (
              <option value={row.form}>{row.form}</option>
            ) : null}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Route</span>
          <select className={`${smallInput} w-full`} value={row.route} onChange={(e) => onChange({ route: e.target.value })}>
            <option value="">Not set</option>
            {routeOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Times a day</span>
          <input
            className={`${smallInput} w-full`}
            type="number"
            min="0"
            max="12"
            value={row.perDay}
            onChange={(e) => setPerDay(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={row.withFood}
            onChange={(e) => onChange({ withFood: e.target.checked })}
          />
          <span className="text-sm text-ink">With food</span>
        </label>
        <label className="flex items-center gap-2 self-end pb-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={row.critical}
            onChange={(e) => onChange({ critical: e.target.checked })}
          />
          <span className="text-sm text-ink">Dangerous to miss</span>
        </label>
      </div>

      {row.perDay > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Taken at</span>
          {row.slots.slice(0, row.perDay).map((s, i) => (
            <input
              key={i}
              type="time"
              aria-label={`Time ${i + 1}`}
              className={smallInput}
              value={s}
              onChange={(e) =>
                onChange({ slots: row.slots.map((x, j) => (j === i ? e.target.value : x)) })
              }
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">Zero times a day means taken only as needed.</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="block">
          <span className="block text-xs text-muted mb-1">A full pack provides ({supplyWord})</span>
          <input
            className={`${smallInput} w-full`}
            type="number"
            min="0"
            step="any"
            value={row.packSize}
            onChange={(e) => onChange({ packSize: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Unopened packs on hand</span>
          <input
            className={`${smallInput} w-full`}
            type="number"
            min="0"
            step="any"
            value={row.packs}
            onChange={(e) => onChange({ packs: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">In the open pack ({supplyWord})</span>
          <input
            className={`${smallInput} w-full`}
            type="number"
            min="0"
            step="any"
            value={row.remaining}
            onChange={(e) => onChange({ remaining: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Repeats due</span>
          <input
            className={`${smallInput} w-full`}
            type="date"
            value={row.repeatsDue}
            onChange={(e) => onChange({ repeatsDue: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

function TreatmentRowFields({
  row,
  onChange,
}: {
  row: ManagedRow;
  onChange: (patch: Partial<ManagedRow>) => void;
}) {
  return (
    <div className="grid sm:grid-cols-3 gap-2">
      <label className="block sm:col-span-1">
        <span className="block text-xs text-muted mb-1">What it is</span>
        <input
          className={`${smallInput} w-full`}
          placeholder={
            row.kind === 'exercise'
              ? 'e.g. Daily 30-minute walk'
              : row.kind === 'therapy'
                ? 'e.g. Physiotherapy'
                : row.kind === 'device'
                  ? 'e.g. CPAP unit'
                  : 'e.g. Low-sodium diet'
          }
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="block text-xs text-muted mb-1">Status</span>
        <select className={`${smallInput} w-full`} value={row.status} onChange={(e) => onChange({ status: e.target.value })}>
          {TREATMENT_STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{treatmentStatusLabel(s.value)}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="block text-xs text-muted mb-1">Last reviewed</span>
        <input
          className={`${smallInput} w-full`}
          type="date"
          value={row.reviewDate}
          onChange={(e) => onChange({ reviewDate: e.target.value })}
        />
      </label>
    </div>
  );
}

/**
 * Medication name picker backed by the shared catalogue. Fuzzy-ranked
 * suggestions catch typos ("asprin" still offers Aspirin), and a close
 * match nudges the user to reuse the existing entry instead of creating
 * a near-duplicate.
 */
function MedicationNameCombo({
  value,
  careName,
  allergies,
  onChange,
}: {
  value: string;
  careName: string;
  allergies: Allergy[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Screen the typed name against recorded allergies, over-cautiously:
  // a substring match either way or a close spelling both warn.
  const typed = value.trim().toLowerCase();
  const allergyHit =
    typed.length > 2
      ? allergies.find((a) => {
          const sub = a.substance.trim().toLowerCase();
          return (
            sub.length > 0 &&
            (typed.includes(sub) || sub.includes(typed) || similarity(typed, sub) >= 0.75)
          );
        })
      : undefined;

  const { data } = useQuery({
    queryKey: ['medication-catalogue'],
    queryFn: () => api.get<{ items: { id: string; name: string; form: string | null }[] }>('/medication-catalogue'),
  });
  const catalogue = data?.items ?? [];

  const trimmed = value.trim();
  const matches = trimmed ? fuzzyRank(trimmed, catalogue, (i) => i.name).slice(0, 8) : catalogue.slice(0, 8);
  const exact = matches.some((m) => m.name.toLowerCase() === trimmed.toLowerCase());
  // A very close, non-exact match is probably the same drug misspelt.
  const nearMatch =
    trimmed && !exact
      ? matches.find((m) => similarity(trimmed, m.name) >= 0.8 && !m.name.toLowerCase().includes(trimmed.toLowerCase()))
      : undefined;

  useEffect(() => {
    setHighlight(0);
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <span className="block text-xs text-muted mb-1">Medication</span>
      <input
        type="text"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-label="Medication name"
        placeholder="Type to search the shared medication list..."
        className={inputClass}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && matches[highlight]) {
              onChange(matches[highlight].name);
              setOpen(false);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 ? (
        <ul className="absolute left-0 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-card shadow-lg z-20">
          {matches.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                className={`w-full text-left px-3 py-1.5 text-sm ${
                  i === highlight ? 'bg-primary-50 text-primary' : 'text-ink hover:bg-surface-2'
                }`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => {
                  onChange(m.name);
                  setOpen(false);
                }}
              >
                {m.name}
                {m.form ? <span className="text-muted"> · {m.form}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {allergyHit ? (
        <p className="text-xs font-medium text-red-700 dark:text-red-300 mt-1" role="alert">
          Warning: {careName} has a recorded allergy to {allergyHit.substance}
          {allergyHit.reaction ? ` (${allergyHit.reaction})` : ''}. Check with a clinician before
          adding this medication.
        </p>
      ) : null}
      {nearMatch ? (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-amber-700 dark:text-amber-300">
            Did you mean {nearMatch.name}? Reusing it avoids a near-duplicate entry.
          </span>
          <Button size="xs" variant="secondary" onClick={() => onChange(nearMatch.name)}>
            Use {nearMatch.name}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
