import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Provider } from '../lib/care';
import { Input } from './ui/Input';

/**
 * Pick the place someone stays: a hospital, a care home, a retirement
 * village, a group home, a hospice or respite. Only places are listed, never
 * the GP or the pharmacy. A place not listed yet is added by name and phone,
 * and filed in Contacts when the form saves.
 */
export interface FacilityValue {
  providerId: string;
  adding: boolean;
  name: string;
  phone: string;
}

export const emptyFacility: FacilityValue = { providerId: '', adding: false, name: '', phone: '' };

/** The fields a form sends for the place, under a prefix: hospital_provider_id, or hospital_name with hospital_phone. */
export function facilityPayload(prefix: string, v: FacilityValue): Record<string, string | null> {
  if (v.adding) return { [`${prefix}_name`]: v.name.trim() || null, [`${prefix}_phone`]: v.phone.trim() || null };
  return { [`${prefix}_provider_id`]: v.providerId || null };
}

export const facilityChosen = (v: FacilityValue) => (v.adding ? !!v.name.trim() : !!v.providerId);

const selectClass =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function useFacilities(profileId: string, enabled = true) {
  return useQuery({
    queryKey: ['providers', profileId, 'facilities'],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profileId}/providers?facility=1`),
    enabled,
  });
}

/** A hospital, by its type or, when its type says nothing, its name. */
const isHospital = (p: Provider) => {
  const t = String(p.provider_type ?? '').toLowerCase();
  return t === 'hospital' || ((!t || t === 'other' || t === 'practice') && /\bhospital\b/i.test(p.name));
};

export function FacilityPicker({
  id,
  profileId,
  label,
  addLabel,
  placeholder,
  value,
  onChange,
  error,
  only,
}: {
  /** Hospitals only, for a hospital stay; care homes and the like only, for a move into care. */
  only?: 'hospital' | 'care';
  id: string;
  profileId: string;
  /** "Hospital", "Care home". */
  label: string;
  /** "Add a hospital", "Add a care home". */
  addLabel: string;
  placeholder?: string;
  value: FacilityValue;
  onChange: (v: FacilityValue) => void;
  error?: string;
}) {
  const { data } = useFacilities(profileId);
  const places = (data?.providers ?? []).filter((p) =>
    p.id === value.providerId || !only ? true : only === 'hospital' ? isHospital(p) : !isHospital(p)
  );
  return (
    <div className="space-y-2">
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">
          {label}
        </label>
        <select
          id={id}
          className={`${selectClass} ${error ? 'border-red-400' : ''}`}
          value={value.adding ? '__new__' : value.providerId}
          onChange={(e) => {
            if (e.target.value === '__new__') onChange({ ...value, adding: true, providerId: '' });
            else onChange({ ...value, adding: false, providerId: e.target.value });
          }}
        >
          <option value="">{places.length ? `Choose ${label.toLowerCase()}` : `None in Contacts yet`}</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="__new__">{addLabel}</option>
        </select>
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>
      {value.adding ? (
        <div className="grid gap-3 sm:grid-cols-2 rounded-md border border-border bg-surface p-3">
          <Input id={`${id}-name`} label="Name" value={value.name} placeholder={placeholder} onChange={(e) => onChange({ ...value, name: e.target.value })} />
          <Input id={`${id}-phone`} label="Their phone" type="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
          <p className="text-xs text-muted sm:col-span-2">It is filed in Contacts when you save.</p>
        </div>
      ) : null}
    </div>
  );
}
