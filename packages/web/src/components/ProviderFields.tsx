import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { AddressFields, type AddressValue } from './AddressFields';
import { CatalogueCombo } from './CatalogueCombo';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import {
  pickableTypesFor,
  providerTypeLabel,
  providerTypeValue,
  type PracticeMember,
  type Provider,
  type ProviderKind,
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

const TYPE_HINTS: Record<ProviderKind | 'any', { endpoint: string; aria: string; placeholder: string }> = {
  person: { endpoint: '/option-catalogue?category=provider_type', aria: 'Type of professional', placeholder: 'e.g. GP, Neurologist, Caseworker' },
  organisation: {
    endpoint: '/option-catalogue?category=organisation_type',
    aria: 'Type of organisation',
    placeholder: 'e.g. Health hub, Hospital, Government department',
  },
  any: { endpoint: '/option-catalogue?category=provider_type', aria: 'Type', placeholder: 'e.g. Clinic, GP, Neurologist' },
};

export function ProviderTypeField({
  id,
  value,
  onChange,
  kind = 'person',
  label = 'Type',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** The field's label, e.g. "What they do" where Type would be unclear. */
  label?: string;
  /** Which list of types to offer: kinds of professional, kinds of organisation, or both. */
  kind?: ProviderKind | 'any';
}) {
  const hint = TYPE_HINTS[kind];
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">{label}</label>
      <CatalogueCombo
        key={kind}
        id={id}
        endpoint={hint.endpoint}
        ariaLabel={hint.aria}
        placeholder={hint.placeholder}
        extraItems={pickableTypesFor(kind).map((t) => t.label)}
        keepValue
        initial={value ? providerTypeLabel(value) : ''}
        widthClass="w-full"
        onPick={(name) => onChange(providerTypeValue(name))}
      />
      <p className="mt-1 text-xs text-muted">Pick one, or type any other kind and it is added to the list.</p>
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
  /** The organisation's own contact details, offered to anyone based there. Null while not known. */
  practiceContact: Partial<Record<SharedField, string | null>> | null;
}

/** Contact details everyone based at an organisation uses unless they have their own. */
export const SHARED_FIELDS = ['phone', 'email', 'booking_link', 'directions_link', 'after_hours_phone', 'fax'] as const;
export type SharedField = (typeof SHARED_FIELDS)[number];

const contactOf = (p: Partial<Record<SharedField, string | null>>) =>
  Object.fromEntries(SHARED_FIELDS.map((f) => [f, p[f] ?? null])) as Record<SharedField, string | null>;

export const emptyWorksAt: WorksAtValue = { practiceId: null, practiceName: '', practiceAddress: null, practiceHasAddress: null, practiceContact: null };

/** What a contact box starts with: empty when the detail comes from where they are based. */
export function ownValue(p: Provider | null, field: SharedField): string {
  if (!p) return '';
  if ((p.inherited_fields ?? []).includes(field)) return '';
  return (p[field] as string | null | undefined) ?? '';
}

/**
 * The hint inside an empty contact box for someone based at an
 * organisation: what they get from it if the box stays empty.
 */
export function sharedPlaceholder(w: WorksAtValue, field: SharedField, fallback?: string): string | undefined {
  const name = w.practiceName.trim();
  if (!name) return fallback;
  const theirs = w.practiceContact?.[field];
  return theirs ? `${theirs}, from ${name}` : `From ${name}, once it has one`;
}

/** The line under the contact boxes, when based somewhere. */
export function SharedContactNote({ worksAt }: { worksAt: WorksAtValue }) {
  const name = worksAt.practiceName.trim();
  if (!name) return null;
  return (
    <p className="text-xs text-muted">
      Leave the phone, after-hours phone, fax, email, opening hours, booking link or directions empty to use {name}&apos;s, and they change whenever {name}&apos;s do. Type one in to use their own instead.
    </p>
  );
}

/** Read where a saved provider works. */
export function worksAtFrom(p: Provider | null): WorksAtValue {
  if (!p?.organisation) return emptyWorksAt;
  return {
    practiceId: p.practice_id ?? null,
    practiceName: p.organisation,
    practiceAddress: p.uses_practice_address ? p.address : null,
    practiceHasAddress: p.uses_practice_address ? !!p.address : null,
    practiceContact: null,
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
  kind = 'person',
}: {
  id: string;
  value: WorksAtValue;
  onChange: (value: WorksAtValue) => void;
  /** The provider being edited, never offered as their own practice. */
  excludeId?: string;
  /** A professional is based at an organisation; an organisation is part of a bigger one. */
  kind?: ProviderKind;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const text = value.practiceName;

  const { data } = useQuery({
    queryKey: ['practice-search', text.trim()],
    queryFn: () => api.get<{ providers: SearchRow[] }>(`/providers/search?kind=organisation&q=${encodeURIComponent(text.trim())}`),
    enabled: open,
  });
  const matches = (data?.providers ?? []).filter((p) => p.id !== excludeId).slice(0, 8);
  const exact = matches.some((p) => p.name.trim().toLowerCase() === text.trim().toLowerCase());
  const options: Array<{ key: string; label: string; detail: string | null; row: SearchRow | null }> = [
    ...matches.map((p) => ({ key: p.id, label: p.name, detail: p.address, row: p })),
    ...(text.trim() && !exact ? [{ key: 'new', label: `File "${text.trim()}" as a new organisation`, detail: null, row: null }] : []),
  ];

  // Editing a saved record: look the organisation up once, to learn its
  // address and contact details.
  useEffect(() => {
    if (!value.practiceId || (value.practiceHasAddress !== null && value.practiceContact !== null)) return;
    let cancelled = false;
    void api
      .get<{ providers: SearchRow[] }>(`/providers/search?kind=organisation&q=${encodeURIComponent(value.practiceName.trim())}`)
      .then((res) => {
        if (cancelled) return;
        const hit = res.providers.find((p) => p.id === value.practiceId);
        if (hit) {
          onChange({
            ...value,
            practiceAddress: value.practiceAddress ?? hit.address,
            practiceHasAddress: !!hit.address,
            practiceContact: contactOf(hit),
          });
        }
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
      onChange({ practiceId: o.row.id, practiceName: o.row.name, practiceAddress: o.row.address, practiceHasAddress: !!o.row.address, practiceContact: contactOf(o.row) });
    } else {
      onChange({ practiceId: null, practiceName: text.trim(), practiceAddress: null, practiceHasAddress: false, practiceContact: {} });
    }
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">{kind === 'organisation' ? 'Part of' : 'Based at'}</label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open && options.length > 0}
        autoComplete="off"
        placeholder="e.g. City Health Hub"
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={text}
        onChange={(e) => {
          onChange({ practiceId: null, practiceName: e.target.value, practiceAddress: null, practiceHasAddress: e.target.value.trim() ? false : null, practiceContact: {} });
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
      <p className="mt-1 text-xs text-muted">
        {kind === 'organisation'
          ? 'The bigger organisation this is inside, if any. A clinic inside a health hub is part of the hub.'
          : 'The organisation they work at or for, if any.'}
      </p>
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

/** Whether others can be based here: every organisation, and anything already holding someone. */
export const isPlace = (p: Pick<Provider, 'kind' | 'member_count'>): boolean => p.kind === 'organisation' || (p.member_count ?? 0) > 0;

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
        <h3 className="text-sm font-semibold text-ink">Based here</h3>
        <p className="text-xs text-muted">Everyone and everything based here shares {practiceName}&apos;s address, all the way down. Change the address once and it changes for all of them.</p>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-xs text-muted">Nothing is based here yet. Add the professionals who work here, and any smaller organisations inside it, like a clinic in a health hub.</p>
      ) : (
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="text-ink">{m.name}</span>
              <span className="text-xs text-muted">{providerTypeLabel(m.provider_type)}</span>
              {m.kind === 'organisation' ? <span className="badge bg-surface-2 text-muted text-xs">Organisation</span> : null}
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
          <Input label="Add someone or something based here" placeholder="e.g. Neuro Clinic, or Dr Carly Examplename" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (name.trim()) add.mutate();
              }
            }}
          />
          <ProviderTypeField key={typeKey} id={`${basePath}-member-type`} value={type} onChange={setType} kind="any" />
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

// ── Other names ────────────────────────────────────────────────────────

/**
 * The other names a provider goes by. Merging a duplicate adds its name
 * here, so it is still found by it; remove one that is wrong, or add a name
 * people use, such as "the Hub".
 */
export function OtherNamesField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const name = draft.trim();
    if (name && !value.some((v) => v.toLowerCase() === name.toLowerCase())) onChange([...value, name]);
    setDraft('');
  };
  return (
    <div>
      <span className="block text-sm font-medium text-ink mb-1">Also known as</span>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((v) => (
          <span key={v} className="badge bg-surface-2 text-ink text-xs flex items-center gap-1">
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              title={`Remove ${v}`}
              className="text-muted hover:text-red-600"
              onClick={() => onChange(value.filter((x) => x !== v))}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          type="text"
          aria-label="Add another name"
          placeholder="Add another name"
          className="w-48 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
      </div>
      <p className="mt-1 text-xs text-muted">Pare and your assistants find it by any of these names too.</p>
    </div>
  );
}
