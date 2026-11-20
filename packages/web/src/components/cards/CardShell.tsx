import { createContext, useContext, useEffect } from 'react';

/**
 * The box a card sits in: its heading, the fold-away control, and the arrows
 * for moving it when somebody is rearranging.
 *
 * The card draws this itself rather than the screen drawing it around the
 * card. That is what allows a card with nothing to say to draw nothing at
 * all, instead of leaving an empty titled box behind.
 */

export interface CardSlot {
  cardKey: string;
  label: string;
  /** Something changed in this card since the person last looked. */
  fresh?: boolean;
  collapsed: boolean;
  editView: boolean;
  onToggle: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
  /** Cards say when they are on screen, so the arrows know the real ends. */
  onShown: (key: string, shown: boolean) => void;
  isFirst: boolean;
  isLast: boolean;
}

const SlotContext = createContext<CardSlot | null>(null);

export const CardSlotProvider = SlotContext.Provider;

/** The slot a card has been given, or null when it is drawn on its own. */
export function useCardSlot(): CardSlot | null {
  return useContext(SlotContext);
}

/**
 * `title` replaces the card's usual heading when it needs to say more, such
 * as the date it counts from.
 */
export function CardShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const slot = useCardSlot();

  // Being on screen is what makes the up and down arrows honest. Without it
  // the top card gets a live "move up" that swaps it with something hidden
  // and appears to do nothing, which is the worst kind of control to give
  // somebody who is already tired.
  const shown = slot?.onShown;
  const key = slot?.cardKey;
  useEffect(() => {
    if (!shown || !key) return;
    shown(key, true);
    return () => shown(key, false);
  }, [shown, key]);

  if (!slot) return <div className="card">{children}</div>;

  const { cardKey, label, fresh, collapsed, editView, onToggle, onMove, isFirst, isLast } = slot;

  return (
    <div className="card scroll-mt-4" id={`card-${cardKey}`}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-semibold text-ink hover:text-primary"
          onClick={() => onToggle(cardKey)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
        >
          <span className="text-xs text-muted">{collapsed ? '▶' : '▼'}</span>
          {title ?? label}
          {fresh ? (
            <span className="h-2 w-2 rounded-full bg-primary" title="New since your last visit">
              <span className="sr-only">, new since your last visit</span>
            </span>
          ) : null}
        </button>
        {editView ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`Move ${label} up`}
              disabled={isFirst}
              onClick={() => onMove(cardKey, -1)}
              className="p-1 text-xs text-muted hover:text-ink disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${label} down`}
              disabled={isLast}
              onClick={() => onMove(cardKey, 1)}
              className="p-1 text-xs text-muted hover:text-ink disabled:opacity-30"
            >
              ↓
            </button>
          </span>
        ) : null}
      </div>
      {collapsed ? null : <div className="mt-3">{children}</div>}
    </div>
  );
}

/**
 * What a card shows while it is still finding out whether it has anything.
 *
 * Never nothing. A card that appears a second late shifts the page under
 * somebody's thumb, and on a phone that means tapping the wrong thing.
 */
export function CardWaiting() {
  return <p className="text-sm text-muted">Loading.</p>;
}

/**
 * What a card shows when it could not find out. Never nothing: a card that
 * quietly vanishes because a request failed means nobody ever learns the
 * records were there.
 */
export function CardTrouble({ what }: { what: string }) {
  return <p className="text-sm text-red-600 dark:text-red-400">{what} could not be loaded just now.</p>;
}

/**
 * What a card shows when it is genuinely empty and staying on screen anyway.
 *
 * A heading over nothing is where somebody decides this was not worth the
 * effort, so an empty card has to do two things: say what it is for, and
 * offer the one obvious thing to do about it. The action is optional, since
 * somebody who cannot edit should not be shown a button they cannot press.
 */
export function CardEmpty({ says, children }: { says: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-muted">{says}</p>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
