import { useEffect, useState } from 'react';
import { format } from 'date-fns';

/**
 * The current date and time, shown in the top bar on every screen. Time is
 * a critical data point in PareCare: doses, observations and handovers are
 * all timestamped, so the person logging always needs to know what "now"
 * is. Updates every second and shows the browser's own time zone, since
 * that is the clock the user is reading from.
 */
export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    // Align the first tick to the next second boundary, then run every second.
    const timeout = setTimeout(
      () => {
        setNow(new Date());
        interval = setInterval(() => setNow(new Date()), 1000);
      },
      1000 - (Date.now() % 1000)
    );
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div
      className="text-right leading-tight tabular-nums"
      title={`${format(now, 'EEEE d MMMM yyyy, HH:mm:ss')}${zone ? ` (${zone})` : ''}`}
    >
      <div className="text-sm font-medium text-ink">{format(now, 'HH:mm:ss')}</div>
      <div className="text-[11px] text-muted hidden sm:block">{format(now, 'EEE d MMM yyyy')}</div>
    </div>
  );
}
