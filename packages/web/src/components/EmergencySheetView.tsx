import { CONTACT_LINK } from './ContactStrip';
import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { Button } from './ui/Button';
import { PoaBadge } from './PoaBadge';
import { EmailLink, PhoneLink } from './cards/profile/links';
import {
  DVA_CARD_COLOURS,
  poaLabel,
  residenceTypeLabel,
  roomAreaTypeLabel,
  severityLabel,
  type ContactSummary,
  type EmergencyContact,
  type Identifiers,
} from '../lib/care';
import { formatDateOnly } from '../lib/datetime';

/**
 * One person's emergency sheet as the server composes it. The same sheet
 * shows on their profile, prints in bulk for a wing, opens from a share link
 * with no login, and is kept on a phone for no signal.
 */
export interface SheetDocument {
  id: string;
  label: string;
}

export interface EmergencySheet {
  profile: { id: string; full_name: string; preferred_name: string | null; date_of_birth: string | null; primary_language: string | null; pronouns: string | null };
  residence: {
    residence_type: string | null;
    facility: { name: string; phone: string | null } | null;
    room_number: string | null;
    room_area_name: string | null;
    room_area_type: string | null;
    address: string | null;
  };
  identifiers: Identifiers;
  allergies: Array<{ substance: string; reaction: string | null; severity: string | null }>;
  no_known_allergies: { on: string; by_name: string | null } | null;
  conditions: string[];
  medications: Array<{ name: string; dose: string | null; as_needed: boolean; schedule_times: string[]; frequency: string | null; critical: boolean; instructions: string | null }>;
  eating_drinking_moving: { diet: string[]; swallowing: string[]; mobility: string[] };
  advance_care_directive: { in_place: boolean; location: string | null; documents: SheetDocument[] };
  poa_holders: Array<{ name: string; poa_type: string | null; poa_activated: boolean; phone: string | null; email: string | null; documents: SheetDocument[] }>;
  emergency_contacts: EmergencyContact[];
  professionals: ContactSummary[];
  communication_needs: string[];
}

/** What can be added straight from an empty section, by someone who may edit. */
export type SheetAdd = 'ids' | 'allergy' | 'no_allergies' | 'condition' | 'medication' | 'needs' | 'directive' | 'poa' | 'contact' | 'gp';

export interface SheetEditing {
  onAdd: (what: SheetAdd) => void;
  /** A busy add, such as recording no known allergies. */
  pending?: SheetAdd | null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ text = 'Not recorded.', editing, adds }: { text?: string; editing?: SheetEditing; adds?: Array<{ what: SheetAdd; label: string }> }) {
  return (
    <p className="text-sm text-muted flex flex-wrap items-center gap-2">
      {text}
      {editing
        ? (adds ?? []).map((a) => (
            <Button key={a.what} size="xs" variant="secondary" className="print:hidden" loading={editing.pending === a.what} onClick={() => editing.onAdd(a.what)}>
              {a.label}
            </Button>
          ))
        : null}
    </p>
  );
}

/** A labelled line, the label muted and the value its own element. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="text-sm text-ink flex flex-wrap gap-x-2">
      <span className="text-muted">{label}</span>
      <span>{children}</span>
    </p>
  );
}

const DocLinks = ({ docs, href }: { docs: SheetDocument[]; href?: (id: string) => string }) =>
  docs.length ? (
    <span className="flex flex-wrap gap-x-3">
      {docs.map((d) =>
        href ? (
          <a key={d.id} href={href(d.id)} target="_blank" rel="noopener noreferrer" className={CONTACT_LINK}>
            {d.label}
          </a>
        ) : (
          <span key={d.id}>{d.label}</span>
        )
      )}
    </span>
  ) : null;

const monthYear = (d: string | null) => (d ? formatDateOnly(d, 'MM/yyyy') : null);

export function EmergencySheetView({
  sheet,
  editing,
  documentHref,
  onChangeContact,
  footer,
}: {
  sheet: EmergencySheet;
  editing?: SheetEditing;
  /** Where a directive or power of attorney document opens. */
  documentHref?: (documentId: string) => string;
  /** Change a worked-out emergency contact. */
  onChangeContact?: () => void;
  footer?: ReactNode;
}) {
  const p = sheet.profile;
  const r = sheet.residence;
  const ids = sheet.identifiers;
  const kind = residenceTypeLabel(r.residence_type);
  const spot = [
    r.room_number ? `Room ${r.room_number}` : null,
    r.room_area_name ? `${r.room_area_name}${r.room_area_type ? ` ${roomAreaTypeLabel(r.room_area_type)}` : ''}` : null,
  ].filter(Boolean).join(', ');
  const hasIds = Object.values(ids).some((v) => v !== null && v !== '');
  const edm = sheet.eating_drinking_moving;
  const hasNeeds = edm.diet.length + edm.swallowing.length + edm.mobility.length > 0;
  const dvaColour = DVA_CARD_COLOURS.find((c) => c.value === ids.dva_card_colour)?.label ?? null;

  return (
    <div className="print-sheet card space-y-5">
      <div className="border-b border-border pb-3">
        <h1 className="text-xl font-bold text-ink">Emergency information: {p.full_name}</h1>
      </div>

      <Section title="Who this is">
        <div className="space-y-0.5">
          <Line label="Name">{p.full_name}</Line>
          {p.preferred_name ? <Line label="Known as">{p.preferred_name}</Line> : null}
          {p.date_of_birth ? <Line label="Date of birth">{formatDateOnly(p.date_of_birth, 'd MMM yyyy')}</Line> : null}
          {p.pronouns ? <Line label="Pronouns">{p.pronouns}</Line> : null}
          {p.primary_language ? <Line label="Language">{p.primary_language}</Line> : null}
          {sheet.communication_needs.length ? <Line label="Communication">{sheet.communication_needs.join(' · ')}</Line> : null}
        </div>
      </Section>

      {r.facility || r.address || kind ? (
        <Section title="Where they are">
          <div className="space-y-0.5">
            {r.facility ? <Line label="Place">{r.facility.name}</Line> : null}
            {spot ? <Line label="Room">{spot}</Line> : null}
            {r.facility?.phone ? <Line label="Phone"><PhoneLink phone={r.facility.phone} /></Line> : null}
            {!r.facility && r.address ? <Line label="Address">{r.address}</Line> : null}
            {kind ? <Line label="Living">{kind}</Line> : null}
          </div>
        </Section>
      ) : null}

      <Section title="ID numbers">
        {hasIds ? (
          <div className="space-y-0.5">
            {ids.medicare_number ? <Line label="Medicare number">{ids.medicare_number.replace(/^(\d{4})(\d{5})(\d)$/, '$1 $2 $3')}</Line> : null}
            {ids.medicare_irn ? <Line label="Position on the card">{ids.medicare_irn}</Line> : null}
            {ids.medicare_valid_to ? <Line label="Valid to">{monthYear(ids.medicare_valid_to)}</Line> : null}
            {ids.ihi_number ? <Line label="Individual Healthcare Identifier">{ids.ihi_number.replace(/(\d{4})(?=\d)/g, '$1 ')}</Line> : null}
            {ids.dva_number ? <Line label="DVA file number">{ids.dva_number}</Line> : null}
            {dvaColour ? <Line label="DVA card colour">{dvaColour}</Line> : null}
            {ids.ndis_number ? <Line label="NDIS number">{ids.ndis_number}</Line> : null}
            {ids.health_fund_name ? <Line label="Health fund">{ids.health_fund_name}</Line> : null}
            {ids.health_fund_member_number ? <Line label="Member number">{ids.health_fund_member_number}</Line> : null}
            {ids.my_aged_care_number ? <Line label="My Aged Care number">{ids.my_aged_care_number}</Line> : null}
          </div>
        ) : (
          <Empty editing={editing} adds={[{ what: 'ids', label: 'Add ID numbers' }]} />
        )}
      </Section>

      <Section title="Allergies, do not give">
        {sheet.allergies.length ? (
          <ul className="space-y-0.5">
            {sheet.allergies.map((a, i) => (
              <li key={i} className="text-sm flex flex-wrap gap-x-3">
                <span className="font-bold text-red-700 dark:text-red-300">{a.substance}</span>
                {a.severity ? (
                  <span className={a.severity === 'life_threatening' || a.severity === 'severe' ? 'font-semibold text-red-700 dark:text-red-300' : 'text-ink'}>
                    <span className="text-muted font-normal">How bad: </span>
                    {severityLabel(a.severity)}
                  </span>
                ) : null}
                {a.reaction ? (
                  <span>
                    <span className="text-muted">Reaction: </span>
                    {a.reaction}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : sheet.no_known_allergies ? (
          <p className="text-sm text-ink">
            No known allergies, checked{sheet.no_known_allergies.by_name ? ` by ${sheet.no_known_allergies.by_name}` : ''} on {formatDateOnly(sheet.no_known_allergies.on, 'd MMM yyyy')}.
          </p>
        ) : (
          <Empty
            text="No allergies recorded, and nobody has checked yet."
            editing={editing}
            adds={[{ what: 'allergy', label: 'Add allergy' }, { what: 'no_allergies', label: 'No known allergies' }]}
          />
        )}
      </Section>

      <Section title="Conditions now">
        {sheet.conditions.length ? (
          <p className="text-sm text-ink">{sheet.conditions.join(' · ')}</p>
        ) : (
          <Empty editing={editing} adds={[{ what: 'condition', label: 'Add condition' }]} />
        )}
      </Section>

      <Section title="Medicines">
        {sheet.medications.length ? (
          <ul className="space-y-1">
            {sheet.medications.map((m, i) => (
              <li key={i} className="text-sm">
                <span className="flex flex-wrap gap-x-3">
                  <span className="font-medium text-ink">{m.name}</span>
                  {m.dose ? <span>{m.dose}</span> : null}
                  <span>{m.as_needed ? 'As needed' : m.schedule_times.length ? m.schedule_times.join(', ') : m.frequency ?? ''}</span>
                  {m.critical ? <span className="badge bg-red-50 text-red-700 dark:bg-red-900/10 dark:text-red-300 text-xs font-semibold">Do not miss</span> : null}
                </span>
                {m.instructions ? <span className="block text-xs text-muted">{m.instructions}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty editing={editing} adds={[{ what: 'medication', label: 'Add medication' }]} />
        )}
      </Section>

      <Section title="Eating, drinking and moving">
        {hasNeeds ? (
          <div className="space-y-0.5">
            {edm.diet.length ? <Line label="Diet">{edm.diet.join(' · ')}</Line> : null}
            {edm.swallowing.length ? <Line label="Eating and drinking safely">{edm.swallowing.join(' · ')}</Line> : null}
            {edm.mobility.length ? <Line label="Moving">{edm.mobility.join(' · ')}</Line> : null}
          </div>
        ) : (
          <Empty editing={editing} adds={[{ what: 'needs', label: 'Add care needs' }]} />
        )}
      </Section>

      <Section title="Advance care directive">
        {sheet.advance_care_directive.in_place ? (
          <div className="space-y-0.5">
            <Line label="In place">Yes</Line>
            {sheet.advance_care_directive.location ? <Line label="Where it is kept">{sheet.advance_care_directive.location}</Line> : null}
            {sheet.advance_care_directive.documents.length ? (
              <Line label="Document">
                <DocLinks docs={sheet.advance_care_directive.documents} href={documentHref} />
              </Line>
            ) : null}
          </div>
        ) : (
          <Empty text="None recorded." editing={editing} adds={[{ what: 'directive', label: 'Record a directive' }]} />
        )}
      </Section>

      <Section title="Power of attorney">
        {sheet.poa_holders.length ? (
          <ul className="space-y-1">
            {sheet.poa_holders.map((h, i) => (
              <li key={i} className="text-sm flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="font-medium text-ink">{h.name}</span>
                <span>{poaLabel(h.poa_type)}</span>
                <PoaBadge type={h.poa_type} activated={h.poa_activated} />
                {h.phone ? <PhoneLink phone={h.phone} /> : <span className="text-muted">No phone yet.</span>}
                {h.email ? <EmailLink email={h.email} /> : null}
                {h.documents.length ? (
                  <span>
                    <span className="text-muted">Document: </span>
                    <DocLinks docs={h.documents} href={documentHref} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty editing={editing} adds={[{ what: 'poa', label: 'Name a holder' }]} />
        )}
      </Section>

      <Section title="Who to call">
        {sheet.emergency_contacts.length ? (
          <ul className="space-y-1">
            {sheet.emergency_contacts.map((c, i) => (
              <li key={c.row_id ?? `${c.name}-${i}`} className="text-sm flex flex-wrap items-center gap-x-3">
                <span className="font-medium text-ink">{c.name}</span>
                {c.relationship ? <span>{c.relationship}</span> : null}
                {c.phone ? <PhoneLink phone={c.phone} /> : <span className="text-muted">No phone yet.</span>}
                {c.inferred ? (
                  <span className="text-xs text-muted print:hidden">
                    Worked out from the profile.{' '}
                    {editing && onChangeContact ? (
                      <Button size="xs" variant="ghost" onClick={onChangeContact}>
                        Change
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="No emergency contact chosen yet." editing={editing} adds={[{ what: 'contact', label: 'Choose who to call' }]} />
        )}
      </Section>

      <Section title="Professionals and organisations">
        {sheet.professionals.length ? (
          <ul className="space-y-1">
            {sheet.professionals.map((c, i) => (
              <li key={c.id ?? i} className="text-sm flex flex-wrap items-center gap-x-3">
                <span className="font-medium text-ink">{c.name}</span>
                {c.role_label ? <span>{c.role_label}</span> : null}
                {c.is_main && c.role_label === 'GP' ? <span className="badge text-xs">Main GP</span> : null}
                {c.organisation ? <span className="text-muted">{c.organisation.name}</span> : null}
                {c.phone ? <PhoneLink phone={c.phone} /> : <span className="text-muted">No phone yet.</span>}
                {c.after_hours_phone ? (
                  <span>
                    <span className="text-muted">After hours </span>
                    <PhoneLink phone={c.after_hours_phone} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty editing={editing} adds={[{ what: 'gp', label: 'Add GP' }]} />
        )}
      </Section>

      <p className="text-xs text-muted border-t border-border pt-2">
        {footer ?? <>Made by PareCare on {format(new Date(), 'd MMM yyyy')}. Check details before relying on them.</>}
      </p>
    </div>
  );
}
