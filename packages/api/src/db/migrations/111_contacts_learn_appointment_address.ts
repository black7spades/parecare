import type { Knex } from 'knex';

/**
 * Professionals filed in Contacts automatically from a referral or a booking
 * kept only their name, while the address typed for their appointment stayed
 * on the appointment. Fill in each such professional's empty address, and
 * empty map link, from their most recent appointment that has one. Nothing
 * already in Contacts is overwritten, and anyone sharing their practice's
 * address is left alone.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE providers p
       SET address_line1 = src.address_line1,
           address_line2 = src.address_line2,
           address_suburb = src.address_suburb,
           address_state = src.address_state,
           address_postcode = src.address_postcode,
           address_country = src.address_country,
           address = src.location
      FROM (
        SELECT DISTINCT ON (a.provider_id)
               a.provider_id, a.address_line1, a.address_line2, a.address_suburb,
               a.address_state, a.address_postcode, a.address_country, a.location
          FROM appointments a
         WHERE a.provider_id IS NOT NULL
           AND coalesce(a.address_line1, a.address_suburb, a.address_postcode) IS NOT NULL
         ORDER BY a.provider_id, a.updated_at DESC
      ) src
     WHERE src.provider_id = p.id
       AND coalesce(p.address_line1, p.address_line2, p.address_suburb, p.address_state, p.address_postcode, p.address_country) IS NULL
       AND NOT (p.practice_id IS NOT NULL AND coalesce(p.uses_practice_address, true))
  `);
  await knex.raw(`
    UPDATE providers p
       SET directions_link = src.directions_link
      FROM (
        SELECT DISTINCT ON (a.provider_id) a.provider_id, a.directions_link
          FROM appointments a
         WHERE a.provider_id IS NOT NULL AND a.directions_link IS NOT NULL
         ORDER BY a.provider_id, a.updated_at DESC
      ) src
     WHERE src.provider_id = p.id
       AND coalesce(trim(p.directions_link), '') = ''
  `);
}

export async function down(): Promise<void> {
  // Filled-in details are kept: they are the person's own data.
}
