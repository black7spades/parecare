/**
 * Small inline SVG icons for icon-only controls. Always render them
 * inside a Button with an aria-label; they inherit the current text
 * colour via stroke="currentColor".
 */

const iconProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Icons take an optional size so nav rows can use a smaller glyph. */
type IconSize = { size?: number };
const sized = (size?: number) => (size ? { ...iconProps, width: size, height: size } : iconProps);

export function PencilIcon() {
  return (
    <svg {...iconProps}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function CrossIcon() {
  return (
    <svg {...iconProps}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

/** A pill: recording a dose given. */
export function PillIcon() {
  return (
    <svg {...iconProps}>
      <path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z" />
      <path d="m8.5 8.5 7 7" />
    </svg>
  );
}

/** A box: a repeat has been ordered. */
export function PackageIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  );
}

/** A shopping cart: reordering supply from the supplier. */
export function CartIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  );
}

// ── Directory and navigation glyphs ────────────────────────────────
// Small icons that label a nav item. They take a size so the sidebar can
// render them a touch smaller than in-body icons.

/** People. */
export function UsersIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** Pets: a paw print. */
export function PawIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <circle cx="11" cy="4" r="2" />
      <circle cx="18" cy="8" r="2" />
      <circle cx="4" cy="8" r="2" />
      <circle cx="8" cy="14" r="2" />
      <path d="M9 18.5a3.5 3.5 0 0 1 6 0 2 2 0 0 1-2 2.5h-2a2 2 0 0 1-2-2.5Z" />
    </svg>
  );
}

/** Providers: a stethoscope-ish medical mark. */
export function StethoscopeIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M4.8 2.3A.3.3 0 1 0 5 2a.3.3 0 0 0-.2.3" />
      <path d="M8 2v4a4 4 0 0 0 8 0V2" />
      <path d="M12 10v4a5 5 0 0 0 10 0v-1" />
      <circle cx="20" cy="12" r="2" />
    </svg>
  );
}

/** Suppliers: a shopfront. */
export function StoreIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M3 9 4 4h16l1 5" />
      <path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

/** Assets: an equipment crate. */
export function AssetIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
      <path d="M3 8h18" />
      <path d="M9 5.5v3" />
      <path d="M15 5.5v3" />
    </svg>
  );
}

/** Addresses: a map pin. */
export function MapPinIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/** Reports and tools: a bar chart. */
export function ChartIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <line x1="3" y1="21" x2="21" y2="21" />
      <rect x="6" y="12" width="3" height="6" />
      <rect x="11" y="8" width="3" height="10" />
      <rect x="16" y="4" width="3" height="14" />
    </svg>
  );
}

/** Sort arrows: the arrange control. */
export function SortIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M8 3v18" />
      <path d="m4 7 4-4 4 4" />
      <path d="M16 21V3" />
      <path d="m20 17-4 4-4-4" />
    </svg>
  );
}

/** Sign out: a door with an out arrow. */
export function SignOutIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

/** Note: a small pencil writing on a line, for adding or editing a note. */
export function NoteIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Link: a chain, for linking a directory item to profiles. */
export function LinkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

/** Unlink: a broken chain, for detaching a linked record. */
export function UnlinkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M17 7l1-1a4 4 0 0 1 5.66 5.66l-2 2" />
      <path d="M7 17l-1 1a4 4 0 0 1-5.66-5.66l2-2" />
      <path d="M15 3v3" />
      <path d="M20 8h-3" />
      <path d="M9 21v-3" />
      <path d="M4 16h3" />
    </svg>
  );
}

// ── Profile section nav glyphs ─────────────────────────────────────
// One small icon per care-profile section, rendered beside its label in
// the left nav. They take a size so the sidebar can render them a touch
// smaller than in-body icons.

/** Overview: a home. */
export function HomeIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

/** Care journey: a winding route with a flag. */
export function RouteIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <circle cx="6" cy="19" r="2" />
      <path d="M8 19h6a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h4" />
      <path d="M15 4h5v4h-5z" />
    </svg>
  );
}

/** Achievements: a trophy. */
export function TrophyIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M6 4h12v4a6 6 0 0 1-12 0Z" />
      <path d="M6 6H4a2 2 0 0 0 0 4h2" />
      <path d="M18 6h2a2 2 0 0 1 0 4h-2" />
      <path d="M12 14v4" />
      <path d="M9 21h6" />
      <path d="M10 18h4" />
    </svg>
  );
}

/** Care plan: a clipboard. */
export function ClipboardIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  );
}

/** Conditions: a heart with a pulse line. */
export function HeartPulseIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M20.5 8.5A5 5 0 0 0 12 6a5 5 0 0 0-8.5 2.5c0 4 4.5 7.5 8.5 11 4-3.5 8.5-7 8.5-11Z" />
      <path d="M3.5 12h3l1.5-3 2.5 6 1.5-3h3" />
    </svg>
  );
}

/** Allergies: a warning triangle. */
export function AlertTriangleIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M12 3 2 20h20Z" />
      <path d="M12 9v5" />
      <path d="M12 17.5v.5" />
    </svg>
  );
}

/** Neurotypes: a brain. */
export function BrainIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M9.5 4a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 4.5 9a2.5 2.5 0 0 0 0 5 2.5 2.5 0 0 0 2.5 4.5 2.5 2.5 0 0 0 5 0V4a2.5 2.5 0 0 0-2.5-2.5" />
      <path d="M14.5 4a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 19.5 9a2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 1-2.5 4.5 2.5 2.5 0 0 1-5 0" />
    </svg>
  );
}

/** Treatments: an activity pulse line. */
export function ActivityIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  );
}

/** Substance use: a mug. */
export function MugIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z" />
      <path d="M16 10h2a2 2 0 0 1 0 4h-2" />
      <path d="M7 4v1" />
      <path d="M11 4v1" />
    </svg>
  );
}

/** Care needs: a helping hand with a heart. */
export function HandHeartIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M11 14 8 11a2 2 0 0 0-3 0 2 2 0 0 0 0 3l5 5 8-3a2 2 0 0 0-1-4h-5" />
      <path d="M15 5.5a2 2 0 0 0-3-1 2 2 0 0 0-3 1c0 1.5 3 3.5 3 3.5s3-2 3-3.5Z" />
    </svg>
  );
}

/** Calendar: a month grid. */
export function CalendarIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  );
}

/** Appointments: a clock. */
export function ClockIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Medication record: a clipboard with ticks. */
export function ClipboardCheckIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3" />
      <path d="m9 14 1.5 1.5L13 13" />
    </svg>
  );
}

/** Tasks: a ticked box. */
export function CheckSquareIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M9 11l2 2 4-4" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  );
}

/** Documents: a page. */
export function FileIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

/** Emergency sheet: a medical cross in a shield. */
export function EmergencyIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6Z" />
      <path d="M12 8v6" />
      <path d="M9 11h6" />
    </svg>
  );
}

/** Messages: a chat bubble. */
export function ChatIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

/** Memory book: an open book. */
export function BookIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M12 6C10 4.5 7.5 4 4 4v13c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2V4c-3.5 0-6 .5-8 2Z" />
      <path d="M12 6v13" />
    </svg>
  );
}

/** Questions: a question mark in a circle. */
export function HelpCircleIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" />
      <path d="M12 17v.5" />
    </svg>
  );
}

/** Logs: a list. */
export function ListIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3.5 6v.01" />
      <path d="M3.5 12v.01" />
      <path d="M3.5 18v.01" />
    </svg>
  );
}

/** Ask PareCare: a sparkle. */
export function SparkleIcon({ size }: IconSize) {
  return (
    <svg {...sized(size)}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
      <path d="M18 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z" />
    </svg>
  );
}
