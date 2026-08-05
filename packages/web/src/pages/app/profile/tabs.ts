// The sections of a care profile, grouped into main headings with their
// sub-items. Rendered as the left nav when a profile is open. Every item
// has a stable key used for per-carer pinning (nav_pins), so a carer can
// keep critical sections such as the Emergency sheet or the Medication
// record at the top of their navigation.

import type { ComponentType } from 'react';
import {
  HomeIcon,
  RouteIcon,
  TrophyIcon,
  UsersIcon,
  ClipboardIcon,
  HeartPulseIcon,
  AlertTriangleIcon,
  BrainIcon,
  PillIcon,
  ActivityIcon,
  MugIcon,
  HandHeartIcon,
  ClockIcon,
  CalendarIcon,
  ClipboardCheckIcon,
  CheckSquareIcon,
  FileIcon,
  StethoscopeIcon,
  EmergencyIcon,
  ChatIcon,
  BookIcon,
  HelpCircleIcon,
  ListIcon,
  SparkleIcon,
} from '../../../components/ui/icons';

/** A nav glyph component; takes an optional size for the sidebar. */
export type NavIcon = ComponentType<{ size?: number }>;

/**
 * What the sidebar knows about a person, so a nav item can decide whether it
 * belongs at all: a pet has no neurotypes, an unborn baby no substance use.
 * The same idea as CardDefinition.shows, answerable without fetching anything.
 */
export interface NavContext {
  kind: 'person' | 'pet';
  lifeStage: string | null;
}

export interface ProfileNavItem {
  /** Stable identifier stored in nav_pins. Never change once shipped. */
  key: string;
  /** Route segment under /app/:profileId. Empty string = overview. */
  to: string;
  label: string;
  /** Small glyph shown beside the label in the left nav. */
  icon: NavIcon;
  end?: boolean;
  /** Whether this section belongs for this person at all. Absent means always. */
  shows?: (ctx: NavContext) => boolean;
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
    items: [{ key: 'overview', to: '', label: 'Overview', icon: HomeIcon, end: true }],
  },
  {
    key: 'care-profile',
    label: 'Care profile',
    items: [
      { key: 'journey', to: 'journey', label: 'Care journey', icon: RouteIcon },
      { key: 'achievements', to: 'achievements', label: 'Achievements', icon: TrophyIcon },
      { key: 'circle', to: 'circle', label: 'Care circle', icon: UsersIcon },
      { key: 'plan', to: 'plan', label: 'Care plan', icon: ClipboardIcon },
    ],
  },
  {
    key: 'conditions',
    label: 'Conditions',
    items: [
      { key: 'conditions', to: 'conditions', label: 'Conditions', icon: HeartPulseIcon },
      { key: 'allergies', to: 'allergies', label: 'Allergies', icon: AlertTriangleIcon },
      // A pet has no neurotypes; only people do.
      { key: 'neurotypes', to: 'neurotypes', label: 'Neurotypes', icon: BrainIcon, shows: (c) => c.kind !== 'pet' },
      { key: 'medications', to: 'medications', label: 'Medications', icon: PillIcon },
      { key: 'treatments', to: 'treatments', label: 'Treatments', icon: ActivityIcon },
      // Not for a pet, nor for an unborn baby or an infant.
      { key: 'substance-use', to: 'substance-use', label: 'Substance use', icon: MugIcon, shows: (c) => c.kind !== 'pet' && c.lifeStage !== 'expecting' && c.lifeStage !== 'infant' },
      { key: 'care-needs', to: 'care-needs', label: 'Care needs', icon: HandHeartIcon },
    ],
  },
  {
    key: 'management',
    label: 'Management',
    items: [
      { key: 'appointments', to: 'appointments', label: 'Appointments', icon: ClockIcon },
      { key: 'calendar', to: 'calendar', label: 'Calendar', icon: CalendarIcon },
      { key: 'mar', to: 'mar', label: 'Medication record', icon: ClipboardCheckIcon },
      { key: 'tasks', to: 'tasks', label: 'Tasks', icon: CheckSquareIcon },
      { key: 'documents', to: 'documents', label: 'Documents', icon: FileIcon },
      { key: 'providers', to: 'providers', label: 'Providers', icon: StethoscopeIcon },
      { key: 'emergency', to: 'emergency', label: 'Emergency sheet', icon: EmergencyIcon },
    ],
  },
  {
    key: 'communications',
    label: 'Communications',
    items: [
      { key: 'messages', to: 'messages', label: 'Messages', icon: ChatIcon },
      { key: 'memory-book', to: 'memory-book', label: 'Memory book', icon: BookIcon },
      { key: 'questions', to: 'questions', label: 'Questions', icon: HelpCircleIcon },
    ],
  },
  {
    key: 'bottom',
    label: null,
    items: [
      { key: 'logs', to: 'logs', label: 'Logs', icon: ListIcon },
      { key: 'ai', to: 'ai', label: 'Ask PareCare', icon: SparkleIcon },
    ],
  },
];

/** Every nav item flattened, for pin lookups by key. */
export const PROFILE_NAV_ITEMS: ProfileNavItem[] = PROFILE_NAV.flatMap((g) => g.items);

export const profileNavItem = (key: string): ProfileNavItem | undefined =>
  PROFILE_NAV_ITEMS.find((i) => i.key === key);
