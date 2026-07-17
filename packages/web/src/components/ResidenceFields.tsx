import { api } from '../api/client';
import { Input } from './ui/Input';
import { AddressFields, addressFrom, addressPayload, emptyAddress, type AddressValue } from './AddressFields';
import {
  RESIDENCE_TYPES,
  ROOM_AREA_TYPES,
  isFacilityResidence,
  type CareProfile,
  type Provider,
} from '../lib/care';

/**
 * Where a person or pet lives. Two shapes, chosen by the residence type:
 *  - A private residence (or "other") captures a segmented address, filled
 *    by the same finder the providers use.
 *  - A facility (care home, retirement village, group home, hospital) is a
 *    provider plus a spot within it: a room number and a named area of a
 *    chosen kind, e.g. room 42 of the "Carnak" wing. The facility can be
 *    picked from those already linked, or added inline; adding one works
 *    both while editing and while first creating the profile.
 * Every fact is its own field; nothing is packed together.
 */

export interface ResidenceValue {
  residence_type: string;
  address: AddressValue;
  /** An existing linked facility. */
  residence_provider_id: string;
  /** Adding a facility inline instead of picking one. */
  add_new_facility: boolean;
  new_facility_name: string;
  new_facility_phone: string;
  new_facility_address: AddressValue;
  room_number: string;
  room_area_name: string;
  room_area_type: string;
  /** Also contact this facility to reach the person. */
  use_facility_as_contact: boolean;
}

export const emptyResidence: ResidenceValue = {
  residence_type: '',
  address: emptyAddress,
  residence_provider_id: '',
  add_new_facility: false,
  new_facility_name: '',
  new_facility_phone: '',
  new_facility_address: emptyAddress,
  room_number: '',
  room_area_name: '',
  room_area_type: '',
  use_facility_as_contact: false,
};

/** Read the residence off a profile into a ResidenceValue. */
export function residenceFrom(profile: CareProfile): ResidenceValue {
  return {
    ...emptyResidence,
    residence_type: profile.residence_type ?? '',
    address: addressFrom(profile),
    residence_provider_id: profile.residence_provider_id ?? '',
    room_number: profile.room_number ?? '',
    room_area_name: profile.room_area_name ?? '',
    room_area_type: profile.room_area_type ?? '',
  };
}

/** The residence columns for the API, given the resolved facility id. */
function residencePayloadWith(v: ResidenceValue, providerId: string | null): Record<string, string | null> {
  const facility = isFacilityResidence(v.residence_type);
  return {
    residence_type: v.residence_type || null,
    // A facility resident's address is the facility's; a private resident
    // clears any facility link and room.
    ...(facility
      ? { address_line1: null, address_line2: null, address_suburb: null, address_state: null, address_postcode: null, address_country: null }
      : addressPayload(v.address)),
    residence_provider_id: facility ? providerId : null,
    room_number: facility ? v.room_number.trim() || null : null,
    room_area_name: facility ? v.room_area_name.trim() || null : null,
    room_area_type: facility ? v.room_area_type || null : null,
  };
}

/** The residence columns for an initial create, before any facility exists. */
export function residencePayload(v: ResidenceValue): Record<string, string | null> {
  return residencePayloadWith(v, v.residence_provider_id || null);
}

/**
 * Save the residence for a profile that now exists: create the facility if
 * one is being added inline, then return the residence columns and, when
 * asked, a contact override that routes contact through that facility. The
 * caller merges these into its profile update.
 */
export async function persistResidence(
  profileId: string,
  v: ResidenceValue
): Promise<{ payload: Record<string, string | null>; contact?: Record<string, string | null> }> {
  let providerId = v.residence_provider_id || null;
  if (isFacilityResidence(v.residence_type) && v.add_new_facility && v.new_facility_name.trim()) {
    const created = await api.post<{ provider: Provider }>(`/care-profiles/${profileId}/providers`, {
      provider_type: 'care_facility',
      name: v.new_facility_name.trim(),
      phone: v.new_facility_phone.trim() || null,
      ...addressPayload(v.new_facility_address),
    });
    providerId = created.provider.id;
  }
  const payload = residencePayloadWith(v, providerId);
  const contact =
    isFacilityResidence(v.residence_type) && v.use_facility_as_contact && providerId
      ? { contact_kind: 'provider', contact_provider_id: providerId, contact_account_id: null, contact_profile_id: null, contact_name: null, contact_relationship: null, contact_phone: null, contact_phone_type: null, contact_email: null }
      : undefined;
  return { payload, contact };
}

/** Whether saving this residence needs the post-create step (facility work). */
export const residenceNeedsPersist = (v: ResidenceValue): boolean => isFacilityResidence(v.residence_type);

const selectClass =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function ResidenceFields({
  value,
  onChange,
  providers,
}: {
  value: ResidenceValue;
  onChange: (v: ResidenceValue) => void;
  /** Facilities already linked to this profile, for the picker. Empty while creating. */
  providers: Provider[];
}) {
  const set = (patch: Partial<ResidenceValue>) => onChange({ ...value, ...patch });
  const facility = isFacilityResidence(value.residence_type);
  // Whichever facility source is active: an existing one, or a new one.
  const facilitySource = value.add_new_facility ? '__new__' : value.residence_provider_id;

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
            <select
              id="residence-provider"
              className={selectClass}
              value={facilitySource}
              onChange={(e) => {
                if (e.target.value === '__new__') set({ add_new_facility: true, residence_provider_id: '' });
                else set({ add_new_facility: false, residence_provider_id: e.target.value });
              }}
            >
              <option value="">Choose a facility</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="__new__">Add a facility not listed yet</option>
            </select>
          </div>

          {value.add_new_facility ? (
            <div className="rounded-md border border-border bg-surface p-3 space-y-3">
              <Input label="Facility name" value={value.new_facility_name} onChange={(e) => set({ new_facility_name: e.target.value })} placeholder="e.g. Regis Aged Care" />
              <Input label="Facility phone" type="tel" value={value.new_facility_phone} onChange={(e) => set({ new_facility_phone: e.target.value })} />
              <AddressFields value={value.new_facility_address} onChange={(a) => set({ new_facility_address: a })} findLabel="Find facility address" />
              <p className="text-xs text-muted">The facility is saved as a provider and linked to this person.</p>
            </div>
          ) : null}

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

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={value.use_facility_as_contact}
              onChange={(e) => set({ use_facility_as_contact: e.target.checked })}
            />
            Contact this facility to reach them
            <span className="text-xs text-muted">uses the facility's phone and email</span>
          </label>
        </>
      ) : value.residence_type ? (
        <AddressFields value={value.address} onChange={(a) => set({ address: a })} />
      ) : null}
    </div>
  );
}
