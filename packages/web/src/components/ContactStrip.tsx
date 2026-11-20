import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import type { ContactSummary } from '../lib/care';
import { bookingHref } from '../lib/booking';
import { parseDateOnly } from '../lib/datetime';
import { Button } from './ui/Button';

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Open now until 17:00", "Closed now. Opens Monday 08:30", from the week's hours. */
function hoursLine(hours: NonNullable<ContactSummary['opening_hours']>): string {
  const now = new Date();
  const day = ((now.getDay() + 6) % 7) + 1;
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = hours.filter((h) => h.day === day);
  const open = today.find((h) => h.opens <= hm && hm < h.closes);
  if (open) return `Open now until ${open.closes}`;
  for (let i = 0; i < 8; i++) {
    const d = ((day - 1 + i) % 7) + 1;
    const next = hours.filter((h) => h.day === d && (i > 0 || h.opens > hm)).sort((a, b) => a.opens.localeCompare(b.opens))[0];
    if (next) return `Closed now. Opens ${i === 0 ? 'today' : DAY_NAMES[d]} ${next.opens}`;
  }
  return 'Closed now';
}

/**
 * Anyone to call, the same way everywhere: who they are, what they do and
 * where, their numbers to tap, and the ways to book or find them. Full in
 * record panels and cards; one line in forms, lists and alerts.
 */
export function ContactStrip({
  contact,
  profileId,
  lead,
  size = 'full',
  book,
  onAddPhone,
}: {
  contact: ContactSummary;
  /** Needed for Book appointment. */
  profileId?: string;
  /** A muted label before the name, e.g. "Who with". */
  lead?: string;
  size?: 'full' | 'compact';
  /** Book appointment opens the booking form; false leaves it out. */
  book?: false | { condition?: string | null; fromTask?: string | null; title?: string | null; type?: string | null };
  onAddPhone?: () => unknown;
}) {
  const navigate = useNavigate();
  const canBook = book !== false && book !== undefined && contact.source === 'contact' && !!contact.id && !!profileId;
  const bookButton = canBook ? (
    <Button
      size={size === 'full' ? 'sm' : 'xs'}
      variant="secondary"
      onClick={() => navigate(bookingHref(profileId!, { provider: contact.id, ...(book || {}) }))}
    >
      Book appointment
    </Button>
  ) : null;
  const sub = [contact.role_label, contact.organisation?.name].filter(Boolean);
  const ended = contact.ended_on ? parseDateOnly(contact.ended_on) : null;

  if (size === 'compact') {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {lead ? <span className="text-xs text-muted">{lead}</span> : null}
        <span className="font-semibold text-ink">{contact.name}</span>
        {contact.role_label ? <span className="text-xs text-muted">{contact.role_label}</span> : null}
        {contact.phone ? (
          <a href={telHref(contact.phone)} className="text-primary hover:underline" aria-label={`Call ${contact.name} on ${contact.phone}`}>
            {contact.phone}
          </a>
        ) : (
          <span className="text-xs text-muted">No phone yet.</span>
        )}
        {!contact.phone && onAddPhone ? (
          <Button size="xs" variant="ghost" onClick={() => void onAddPhone()}>Add their phone</Button>
        ) : null}
        {bookButton}
      </div>
    );
  }

  return (
    <div className="space-y-1 text-sm">
      {lead ? <p className="text-xs text-muted">{lead}</p> : null}
      <p className="text-sm font-semibold text-ink break-words">{contact.name}</p>
      {sub.length ? <p className="text-xs text-muted">{sub.join(' · ')}</p> : null}
      {ended ? (
        <p>
          <span className="rounded px-1.5 py-0.5 text-xs text-muted bg-surface-2">No longer seeing them since {format(ended, 'd MMM yyyy')}</span>
        </p>
      ) : null}
      <dl className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
        {contact.phone ? (
          <>
            <dt className="text-muted">Phone</dt>
            <dd>
              <a href={telHref(contact.phone)} className="text-primary hover:underline" aria-label={`Call ${contact.name} on ${contact.phone}`}>
                {contact.phone}
              </a>
              {contact.inherited.includes('phone') ? <span className="ml-1 text-xs text-muted">the practice's number</span> : null}
            </dd>
          </>
        ) : null}
        {contact.after_hours_phone ? (
          <>
            <dt className="text-muted">After hours</dt>
            <dd>
              <a href={telHref(contact.after_hours_phone)} className="text-primary hover:underline" aria-label={`Call ${contact.name} after hours on ${contact.after_hours_phone}`}>
                {contact.after_hours_phone}
              </a>
            </dd>
          </>
        ) : null}
        {contact.email ? (
          <>
            <dt className="text-muted">Email</dt>
            <dd className="break-all">
              <a href={`mailto:${contact.email}`} className="text-primary hover:underline" aria-label={`Email ${contact.name} at ${contact.email}`}>
                {contact.email}
              </a>
            </dd>
          </>
        ) : null}
        {contact.fax ? (
          <>
            <dt className="text-muted">Fax</dt>
            <dd className="text-ink select-all">{contact.fax}</dd>
          </>
        ) : null}
        {contact.opening_hours?.length ? (
          <>
            <dt className="text-muted">Hours</dt>
            <dd className="text-ink">{hoursLine(contact.opening_hours)}</dd>
          </>
        ) : null}
      </dl>
      {!contact.phone ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">No phone yet.</span>
          {onAddPhone ? <Button size="xs" variant="ghost" onClick={() => void onAddPhone()}>Add their phone</Button> : null}
        </div>
      ) : null}
      {bookButton || contact.booking_link || contact.order_link || contact.directions_link ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          {bookButton}
          {contact.booking_link ? (
            <a href={contact.booking_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" aria-label={`Book online with ${contact.name}`}>
              Book online
            </a>
          ) : null}
          {contact.order_link ? (
            <a href={contact.order_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" aria-label={`Order online from ${contact.name}`}>
              Order online
            </a>
          ) : null}
          {contact.directions_link ? (
            <a href={contact.directions_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" aria-label={`Directions to ${contact.name}`}>
              Directions
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
