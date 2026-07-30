/**
 * The field styling the condition editor and its sections all share.
 *
 * One copy rather than four. It is the same recipe as the app's Input
 * component, re-inlined because there is no Select to match it, and it is a
 * candidate for a proper Select the next time somebody is in here.
 */
export const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
