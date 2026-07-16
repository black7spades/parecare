// The sections of a care profile, grouped into main headings with their
// sub-items. Rendered as the left nav when a profile is open. Every item
// has a stable key used for per-carer pinning (nav_pins), so a carer can
// keep critical sections such as the Emergency sheet or the Medication
// record at the top of their navigation.

export interface ProfileNavItem {
  /** Stable identifier stored in nav_pins. Never change once shipped. */
  key: string;
  /** Route segment under /app/:profileId. Empty string = overview. */
  to: string;
  label: string;
  end?: boolean;
}

export interface ProfileNavGroup {
  key: string;
  /** Null renders the items without a heading (top-level items). */
  label: string | null;
  items: ProfileNavItem[];
}

export const PROFILE_NAV: ProfileNavGroup[] = [
  {
    key: 'top',
    label: null,
    items: [{ key: 'overview', to: '', label: 'Overview', end: true }],
  },
  {
    key: 'care-profile',
    label: 'Care profile',
    items: [
      { key: 'journey', to: 'journey', label: 'Care journey' },
      { key: 'achievements', to: 'achievements', label: 'Achievements' },
      { key: 'circle', to: 'circle', label: 'Care circle' },
      { key: 'plan', to: 'plan', label: 'Care plan' },
    ],
  },
  {
    key: 'conditions',
    label: 'Conditions',
    items: [
      { key: 'conditions', to: 'conditions', label: 'Conditions' },
      { key: 'allergies', to: 'allergies', label: 'Allergies' },
      { key: 'neurotypes', to: 'neurotypes', label: 'Neurotypes' },
      { key: 'medications', to: 'medications', label: 'Medications' },
      { key: 'treatments', to: 'treatments', label: 'Treatments' },
      { key: 'care-needs', to: 'care-needs', label: 'Care needs' },
    ],
  },
  {
    key: 'management',
    label: 'Management',
    items: [
      { key: 'appointments', to: 'appointments', label: 'Appointments' },
      { key: 'calendar', to: 'calendar', label: 'Calendar' },
      { key: 'mar', to: 'mar', label: 'Medication record' },
      { key: 'tasks', to: 'tasks', label: 'Tasks' },
      { key: 'documents', to: 'documents', label: 'Documents' },
      { key: 'providers', to: 'providers', label: 'Providers' },
      { key: 'emergency', to: 'emergency', label: 'Emergency sheet' },
    ],
  },
  {
    key: 'communications',
    label: 'Communications',
    items: [
      { key: 'messages', to: 'messages', label: 'Messages' },
      { key: 'memory-book', to: 'memory-book', label: 'Memory book' },
      { key: 'questions', to: 'questions', label: 'Questions' },
    ],
  },
  {
    key: 'bottom',
    label: null,
    items: [
      { key: 'logs', to: 'logs', label: 'Logs' },
      { key: 'ai', to: 'ai', label: 'Ask PareCare' },
    ],
  },
];

/** Every nav item flattened, for pin lookups by key. */
export const PROFILE_NAV_ITEMS: ProfileNavItem[] = PROFILE_NAV.flatMap((g) => g.items);

export const profileNavItem = (key: string): ProfileNavItem | undefined =>
  PROFILE_NAV_ITEMS.find((i) => i.key === key);
