import { Input } from './ui/Input';
import { AddressAutocomplete } from './AddressAutocomplete';

/**
 * A segmented postal address: every part its own field, filled by the same
 * finder the whole app uses. Shared by people, pets and providers so an
 * address is captured the same way everywhere and stays sortable and
 * exportable by part.
 */
export interface AddressValue {
  line1: string;
  line2: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
}

export const emptyAddress: AddressValue = { line1: '', line2: '', suburb: '', state: '', postcode: '', country: '' };

/** Any part filled means the address is present. */
export const hasAddress = (v: AddressValue): boolean => Object.values(v).some((s) => s.trim() !== '');

/** Read the segmented columns off a record into an AddressValue. */
export function addressFrom(row: {
  address_line1?: string | null;
  address_line2?: string | null;
  address_suburb?: string | null;
  address_state?: string | null;
  address_postcode?: string | null;
  address_country?: string | null;
}): AddressValue {
  return {
    line1: row.address_line1 ?? '',
    line2: row.address_line2 ?? '',
    suburb: row.address_suburb ?? '',
    state: row.address_state ?? '',
    postcode: row.address_postcode ?? '',
    country: row.address_country ?? '',
  };
}

/** Turn an AddressValue into the segmented columns for the API. */
export function addressPayload(v: AddressValue): Record<string, string | null> {
  return {
    address_line1: v.line1.trim() || null,
    address_line2: v.line2.trim() || null,
    address_suburb: v.suburb.trim() || null,
    address_state: v.state.trim() || null,
    address_postcode: v.postcode.trim() || null,
    address_country: v.country.trim() || null,
  };
}

/** One line for display, parts joined in reading order. */
export const addressOneLine = (v: AddressValue): string =>
  [v.line1, v.line2, v.suburb, v.state, v.postcode, v.country].filter((s) => s.trim()).join(', ');

export function AddressFields({
  value,
  onChange,
  findLabel = 'Find address',
}: {
  value: AddressValue;
  onChange: (v: AddressValue) => void;
  findLabel?: string;
}) {
  const set = (patch: Partial<AddressValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <AddressAutocomplete
        label={findLabel}
        value={value.line1}
        onChange={(v) => set({ line1: v })}
        onPickStructured={(parts) =>
          onChange({
            line1: parts.line1 || value.line1,
            line2: parts.line2,
            suburb: parts.suburb,
            state: parts.state,
            postcode: parts.postcode,
            country: parts.country,
          })
        }
        placeholder="Start typing to fill the fields below…"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Address line 1" value={value.line1} onChange={(e) => set({ line1: e.target.value })} />
        <Input label="Address line 2" value={value.line2} onChange={(e) => set({ line2: e.target.value })} />
        <Input label="Suburb" value={value.suburb} onChange={(e) => set({ suburb: e.target.value })} />
        <Input label="State" value={value.state} onChange={(e) => set({ state: e.target.value })} />
        <Input label="Postcode" value={value.postcode} onChange={(e) => set({ postcode: e.target.value })} />
        <Input label="Country" value={value.country} onChange={(e) => set({ country: e.target.value })} />
      </div>
    </div>
  );
}
