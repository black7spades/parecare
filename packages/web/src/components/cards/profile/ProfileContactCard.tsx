import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { residenceTypeLabel, roomAreaTypeLabel, type CareProfile } from '../../../lib/care';
import { keys } from '../../../lib/queryKeys';
import { EmailLink, PhoneLink } from './links';
import { CardShell, CardTrouble, CardWaiting } from '../CardShell';
import type { CardProps } from '../types';

/**
 * How to reach somebody, where they live, and for a pet the details a vet
 * asks for first.
 *
 * The record is already on the screen around this card, so asking for it
 * again is a cache read rather than a request. Done that way on purpose: a
 * card that reaches up into the page for its data is a card that cannot be
 * moved somewhere else later.
 */
export function ProfileContactCard({ profileId }: CardProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: keys.profile(profileId),
    queryFn: () => api.get<{ profile: CareProfile }>(`/care-profiles/${profileId}`),
  });

  if (isPending) return <CardShell><CardWaiting /></CardShell>;
  if (isError) return <CardShell><CardTrouble what="Contact details" /></CardShell>;

  const profile = data.profile;
  return (
    <CardShell>
      {profile.kind === 'pet' ? (
        <div className="space-y-4">
          <PetDetails
            species={profile.species}
            breed={profile.breed}
            desexed={profile.desexed}
            microchip={profile.microchip_number}
            owner={profile.owner_profile ?? null}
          />
          <ProfileContact profile={profile} />
        </div>
      ) : (
        <ProfileContact profile={profile} />
      )}
    </CardShell>
  );
}

function residenceLines(profile: CareProfile): { label: string; value: React.ReactNode }[] {
  const rows: { label: string; value: React.ReactNode }[] = [];
  const fac = profile.residence_provider;
  const kind = residenceTypeLabel(profile.residence_type);
  if (fac) {
    const spot = [
      profile.room_number ? `Room ${profile.room_number}` : null,
      profile.room_area_name ? `${profile.room_area_name}${profile.room_area_type ? ` ${roomAreaTypeLabel(profile.room_area_type)}` : ''}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    rows.push({
      label: 'Lives at',
      value: (
        <span>
          {fac.name}
          {kind ? <span className="text-muted"> · {kind}</span> : null}
          {spot ? <span className="block text-xs text-muted">{spot}</span> : null}
        </span>
      ),
    });
  } else {
    const addr = [
      profile.address_line1,
      profile.address_line2,
      profile.address_suburb,
      profile.address_state,
      profile.address_postcode,
      profile.address_country,
    ]
      .filter(Boolean)
      .join(', ');
    if (addr) {
      rows.push({
        label: 'Address',
        value: (
          <span>
            {addr}
            {kind ? <span className="block text-xs text-muted">{kind}</span> : null}
          </span>
        ),
      });
    } else if (kind) {
      rows.push({ label: 'Lives in', value: kind });
    }
  }
  return rows;
}

function ProfileContact({ profile }: { profile: CareProfile }) {
  // The phone's kind becomes the row label, so it informs without taking
  // up a row of its own.
  const phoneLabel =
    profile.contact_phone_type === 'mobile' ? 'Mobile' : profile.contact_phone_type === 'home' ? 'Home phone' : 'Phone';
  const rows: { label: string; value: React.ReactNode }[] = [...residenceLines(profile)];
  if (profile.contact_kind === 'self') {
    rows.push({ label: 'Contact', value: 'Themselves' });
    if (profile.contact_phone) rows.push({ label: phoneLabel, value: <PhoneLink phone={profile.contact_phone} /> });
    if (profile.contact_email) rows.push({ label: 'Email', value: <EmailLink email={profile.contact_email} /> });
  } else if (profile.contact_kind === 'user') {
    if (profile.contact_account_name) rows.push({ label: 'Contact', value: profile.contact_account_name });
    if (profile.contact_account_email) rows.push({ label: 'Email', value: <EmailLink email={profile.contact_account_email} /> });
  } else if (profile.contact_kind === 'provider' && profile.contact_provider) {
    const p = profile.contact_provider;
    rows.push({ label: 'Contact via', value: p.name });
    if (p.phone) rows.push({ label: 'Phone', value: <PhoneLink phone={p.phone} /> });
    if (p.email) rows.push({ label: 'Email', value: <EmailLink email={p.email} /> });
  } else if (profile.contact_kind === 'profile' && profile.contact_profile) {
    const c = profile.contact_profile;
    rows.push({
      label: 'Primary carer',
      value: (
        <Link to={`/app/${c.id}`} className="text-primary hover:underline">
          {c.preferred_name || c.full_name}
        </Link>
      ),
    });
    if (c.contact_phone) rows.push({ label: 'Phone', value: <PhoneLink phone={c.contact_phone} /> });
    if (c.contact_email) rows.push({ label: 'Email', value: <EmailLink email={c.contact_email} /> });
  } else if (profile.contact_kind === 'contact') {
    if (profile.contact_name) rows.push({ label: 'Contact', value: profile.contact_name });
    if (profile.contact_relationship) rows.push({ label: 'Relationship', value: profile.contact_relationship });
    if (profile.contact_phone) rows.push({ label: phoneLabel, value: <PhoneLink phone={profile.contact_phone} /> });
    if (profile.contact_email) rows.push({ label: 'Email', value: <EmailLink email={profile.contact_email} /> });
  }
  if (rows.length === 0) return null;
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex gap-2">
          <dt className="w-24 shrink-0 text-muted">{r.label}</dt>
          <dd className="min-w-0 flex-1 text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A compact read of substance use for the overview; full detail on the page. */
function PetDetails({
  species,
  breed,
  desexed,
  microchip,
  owner,
}: {
  species: string | null;
  breed: string | null;
  desexed: boolean;
  microchip: string | null;
  owner: { id: string; full_name: string; preferred_name: string | null } | null;
}) {
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (species) rows.push({ label: 'Species', value: species });
  if (breed) rows.push({ label: 'Breed', value: breed });
  rows.push({ label: 'Desexed', value: desexed ? 'Yes' : 'No' });
  if (microchip) rows.push({ label: 'Microchip', value: microchip });
  if (owner) {
    rows.push({
      label: 'Owner',
      value: (
        <Link to={`/app/${owner.id}`} className="text-primary hover:underline">
          {owner.preferred_name || owner.full_name}
        </Link>
      ),
    });
  }
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted">{r.label}</dt>
          <dd className="min-w-0 flex-1 text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
