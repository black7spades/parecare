/** Shared class strings for the main sidebar nav, used across Shell and the
 * sortable nav groups so links and headings stay visually identical. */

export const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
    isActive ? 'bg-primary-50 text-primary font-medium' : 'text-muted hover:text-ink hover:bg-surface-2'
  }`;

export const navHeadingClass = 'pt-4 pb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-muted';
