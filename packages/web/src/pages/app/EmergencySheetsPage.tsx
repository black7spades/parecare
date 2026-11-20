import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { PoaBadge } from '../../components/PoaBadge';
import { PhoneLink } from '../../components/cards/profile/links';
import { poaLabel, providerTypeLabel, residenceTypeLabel, roomAreaTypeLabel } from '../../lib/care';
import { formatDateOnly } from '../../lib/datetime';

interface Sheet {
  profile: { id: string; full_name: string; preferred_name: string | null; date_of_birth: string | null; primary_language: string | null };
  residence: {
    residence_type: string | null;
    facility: { name: string; phone: string | null } | null;
    room_number: string | null;
    room_area_name: string | null;
    room_area_type: string | null;
    address: string | null;
  };
  allergies: Array<{ substance: string; reaction: string | null }>;
  emergency_contacts: Array<{ name: string; relationship: string | null; phone: string | null; inferred?: boolean }>;
  poa_holders: Array<{ name: string; poa_type: string | null; poa_activated: boolean; contact: string | null }>;
  conditions: string[];
  medications: Array<{ name: string; dose: string | null; as_needed: boolean; schedule_times: string[]; frequency: string | null }>;
  advance_care_directive: { in_place: boolean; location: string | null };
  gps: Array<{ name: string; organisation: string | null; phone: string | null }>;
  other_providers: Array<{ name: string; provider_type: string | null; phone: string | null }>;
  communication_needs: string[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">{title}</h2>
      {children}
    </div>
  );
}

const NotRecorded = ({ text = 'Not recorded.' }: { text?: string }) => <p className="text-sm text-muted">{text}</p>;

/** One person's sheet, the same sections in the same order as their own emergency sheet. */
function SheetView({ sheet }: { sheet: Sheet }) {
  const r = sheet.residence;
  const kind = residenceTypeLabel(r.residence_type);
  const residence = r.facility
    ? [
        r.facility.name,
        [r.room_number ? `Room ${r.room_number}` : null, r.room_area_name ? `${r.room_area_name}${r.room_area_type ? ` ${roomAreaTypeLabel(r.room_area_type)}` : ''}` : null].filter(Boolean).join(', ') || null,
        kind || null,
        r.facility.phone ? `Phone: ${r.facility.phone}` : null,
      ].filter(Boolean).join(' · ')
    : r.address
      ? [r.address, kind || null].filter(Boolean).join(' · ')
      : kind || '';
  return (
    <div className="print-sheet card space-y-5 break-after-page print:break-after-page">
      <div className="border-b border-border pb-3">
        <h1 className="text-xl font-bold text-ink">Emergency information: {sheet.profile.full_name}</h1>
        <p className="text-sm text-muted">
          {[
            sheet.profile.preferred_name ? `Known as ${sheet.profile.preferred_name}` : null,
            sheet.profile.date_of_birth ? `DOB ${formatDateOnly(sheet.profile.date_of_birth, 'd MMM yyyy')}` : null,
            sheet.profile.primary_language ? `Language: ${sheet.profile.primary_language}` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
      {residence ? (
        <Section title="Where they are">
          <p className="text-sm">{residence}</p>
        </Section>
      ) : null}
      <Section title="Allergies, do not give">
        {sheet.allergies.length === 0 ? <NotRecorded text="No known allergies recorded." /> : (
          <table className="w-full text-sm">
            <tbody>
              {sheet.allergies.map((a, i) => (
                <tr key={i}>
                  <td className="py-0.5 font-bold text-red-700">{a.substance}</td>
                  <td className="py-0.5">{a.reaction ? <><span className="text-muted">Reaction: </span>{a.reaction}</> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="Emergency contacts">
        {sheet.emergency_contacts.length === 0 ? <NotRecorded text="No emergency contact chosen yet." /> : sheet.emergency_contacts.map((c, i) => (
          <p key={i} className="text-sm flex flex-wrap items-center gap-x-2">
            <span className="font-medium">{c.name}</span>
            {c.relationship ? <span>{c.relationship}</span> : null}
            {c.phone ? <PhoneLink phone={c.phone} /> : <span className="text-muted">No phone yet.</span>}
          </p>
        ))}
      </Section>
      <Section title="Power of attorney">
        {sheet.poa_holders.length === 0 ? <NotRecorded /> : sheet.poa_holders.map((h, i) => (
          <p key={i} className="text-sm flex items-center gap-2">
            <span className="font-medium">{h.name}</span>
            <span>· {poaLabel(h.poa_type)}</span>
            <PoaBadge type={h.poa_type} activated={h.poa_activated} />
            {h.contact ? <span className="text-muted">{h.contact}</span> : null}
          </p>
        ))}
      </Section>
      <Section title="Medical conditions">
        {sheet.conditions.length === 0 ? <NotRecorded /> : <p className="text-sm">{sheet.conditions.join(' · ')}</p>}
      </Section>
      <Section title="Current medications">
        {sheet.medications.length === 0 ? <NotRecorded /> : (
          <table className="w-full text-sm">
            <tbody>
              {sheet.medications.map((m, i) => (
                <tr key={i}>
                  <td className="py-0.5 font-medium">{m.name}</td>
                  <td className="py-0.5">{m.dose ?? ''}</td>
                  <td className="py-0.5">{m.as_needed ? 'As needed' : m.schedule_times.length ? m.schedule_times.join(', ') : m.frequency ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {sheet.advance_care_directive.in_place ? (
        <Section title="Advance care directive">
          <p className="text-sm">In place.{sheet.advance_care_directive.location ? ` Location: ${sheet.advance_care_directive.location}` : ''}</p>
        </Section>
      ) : null}
      <Section title="GP">
        {sheet.gps.length === 0 ? <NotRecorded /> : sheet.gps.map((gp, i) => (
          <p key={i} className="text-sm flex flex-wrap items-center gap-x-2">
            <span className="font-medium">{gp.name}</span>
            {gp.organisation ? <span>{gp.organisation}</span> : null}
            {gp.phone ? <PhoneLink phone={gp.phone} /> : null}
          </p>
        ))}
      </Section>
      {sheet.other_providers.length > 0 ? (
        <Section title="Other providers">
          {sheet.other_providers.map((p, i) => (
            <p key={i} className="text-sm flex flex-wrap items-center gap-x-2">
              <span className="font-medium">{p.name}</span>
              <span>{providerTypeLabel(p.provider_type ?? '')}</span>
              {p.phone ? <PhoneLink phone={p.phone} /> : null}
            </p>
          ))}
        </Section>
      ) : null}
      {sheet.communication_needs.length > 0 ? (
        <Section title="Communication">
          <p className="text-sm">{sheet.communication_needs.join(' · ')}</p>
        </Section>
      ) : null}
      <p className="text-xs text-muted border-t border-border pt-2">
        Generated by PareCare on {format(new Date(), 'd MMM yyyy')}. Verify details before relying on them.
      </p>
    </div>
  );
}

/**
 * Emergency sheets for many people at once, one to a printed page, for a
 * wing or a whole home. Chosen from the Homeboard.
 */
export function EmergencySheetsPage() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['emergency-sheets', ids.join(',')],
    queryFn: () => api.get<{ sheets: Sheet[]; left_out: number }>(`/care-profiles/emergency-sheets?ids=${ids.join(',')}`),
    enabled: ids.length > 0,
  });
  const sheets = data?.sheets ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-ink">Emergency sheets</h1>
          <p className="text-xs text-muted">
            {sheets.length} {sheets.length === 1 ? 'sheet' : 'sheets'}, one to a page when printed.
            {data?.left_out ? ` ${data.left_out} could not be included because you do not have access to them.` : ''}
          </p>
        </div>
        {sheets.length > 0 ? <Button onClick={() => window.print()}>Print</Button> : null}
      </div>
      {ids.length === 0 ? (
        <div className="card text-center py-10 space-y-2">
          <p className="text-sm text-ink">Choose the people whose sheets you need on the Homeboard, then Print emergency sheets.</p>
          <Link to="/app" className="text-sm text-primary hover:underline">Go to the Homeboard</Link>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-muted">Putting the sheets together.</p>
      ) : isError ? (
        <p className="text-sm text-red-600">The sheets could not be loaded just now. Try again in a moment.</p>
      ) : (
        sheets.map((s) => <SheetView key={s.profile.id} sheet={s} />)
      )}
    </div>
  );
}
