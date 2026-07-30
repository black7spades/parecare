import { ProfileContactCard } from './profile/ProfileContactCard';
import { ConditionsCard } from './profile/ConditionsCard';
import { NeurotypesCard } from './profile/NeurotypesCard';
import { SubstanceUseCard } from './profile/SubstanceUseCard';
import { PoaCardSlot } from './profile/PoaCard';
import { UpcomingCard } from './profile/UpcomingCard';
import { HealthCard } from './profile/HealthCard';
import { HealthSpendCard } from './profile/HealthSpendCard';
import { CareLogCard } from './profile/CareLogCard';
import type { CardDefinition } from './types';

/**
 * The cards that make up somebody's overview, in the order they appear
 * before anybody rearranges them.
 *
 * Each key is kept in whatever arrangement somebody has saved, so a key
 * never changes once it has shipped. Same rule as the sections in the
 * sidebar, and for the same reason.
 */
export const PROFILE_CARDS: CardDefinition[] = [
  { key: 'profile', label: 'Contact details', Component: ProfileContactCard },
  { key: 'conditions', label: 'Conditions', Component: ConditionsCard },
  { key: 'neurotypes', label: 'Neurotypes', Component: NeurotypesCard },
  { key: 'substance-use', label: 'Substance use', Component: SubstanceUseCard },
  {
    key: 'poa',
    label: 'Power of attorney',
    Component: PoaCardSlot,
    // A cat cannot appoint anybody.
    shows: (ctx) => ctx.profile.kind !== 'pet',
  },
  { key: 'upcoming', label: 'Coming up', Component: UpcomingCard },
  { key: 'health', label: 'Current health', Component: HealthCard },
  {
    key: 'health-spend',
    label: 'Health spend',
    Component: HealthSpendCard,
    // What care costs is for whoever carries it, not the whole circle.
    shows: (ctx) => ctx.access === 'owner' || ctx.access === 'admin',
  },
  { key: 'log', label: 'Care log', Component: CareLogCard },
];

export const PROFILE_CARD_KEYS = PROFILE_CARDS.map((c) => c.key);
