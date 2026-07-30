import { useCallback, useMemo, useState } from 'react';
import { CardSlotProvider } from './CardShell';
import type { CardContext, CardDefinition } from './types';

/**
 * Draws a set of cards in the order somebody has arranged them.
 *
 * It owns the chrome and nothing else: which card sits where, which are
 * folded away, and whether the arrows are showing. It never knows what any
 * card contains, which is the whole point, because it means the set of cards
 * can later be decided from the record rather than written down here.
 */
export function CardLayout({
  cards,
  ctx,
  order,
  collapsed,
  editView,
  onToggle,
  onMove,
}: {
  cards: CardDefinition[];
  ctx: CardContext;
  order: string[];
  collapsed: Set<string>;
  editView: boolean;
  onToggle: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
}) {
  // Which cards actually put something on screen. A card that finds it has
  // nothing to say draws nothing, so the arrangement arrows have to work from
  // what is really there rather than from the full list.
  const [shown, setShown] = useState<Set<string>>(new Set());
  const onShown = useCallback((key: string, isShown: boolean) => {
    setShown((prev) => {
      if (prev.has(key) === isShown) return prev;
      const next = new Set(prev);
      if (isShown) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const byKey = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards]);
  const existing = useMemo(
    () => order.filter((k) => byKey.has(k) && (byKey.get(k)!.shows?.(ctx) ?? true)),
    [order, byKey, ctx]
  );
  const onScreen = useMemo(() => existing.filter((k) => shown.has(k)), [existing, shown]);

  return (
    <>
      {existing.map((key) => {
        const card = byKey.get(key)!;
        const position = onScreen.indexOf(key);
        return (
          <CardSlotProvider
            key={key}
            value={{
              cardKey: key,
              label: card.label,
              collapsed: collapsed.has(key),
              editView,
              onToggle,
              onMove,
              onShown,
              isFirst: position === 0,
              isLast: position === onScreen.length - 1,
            }}
          >
            <card.Component
              profileId={ctx.profileId}
              canEdit={ctx.canEdit}
              isOwner={ctx.isOwner}
              careName={ctx.careName}
            />
          </CardSlotProvider>
        );
      })}
    </>
  );
}
