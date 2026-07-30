/**
 * The bits more than one of the medication dialogs needs.
 *
 * SELECT is the dropdown styling used by every one of them. It is written out
 * here rather than copied into each file, and it is a candidate for a proper
 * Select component the next time somebody is in this part of the app.
 */
export const SELECT =
  'rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/** Now, as the value a datetime input expects, on this person's clock. */
export function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The same dropdown, stretched to fill a bulk-edit row. */
export const BULK_SELECT = `${SELECT} w-full`;
