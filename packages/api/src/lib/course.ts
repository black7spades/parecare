/**
 * A course of medicine (antibiotics, say) ends on its last day. After that
 * its doses are no longer due, and the medicine asks whether to stop it
 * rather than stopping on its own. This is the test every dose and supply
 * alert applies to an active medicine, for the alias `m`.
 */
// "Today" is the day where the account holder lives, not the server's day.
export const COURSE_RUNNING_SQL = `(m.course_ends_on IS NULL OR m.course_ends_on >= (now() AT TIME ZONE COALESCE((
  SELECT tz.name FROM care_profiles cp
    JOIN accounts a ON a.id = cp.account_id
    JOIN pg_timezone_names tz ON tz.name = a.timezone
   WHERE cp.id = m.care_profile_id LIMIT 1), 'UTC'))::date)`;
