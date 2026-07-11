// The sections of a care profile. Rendered as the secondary left-nav when a
// profile is open (previously a horizontal tab strip).
export const PROFILE_TABS: { to: string; label: string; end?: boolean }[] = [
  { to: '', label: 'Overview', end: true },
  { to: 'journey', label: 'Care journey' },
  { to: 'circle', label: 'Care circle' },
  { to: 'plan', label: 'Care plan' },
  { to: 'medications', label: 'Treatments' },
  { to: 'tasks', label: 'Tasks' },
  { to: 'calendar', label: 'Calendar' },
  { to: 'messages', label: 'Messages' },
  { to: 'memory-book', label: 'Memory book' },
  { to: 'documents', label: 'Documents' },
  { to: 'questions', label: 'Questions' },
  { to: 'providers', label: 'Providers' },
  { to: 'activity', label: 'Activity' },
  { to: 'ai', label: 'Ask PareCare' },
];
