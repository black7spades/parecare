/**
 * The kind a contact counts as when picking a main one: a pharmacy and a
 * pharmacist are one kind, so "their pharmacy" is always one place.
 */
export const kindSql = (col: string) => `(CASE WHEN lower(${col}) IN ('pharmacy', 'pharmacist') THEN 'pharmacy' ELSE lower(${col}) END)`;

/**
 * Whether a linked contact is the person's main one of its kind: marked
 * main, or, when none of that kind is, the first linked. Never one they no
 * longer see. SQL over a care_profile_providers alias and a providers alias.
 */
export const effectiveMainSql = (cpp = 'cpp', p = 'p') => `(${cpp}.id IS NOT NULL AND ${cpp}.ended_on IS NULL AND (${cpp}.is_main OR NOT EXISTS (
  SELECT 1 FROM care_profile_providers c2 JOIN providers p2 ON p2.id = c2.provider_id
   WHERE c2.care_profile_id = ${cpp}.care_profile_id AND c2.ended_on IS NULL AND c2.id <> ${cpp}.id
     AND ${kindSql('p2.provider_type')} = ${kindSql(`${p}.provider_type`)}
     AND (c2.is_main OR (c2.created_at, c2.id) < (${cpp}.created_at, ${cpp}.id)))))`;
