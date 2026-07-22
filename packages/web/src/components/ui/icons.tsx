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
