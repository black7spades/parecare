import { useMemo, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { CheckIcon } from '../ui/icons';
import { NavSortControl, type SortOption } from './NavSortControl';
import { navHeadingClass, navLinkClass } from './navStyles';

export interface NavItemDef {
  key: string;
  label: string;
  to: string;
  end?: boolean;
  icon?: ReactNode;
}

export type NavArrange = 'default' | 'az' | 'za' | 'custom';

const ARRANGE_OPTIONS: SortOption<NavArrange>[] = [
  { value: 'default', label: 'Default order' },
  { value: 'az', label: 'A to Z' },
  { value: 'za', label: 'Z to A' },
  { value: 'custom', label: 'Custom order' },
];

const arrangeKey = (group: string) => `parecare-navgroup-arrange-${group}`;
const orderKey = (group: string) => `parecare-navgroup-order-${group}`;
const editingKey = (group: string) => `parecare-navgroup-editing-${group}`;

function readArrange(group: string): NavArrange {
  const v = localStorage.getItem(arrangeKey(group));
  return v === 'az' || v === 'za' || v === 'custom' ? v : 'default';
}
function readOrder(group: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(orderKey(group)) ?? '[]');
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
function readEditing(group: string): boolean {
  return localStorage.getItem(editingKey(group)) === '1';
}

/** Order the items for the chosen arrangement; unknown keys fall to the end. */
function arrangeItems(items: NavItemDef[], arrange: NavArrange, order: string[]): NavItemDef[] {
  const list = [...items];
  if (arrange === 'az') return list.sort((a, b) => a.label.localeCompare(b.label));
  if (arrange === 'za') return list.sort((a, b) => b.label.localeCompare(a.label));
  if (arrange === 'custom' && order.length) {
    const rank = new Map(order.map((k, i) => [k, i]));
    return list.sort((a, b) => (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER));
  }
  return list; // default: definition order
}

/** Up and down arrows plus the tick, matching the pinned-people controls. */
function Arrow({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {dir === 'up' ? <polyline points="6 15 12 9 18 15" /> : <polyline points="6 9 12 15 18 9" />}
    </svg>
  );
}

/**
 * A top-level nav group (Directory, Tools) whose items can be arranged from a
 * theme-aware sort dropdown: default, A to Z, Z to A, or a custom manual order
 * remembered on this device. In custom order each row gains up and down
 * controls, and a tick in the heading locks the order in place and hides the
 * controls again. Each item shows its small icon.
 */
export function SortableNavGroup({
  groupKey,
  heading,
  items,
}: {
  groupKey: string;
  heading: string;
  items: NavItemDef[];
}) {
  const [arrange, setArrangeState] = useState<NavArrange>(() => readArrange(groupKey));
  const [order, setOrder] = useState<string[]>(() => readOrder(groupKey));
  const [editing, setEditingState] = useState<boolean>(() => readEditing(groupKey));

  const ordered = useMemo(() => arrangeItems(items, arrange, order), [items, arrange, order]);

  const persistOrder = (next: string[]) => {
    setOrder(next);
    localStorage.setItem(orderKey(groupKey), JSON.stringify(next));
  };
  const setEditing = (v: boolean) => {
    setEditingState(v);
    localStorage.setItem(editingKey(groupKey), v ? '1' : '0');
  };
  const setArrange = (next: NavArrange) => {
    setArrangeState(next);
    localStorage.setItem(arrangeKey(groupKey), next);
    if (next === 'custom') {
      // Seed the custom order from what is on screen, then let the user edit it.
      if (order.length === 0) persistOrder(ordered.map((i) => i.key));
      setEditing(true);
    } else {
      setEditing(false);
    }
  };

  const isEditing = arrange === 'custom' && editing;

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const keys = ordered.map((i) => i.key);
    const [moved] = keys.splice(index, 1);
    keys.splice(target, 0, moved);
    persistOrder(keys);
  };

  return (
    <div>
      <div className={`${navHeadingClass} flex items-center justify-between gap-1`}>
        <span>{heading}</span>
        <div className="flex items-center gap-0.5">
          {isEditing ? (
            <button
              type="button"
              aria-label={`Lock ${heading} order`}
              title="Lock the order"
              onClick={() => setEditing(false)}
              className="p-1 rounded text-primary hover:bg-surface-2 transition-colors"
            >
              <CheckIcon />
            </button>
          ) : null}
          <NavSortControl
            value={arrange}
            options={ARRANGE_OPTIONS}
            onChange={setArrange}
            ariaLabel={`Arrange ${heading}`}
          />
        </div>
      </div>
      {ordered.map((item, i) => (
        <div key={item.key} className="flex items-center gap-1">
          <NavLink to={item.to} end={item.end} className={({ isActive }) => `${navLinkClass({ isActive })} flex-1 min-w-0`}>
            {item.icon ? <span className="shrink-0 text-muted" aria-hidden>{item.icon}</span> : null}
            <span className="truncate">{item.label}</span>
          </NavLink>
          {isEditing ? (
            <div className="flex items-center shrink-0">
              <button
                type="button"
                aria-label={`Move ${item.label} up`}
                title="Move up"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="p-1 rounded text-muted hover:text-ink hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <Arrow dir="up" />
              </button>
              <button
                type="button"
                aria-label={`Move ${item.label} down`}
                title="Move down"
                disabled={i === ordered.length - 1}
                onClick={() => move(i, 1)}
                className="p-1 rounded text-muted hover:text-ink hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <Arrow dir="down" />
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
