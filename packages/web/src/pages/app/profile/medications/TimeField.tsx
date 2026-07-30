import { SELECT } from './shared';
/** The 12-hour time inputs the medication schedule is typed into. */

// Convert stored 24h "HH:MM" to 12h parts and back, for the schedule inputs.
export function to12(hhmm: string): { hour: string; minute: string; ampm: 'AM' | 'PM' } {
  const [h, m] = hhmm.split(':');
  const hour = Number(h);
  return {
    hour: String(hour % 12 === 0 ? 12 : hour % 12),
    minute: m ?? '00',
    ampm: hour >= 12 ? 'PM' : 'AM',
  };
}
export function to24(hour: string, minute: string, ampm: 'AM' | 'PM'): string {
  let h = Number(hour) % 12;
  if (ampm === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${(minute || '00').padStart(2, '0')}`;
}

/** One time-of-day picker in 12-hour form, stored as 24h "HH:MM". */
export function TimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { hour, minute, ampm } = to12(value || '08:00');
  return (
    <span className="inline-flex items-center gap-1">
      <select aria-label="Hour" className={SELECT} value={hour} onChange={(e) => onChange(to24(e.target.value, minute, ampm))}>
        {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="text-muted">:</span>
      <select aria-label="Minute" className={SELECT} value={minute} onChange={(e) => onChange(to24(hour, e.target.value, ampm))}>
        {['00', '15', '30', '45'].map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select aria-label="AM or PM" className={SELECT} value={ampm} onChange={(e) => onChange(to24(hour, minute, e.target.value as 'AM' | 'PM'))}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </span>
  );
}
