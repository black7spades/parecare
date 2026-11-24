import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Link } from 'react-router-dom';
import { personKey, type PickablePerson } from '../lib/care';
import { PhoneLink } from './cards/profile/links';
import { CONTACT_LINK } from './ContactStrip';

/** Everyone who can be picked for a job around a person: you first, then the circle. */
export function usePickablePeople(profileId: string) {
  return useQuery({
    queryKey: ['circle-people', profileId],
    queryFn: () => api.get<{ people: PickablePerson[] }>(`/care-profiles/${profileId}/circle/people`),
  });
}

/** "You, Linda Kowalski" or "Jess Carter, Carer". */
export const personOption = (p: PickablePerson) =>
  p.label === 'You' ? `You, ${p.name}` : p.label ? `${p.name}, ${p.label}` : p.name;

/**
 * Pick one person: the account holder is listed first ("You, Linda"), so
 * the person doing the caring can be picked as well as anyone in the circle.
 */
export function PersonPicker({
  id,
  label,
  profileId,
  value,
  onChange,
  emptyLabel = 'Anyone',
}: {
  id: string;
  label: string;
  profileId: string;
  /** personKey of the picked person, or empty. */
  value: string;
  onChange: (key: string, person: PickablePerson | null) => void;
  emptyLabel?: string;
}) {
  const { data } = usePickablePeople(profileId);
  const people = data?.people ?? [];
  const picked = people.find((p) => personKey(p.ref) === value) ?? null;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">{label}</label>
      <select
        id={id}
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={value}
        onChange={(e) => onChange(e.target.value, people.find((p) => personKey(p.ref) === e.target.value) ?? null)}
      >
        <option value="">{emptyLabel}</option>
        {people.map((p) => (
          <option key={personKey(p.ref)} value={personKey(p.ref)}>{personOption(p)}</option>
        ))}
      </select>
      {picked ? (
        <p className="mt-1 text-xs text-muted">
          {picked.phone ? (
            <>
              Phone <PhoneLink phone={picked.phone} />
            </>
          ) : picked.label === 'You' ? (
            <>
              No phone on your account yet.{' '}
              <Link to="/account/settings" className={`${CONTACT_LINK}`}>Add your phone</Link>
            </>
          ) : (
            'No phone on file yet.'
          )}
        </p>
      ) : null}
    </div>
  );
}
