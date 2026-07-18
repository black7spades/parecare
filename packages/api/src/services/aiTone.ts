import type { CareProfile } from '../types';

/**
 * Tone and audience guidance shared by every AI-written touchpoint. The point:
 * content must fit the person's actual documented circumstances. Someone who
 * runs their own care is not a dependent being watched over, and a stable or
 * mild situation is not a crisis. Nothing here invents facts; it only sets how
 * the facts are addressed and pitched.
 */

const SELF_RELATIONSHIPS = new Set(['myself', 'self', 'me', 'i']);

type ToneProfile = Pick<CareProfile, 'kind' | 'contact_kind' | 'owner_relationship'>;

/**
 * Whether this profile is a person who manages their own care, rather than a
 * dependent looked after by others. Signalled by being their own contact, or
 * an owner relationship that names themselves.
 */
export function isSelfManaged(profile: ToneProfile): boolean {
  if (profile.kind === 'pet') return false;
  if (profile.contact_kind === 'self') return true;
  const rel = (profile.owner_relationship ?? '').trim().toLowerCase();
  return SELF_RELATIONSHIPS.has(rel);
}

/**
 * How AI-written content about one person should address the reader and pitch
 * its tone. A self-managing person reads their own record; content about a
 * dependent is written for the people caring for them. Either way the tone
 * must match what the record shows, not imply constant calamity.
 */
export function toneGuidance(profile: ToneProfile, name: string): string {
  const audience = isSelfManaged(profile)
    ? `AUDIENCE: ${name} manages their own care and is the person reading this. Address ${name} directly as "you". Never write as though speaking to a separate carer about them, and never use third-party carer phrasing such as "let us know", "let someone know", "keep an eye on them", "watch for" (about them, in the third person) or "please monitor them". Where action is warranted, say what ${name} can do themselves (for example "if the pain climbs higher or you feel unwell, book in with your physio or GP"). Do not imply anyone is watching over them or that they need permission or supervision.`
    : `AUDIENCE: ${name} is cared for by others, who read this. Write for those family members and carers, referring to ${name} by name.`;
  return `${audience}\n${TONE_CALIBRATION}`;
}

/**
 * Tone-only calibration: keep the register proportionate to what is recorded.
 * Used on its own where the audience is fixed (external professionals) or
 * spans many people (the homeboard), and folded into toneGuidance elsewhere.
 */
export const TONE_CALIBRATION =
  'TONE: Match the tone to what the record actually shows. Do not imply crisis, alarm or constant vigilance for stable, mild, self-managed or routine situations. Reserve urgent, watchful language for what the record marks as urgent (high severity, contagious, isolation required, or a clearly worsening trend). State the facts calmly and only add a call to action when the situation genuinely warrants one. Never make a competent adult sound like they are perpetually on the edge of a calamity.';
