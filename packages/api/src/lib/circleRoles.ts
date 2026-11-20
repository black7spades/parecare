/**
 * Care circle roles. A role is picked from a fixed list on screen, and a
 * document can be shared with only some roles. "Carer" typed by hand and
 * "carer" chosen from the list are the same role, so roles are stored in
 * the list's own form and always compared without case.
 */

export const CIRCLE_ROLE_VALUES = ['family', 'friend', 'carer', 'organisation', 'legal', 'other'] as const;

/** Words people use for a listed role, matched without case. */
const ROLE_ALIASES: Record<string, string> = {
  'legal representative': 'legal',
};

/** The listed form of a role when it is one of ours, else the text tidied. */
export function canonicalRole(role: string | null | undefined): string {
  const t = (role ?? '').trim();
  const key = t.toLowerCase();
  if ((CIRCLE_ROLE_VALUES as readonly string[]).includes(key)) return key;
  if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];
  return t;
}

/** Whether two roles are the same role, ignoring case and spacing. */
export const sameRole = (a: string | null | undefined, b: string | null | undefined): boolean =>
  canonicalRole(a).toLowerCase() === canonicalRole(b).toLowerCase() && canonicalRole(a) !== '';

/**
 * Whether someone in the circle with this role may see a document shared
 * with these roles. No roles means the whole circle sees it.
 */
export function roleMaySee(visibleToRoles: string[] | null | undefined, memberRole: string | null | undefined): boolean {
  const roles = Array.isArray(visibleToRoles) ? visibleToRoles : [];
  if (roles.length === 0) return true;
  return roles.some((r) => sameRole(r, memberRole));
}
