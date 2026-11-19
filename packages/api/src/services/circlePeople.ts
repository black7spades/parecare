import { z } from 'zod';
import { db } from '../config/database';

/**
 * People in someone's care circle who were added rather than invited: a
 * neighbour, a friend who drives, a support worker. They have no account and
 * no invitation, so no access check ever lets them in; they are there so
 * everyone knows who they are and how to reach them. Shared by the Care
 * circle page and by Pare, so both add and change them the same way.
 */

export const circlePersonSchema = z.object({
  display_name: z.string().trim().min(1).max(255),
  role: z.string().trim().min(1).max(100).default('other'),
  relationship: z.string().trim().max(100).optional().nullable(),
  role_description: z.string().trim().max(2000).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().email().max(255).optional().nullable().or(z.literal('').transform(() => null)),
  poa_type: z.string().max(50).optional().nullable(),
  poa_activated: z.boolean().optional(),
});
export type CirclePersonInput = z.infer<typeof circlePersonSchema>;

/** Added by name, no login: no account and no invitation behind the row. */
export const isAddedPerson = (m: { account_id: string | null; invitation_id: string | null }) =>
  !m.account_id && !m.invitation_id;

const blankToNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export async function addCirclePerson(profileId: string, input: CirclePersonInput) {
  const [member] = await db('care_circle_members')
    .insert({
      care_profile_id: profileId,
      account_id: null,
      invitation_id: null,
      invited_email: null,
      invite_accepted: false,
      display_name: input.display_name.trim(),
      role: input.role || 'other',
      relationship: blankToNull(input.relationship),
      role_description: blankToNull(input.role_description),
      phone: blankToNull(input.phone),
      email: blankToNull(input.email),
      poa_type: blankToNull(input.poa_type),
      poa_activated: input.poa_type ? input.poa_activated ?? false : false,
      // Nobody logs in as them, so the lowest access is recorded.
      permission: 'viewer',
      can_edit_profile: false,
    })
    .returning('*');
  return member as Record<string, unknown> & { id: string; display_name: string };
}

/** Find someone in the circle by name, closest match first. */
export async function findCircleMemberByName(profileId: string, name: string) {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  const rows = (await db('care_circle_members').where({ care_profile_id: profileId })) as Array<
    Record<string, unknown> & { id: string; display_name: string; account_id: string | null; invitation_id: string | null }
  >;
  return (
    rows.find((r) => r.display_name.toLowerCase() === needle) ??
    rows.find((r) => r.display_name.toLowerCase().includes(needle) || needle.includes(r.display_name.toLowerCase()))
  );
}
