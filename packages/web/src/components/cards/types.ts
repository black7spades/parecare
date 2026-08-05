import type { ComponentType } from 'react';
import type { CareProfile } from '../../lib/care';
import type { Situation } from '../../lib/situation';

/**
 * A card is a piece of somebody's record that knows how to fetch itself,
 * draw itself and, when there is nothing to say, take itself off the screen.
 *
 * The point of the shape is what a card is NOT given. No page state, no
 * derived values, no setters, no query results handed down from above. That
 * is what makes the set of cards on a screen something we can decide from the
 * record later, rather than something written into one enormous page.
 */

/** What the screen already knows. Read to decide which cards exist at all. */
export interface CardContext {
  profileId: string;
  profile: CareProfile;
  access: string;
  isOwner: boolean;
  canEdit: boolean;
  careName: string;
  /** The person's composed situation, when it has loaded. */
  situation: Situation | null;
}

/** Everything a card receives. Keep this small on purpose. */
export interface CardProps {
  profileId: string;
  canEdit: boolean;
  isOwner: boolean;
  careName: string;
}

export interface CardDefinition {
  /**
   * Stable identifier, kept in the arrangement somebody has saved.
   * Never change one once it has shipped.
   */
  key: string;
  /** The heading, drawn by the shell. Sentence case, no parentheses. */
  label: string;
  Component: ComponentType<CardProps>;
  /**
   * Whether this card exists for this person at all: a pet has no power of
   * attorney, a visitor has no business seeing what care costs. Answerable
   * without fetching anything.
   *
   * Never put "is there any data yet" here. That question needs the card's
   * own data, so the card answers it itself by drawing nothing.
   */
  shows?: (ctx: CardContext) => boolean;
}
