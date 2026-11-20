import type { Knex } from 'knex';
import { db } from '../config/database';

type Conn = Knex | Knex.Transaction;

/**
 * Allergies: what they must not be given, what happens if they are, and how
 * bad that is. "No known allergies" is a checked fact with who checked and
 * when; adding an allergy clears it. The Allergies page and Pare both write
 * through here.
 */
export const ALLERGY_SEVERITIES = ['mild', 'moderate', 'severe', 'life_threatening'] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];

export const SEVERITY_LABELS: Record<AllergySeverity, string> = {
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
  life_threatening: 'Life threatening',
};

/** A severity from a code or plain words ("life threatening", "Severe"). */
export function severityFrom(text: string | null | undefined): AllergySeverity | null {
  const t = String(text ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!t) return null;
  if ((ALLERGY_SEVERITIES as readonly string[]).includes(t)) return t as AllergySeverity;
  if (/life|anaphyla|fatal/.test(t)) return 'life_threatening';
  if (/sever|serious/.test(t)) return 'severe';
  if (/moder/.test(t)) return 'moderate';
  if (/mild|minor|slight/.test(t)) return 'mild';
  return null;
}

/** Anaphylaxis is always life threatening, so it is never left unsaid. */
const worked = (severity: AllergySeverity | null | undefined, reaction: string | null | undefined): AllergySeverity | null =>
  severity ?? (/anaphyla/i.test(reaction ?? '') ? 'life_threatening' : null);

export async function addAllergy(
  conn: Conn,
  profileId: string,
  input: { substance: string; reaction?: string | null; severity?: AllergySeverity | null; sort_order?: number }
): Promise<Record<string, unknown>> {
  const [row] = await conn('allergies')
    .insert({
      care_profile_id: profileId,
      substance: input.substance.trim(),
      reaction: input.reaction?.trim() || null,
      severity: worked(input.severity, input.reaction),
      ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
    })
    .returning('*');
  // An allergy on file means "no known allergies" is no longer true.
  await conn('care_profiles').where({ id: profileId }).update({ no_known_allergies_on: null, no_known_allergies_by: null });
  return row as Record<string, unknown>;
}

/** Record that they have no known allergies, checked today by this person. */
export async function confirmNoAllergies(conn: Conn, profileId: string, accountId: string): Promise<{ ok: true } | { ok: false; count: number }> {
  const count = Number(((await conn('allergies').where({ care_profile_id: profileId }).count('* as n').first()) as { n: string | number } | undefined)?.n ?? 0);
  if (count > 0) return { ok: false, count };
  const today = new Date().toISOString().slice(0, 10);
  await conn('care_profiles').where({ id: profileId }).update({ no_known_allergies_on: today, no_known_allergies_by: accountId });
  return { ok: true };
}

/** Who checked there are no known allergies, and when; null when nobody has. */
export async function noKnownAllergies(profileId: string, conn: Conn = db): Promise<{ on: string; by_name: string | null } | null> {
  const row = (await conn('care_profiles as cp')
    .leftJoin('accounts as a', 'a.id', 'cp.no_known_allergies_by')
    .where('cp.id', profileId)
    .first('cp.no_known_allergies_on', 'a.display_name')) as { no_known_allergies_on: string | Date | null; display_name: string | null } | undefined;
  if (!row?.no_known_allergies_on) return null;
  const on = row.no_known_allergies_on instanceof Date ? row.no_known_allergies_on.toISOString().slice(0, 10) : String(row.no_known_allergies_on).slice(0, 10);
  return { on, by_name: row.display_name ?? null };
}
