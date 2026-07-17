import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { AddressAutocomplete } from './AddressAutocomplete';
import {
  RESIDENCE_TYPES,
  ROOM_AREA_TYPES,
  isFacilityResidence,
  type Provider,
} from '../lib/care';

/**
 * Where a person or pet lives. Two shapes, chosen by the residence type:
 *  - A private residence (or "other"/unset) captures a segmented address,
 *    filled by the same finder the providers use.
 *  - A facility (care home, retirement village, group home, hospital) is a
 *    linked provider plus a spot within it: a room number and a named area
 *    of a chosen kind, e.g. room 42 of the "Carnak" wing.
 * Every fact is its own field; nothing is packed together.
 */

export interface ResidenceValue {
  residence_type: string;
  address_line1: string;
  address_line2: string;
  address_suburb: string;
  address_state: string;
  address_postcode: string;
  address_country: string;
  residence_provider_id: string;
  room_number: string;
  room_area_name: string;
  room_area_type: string;
}

export const emptyResidence: ResidenceValue = {
  residence_type: '',
  address_line1: '',
  address_line2: '',
  address_suburb: '',
  address_state: '',
  address_postcode: '',
  address_country: '',
  residence_provider_id: '',
  room_number: '',
  room_area_name: '',
  room_area_type: '',
};

/** Build the care-profile residence columns for the API. */
export function residencePayload(v: ResidenceValue): Record<string, string | null> {
  const facility = isFacilityResidence(v.residence_type);
  return {
    residence_type: v.residence_type || null,
    // A facility resident's address is the facility's, so the private address
    // is cleared; a private resident clears any facility link and room.
    address_line1: facility ? null : v.address_line1.trim() || null,
    address_line2: facility ? null : v.address_line2.trim() || null,
    address_suburb: facility ? null : v.address_suburb.trim() || null,
    address_state: facility ? null : v.address_state.trim() || null,
    address_postcode: facility ? null : v.address_postcode.trim() || null,
    address_country: facility ? null : v.address_country.trim() || null,
    residence_provider_id: facility ? v.residence_provider_id || null : null,
    room_number: facility ? v.room_number.trim() || null : null,
    room_area_name: facility ? v.room_area_name.trim() || null : null,
    room_area_type: facility ? v.room_area_type || null : null,
  };
}

const selectClass =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function ResidenceFields({
  value,
  onChange,
  profileId,
  providers,
  onProvidersChanged,
}: {
  value: ResidenceValue;
  onChange: (v: ResidenceValue) => void;
  /** The profile being edited, or null while creating (no providers yet). */
  profileId: string | null;
  /** Providers already linked to this profile, for the facility picker. */
  providers: Provider[];
  /** Refetch the providers after a facility is added inline. */
  onProvidersChanged?: () => void;
}) {
  const [addFacility, setAddFacility] = useState(false);
  const set = (patch: Partial<ResidenceValue>) => onChange({ ...value, ...patch });
  const facility = isFacilityResidence(value.residence_type);

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div>
        <label htmlFor="residence-type" className="block text-sm font-medium text-ink mb-1">
          Where they live
        </label>
        <select
          id="residence-type"
          className={selectClass}
          value={value.residence_type}
          onChange={(e) => set({ residence_type: e.target.value })}
        >
          <option value="">Choose later</option>
          {RESIDENCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {facility ? (
        <>
          <div>
            <label htmlFor="residence-provider" className="block text-sm font-medium text-ink mb-1">
              Facility
            </label>
            <div className="flex gap-2">
              <select
                id="residence-provider"
                className={selectClass}
                value={value.residence_provider_id}
                onChange={(e) => set({ residence_provider_id: e.target.value })}
              >
                <option value="">Choose a facility</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {profileId ? (
                <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => setAddFacility(true)}>
                  Add facility
                </Button>
              ) : null}
            </div>
            {!profileId ? (
              <p className="mt-1 text-xs text-muted">
                Add the facility as a provider after creating this profile, then choose it here.
              </p>
            ) : providers.length === 0 ? (
              <p className="mt-1 text-xs text-muted">No providers yet. Add the facility to record where they live.</p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-[7rem_1fr_9rem]">
            <Input label="Room" value={value.room_number} onChange={(e) => set({ room_number: e.target.value })} placeholder="e.g. 42" />
            <Input label="Area name" value={value.room_area_name} onChange={(e) => set({ room_area_name: e.target.value })} placeholder="e.g. Carnak" />
            <div>
              <label htmlFor="room-area-type" className="block text-sm font-medium text-ink mb-1">
                Area kind
              </label>
              <select id="room-area-type" className={selectClass} value={value.room_area_type} onChange={(e) => set({ room_area_type: e.target.value })}>
                <option value="">Kind</option>
                {ROOM_AREA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      ) : value.residence_type ? (
        <>
          <AddressAutocomplete
            label="Find address"
            value={value.address_line1}
            onChange={(v) => set({ address_line1: v })}
            onPickStructured={(parts) =>
              set({
                address_line1: parts.line1 || value.address_line1,
                address_line2: parts.line2,
                address_suburb: parts.suburb,
                address_state: parts.state,
                address_postcode: parts.postcode,
                address_country: parts.country,
              })
            }
            placeholder="Start typing to fill the fields below…"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Address line 1" value={value.address_line1} onChange={(e) => set({ address_line1: e.target.value })} />
            <Input label="Address line 2" value={value.address_line2} onChange={(e) => set({ address_line2: e.target.value })} />
            <Input label="Suburb" value={value.address_suburb} onChange={(e) => set({ address_suburb: e.target.value })} />
            <Input label="State" value={value.address_state} onChange={(e) => set({ address_state: e.target.value })} />
            <Input label="Postcode" value={value.address_postcode} onChange={(e) => set({ address_postcode: e.target.value })} />
            <Input label="Country" value={value.address_country} onChange={(e) => set({ address_country: e.target.value })} />
          </div>
        </>
      ) : null}

      {addFacility && profileId ? (
        <AddFacilityModal
          profileId={profileId}
          onClose={() => setAddFacility(false)}
          onAdded={(id) => {
            set({ residence_provider_id: id });
            onProvidersChanged?.();
            setAddFacility(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** Create a care-facility provider and link it to the profile, inline. */
function AddFacilityModal({
  profileId,
  onClose,
  onAdded,
}: {
  profileId: string;
  onClose: () => void;
  onAdded: (providerId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ provider: Provider }>(`/care-profiles/${profileId}/providers`, {
        provider_type: 'care_facility',
        name: name.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['providers', profileId] });
      onAdded(res.provider.id);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not add the facility.'),
  });

  return (
    <Modal open onClose={onClose} title="Add facility">
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Regis Aged Care" />
        <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <AddressAutocomplete label="Address" value={address} onChange={setAddress} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={mutation.isPending} disabled={!name.trim()} onClick={() => mutation.mutate()}>
            Add facility
          </Button>
        </div>
      </div>
    </Modal>
  );
}
