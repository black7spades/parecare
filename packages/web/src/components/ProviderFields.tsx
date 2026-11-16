import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { AddressFields, type AddressValue } from './AddressFields';
import { CatalogueCombo } from './CatalogueCombo';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import {
  PICKABLE_PROVIDER_TYPES,
  providerTypeLabel,
  providerTypeValue,
  type PracticeMember,
  type Provider,
} from '../lib/care';

/**
 * The pieces every provider form shares, so the directory and a person's
 * own providers page ask the same questions the same way:
 *
 * - ProviderTypeField: pick a kind or type any kind ("Neurologist"); a new
 *   one joins the shared list for next time.
 * - WorksAtField and PracticeAddress: where they work, and whether they
 *   share its address, so a clinic's address is typed once.
 * - PracticeMembers: the same link from the practice's side, so people
 *   are added to a practice from either end.
 */

// ── Type ───────────────────────────────────────────────────────────────

export function ProviderTypeField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">Type</label>
      <CatalogueCombo
        id={id}
        endpoint="/option-catalogue?category=provider_type"
        ariaLabel="Type of provider"
        placeholder="e.g. GP, Neurologist, Dentist"
        extraItems={PICKABLE_PROVIDER_TYPES.map((t) => t.label)}
        keepValue
        initial={value ? providerTypeLabel(value) : ''}
        widthClass="w-full"
        onPick={(name) => onChange(providerTypeValue(name))}
      />
      <p className="mt-1 text-xs text-muted">Pick one, or type any kind of provider and it is added to the list.</p>
    </div>
  );
}

// ── Where they work ────────────────────────────────────────────────────

export interface WorksAtValue {
  practiceId: string | null;
  practiceName: string;
  /** The practice's one-line address, when known. */
  practiceAddress: string | null;
  /** Whether the practice has an address: null while not known. */
  practiceHasAddress: boolean | null;
}

export const emptyWorksAt: WorksAtValue = { practiceId: null, practiceName: '', practiceAddress: null, practiceHasAddress: null };

/** Read where a saved provider works. */
export function worksAtFrom(p: Provider | null): WorksAtValue {
  if (!p?.organisation) return emptyWorksAt;
  return {
    practiceId: p.practice_id ?? null,
    practiceName: p.organisation,
    practiceAddress: p.uses_practice_address ? p.address : null,
    practiceHasAddress: p.uses_practice_address ? !!p.address : null,
  };
}

/** The practice part of a provider save. */
export function practicePayload(w: WorksAtValue, sharesAddress: boolean): Record<string, unknown> {
  const name = w.practiceName.trim();
  if (!name) return { practice_id: null, practice_name: null, uses_practice_address: false };
  return { practice_id: w.practiceId, practice_name: name, uses_practice_address: sharesAddress };
}

type SearchRow = Provider & { address: string | null };

export function WorksAtField({
  id,
  value,
  onChange,
  excludeId,
}: {
  id: string;
  value: WorksAtValue;
  onChange: (value: WorksAtValue) => void;
  /** The provider being edited, never offered as their own practice. */
  excludeId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const text = value.practiceName;

  const { data } = useQuery({
    queryKey: ['practice-search', text.trim()],
    queryFn: () => api.get<{ providers: SearchRow[] }>(`/providers/search?q=${encodeURIComponent(text.trim())}`),
    enabled: open,
  });
  const matches = (data?.providers ?? []).filter((p) => p.id !== excludeId).slice(0, 8);
  const exact = matches.some((p) => p.name.trim().toLowerCase() === text.trim().toLowerCase());
  const options: Array<{ key: string; label: string; detail: string | null; row: SearchRow | null }> = [
    ...matches.map((p) => ({ key: p.id, label: p.name, detail: p.address, row: p })),
    ...(text.trim() && !exact ? [{ key: 'new', label: `File "${text.trim()}" as a new practice`, detail: null, row: null }] : []),
  ];

  // Editing a saved provider: look the practice up once, to learn its address.
  useEffect(() => {
    if (!value.practiceId || value.practiceHasAddress !== null) return;
    let cancelled = false;
    void api
      .get<{ providers: SearchRow[] }>(`/providers/search?q=${encodeURIComponent(value.practiceName.trim())}`)
      .then((res) => {
        if (cancelled) return;
        const hit = res.providers.find((p) => p.id === value.practiceId);
        if (hit) onChange({ ...value, practiceAddress: hit.address, practiceHasAddress: !!hit.address });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.practiceId]);

  useEffect(() => setHighlight(0), [text]);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pick = (o: (typeof options)[number]) => {
    if (o.row) {
      onChange({ practiceId: o.row.id, practiceName: o.row.name, practiceAddress: o.row.address, practiceHasAddress: !!o.row.address });
    } else {
      onChange({ practiceId: null, practiceName: text.trim(), practiceAddress: null, practiceHasAddress: false });
    }
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">Works at</label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open && options.length > 0}
        autoComplete="off"
        placeholder="Clinic or practice, e.g. Health Hub Morayfield"
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={text}
        onChange={(e) => {
          onChange({ practiceId: null, practiceName: e.target.value, practiceAddress: null, practiceHasAddress: e.target.value.trim() ? false : null });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open && options[highlight]) {
            e.preventDefault();
            pick(options[highlight]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && text.trim() && options.length > 0 ? (
        <ul className="absolute left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-card shadow-lg z-20">
          {options.map((o, i) => (
            <li key={o.key}>
              <button
                type="button"
                className={`w-full text-left px-3 py-1.5 text-sm ${i === highlight ? 'bg-primary-50 text-primary' : 'text-ink hover:bg-surface-2'}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(o)}
              >
                <span className="block">{o.label}</span>
                {o.detail ? <span className="block text-xs text-muted">{o.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 text-xs text-muted">Leave empty if they do not work at a clinic or practice.</p>
    </div>
  );
}

/**
 * The address part of a provider form, aware of where they work: share the
 * practice's address with one tick, or give their own. A practice with no
 * address yet takes the one typed here, so it is never typed twice.
 */
export function PracticeAddress({
  worksAt,
  sharesAddress,
  onSharesAddress,
  address,
  onAddress,
}: {
  worksAt: WorksAtValue;
  sharesAddress: boolean;
  onSharesAddress: (v: boolean) => void;
  address: AddressValue;
  onAddress: (v: AddressValue) => void;
}) {
  const name = worksAt.practiceName.trim();
  if (!name) return <AddressFields value={address} onChange={onAddress} />;

  if (worksAt.practiceHasAddress === false) {
    return (
      <div className="space-y-1">
        <AddressFields value={address} onChange={onAddress} />
        <p className="text-xs text-muted">This is saved as {name}&apos;s address too, so everyone filed there shares it.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
          checked={sharesAddress}
          onChange={(e) => onSharesAddress(e.target.checked)}
        />
        <span>
          Same address as {name}
          {worksAt.practiceAddress ? <span className="block text-xs text-muted">{worksAt.practiceAddress}</span> : null}
        </span>
      </label>
      {!sharesAddress ? <AddressFields value={address} onChange={onAddress} /> : null}
    </div>
  );
}

// ── People who work here ───────────────────────────────────────────────

/** Kinds of provider that are places people work at. */
const PLACE_TYPES = new Set(['practice', 'care_facility', 'pharmacy', 'vet', 'allied_health', 'Hospital', 'Pathology', 'Radiology']);

export const isPlace = (p: Pick<Provider, 'provider_type' | 'member_count'>): boolean =>
  PLACE_TYPES.has(p.provider_type) || (p.member_count ?? 0) > 0;

export function PracticeMembers({
  basePath,
  practiceName,
  canEdit,
  onChanged,
}: {
  /** The practice's API path, e.g. /directory/providers/:id. */
  basePath: string;
  practiceName: string;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [typeKey, setTypeKey] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['practice-members', basePath],
    queryFn: () => api.get<{ members: PracticeMember[] }>(`${basePath}/members`),
  });
  const members = data?.members ?? [];
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['practice-members', basePath] });
    onChanged?.();
  };

  const add = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>(`${basePath}/members`, { name: name.trim(), provider_type: type || null }),
    onSuccess: (res) => {
      setMessage(res.message);
      setError('');
      setName('');
      setType('');
      setTypeKey((k) => k + 1);
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'That could not be saved. Try again.'),
  });
  const remove = useMutation({
    mutationFn: (memberId: string) => api.delete(`${basePath}/members/${memberId}`),
    onSuccess: () => {
      setMessage('');
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'That could not be removed. Try again.'),
  });

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink">People who work here</h3>
        <p className="text-xs text-muted">Everyone filed here shares {practiceName}&apos;s address. Change the address once and it changes for all of them.</p>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-xs text-muted">No one is filed here yet. Add the doctors and staff seen here.</p>
      ) : (
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="text-ink">{m.name}</span>
              <span className="text-xs text-muted">{providerTypeLabel(m.provider_type)}</span>
              {canEdit ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-danger"
                  className="ml-auto"
                  loading={remove.isPending && remove.variables === m.id}
                  onClick={() => remove.mutate(m.id)}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <div className="space-y-2">
          <Input label="Add someone who works here" placeholder="e.g. Dr Carly Examplename" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (name.trim()) add.mutate();
              }
            }}
          />
          <ProviderTypeField key={typeKey} id={`${basePath}-member-type`} value={type} onChange={setType} />
          <div className="flex justify-end">
            <Button type="button" variant="secondary" size="sm" disabled={!name.trim()} loading={add.isPending} onClick={() => add.mutate()}>
              Add to {practiceName}
            </Button>
          </div>
        </div>
      ) : null}
      {message ? <p className="text-xs text-muted">{message}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
