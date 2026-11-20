import type { Knex } from 'knex';

/**
 * Urgent fixes that need somewhere to keep their state, or a tidy of data.
 *
 * 1. Care circle roles typed by hand ("Carer") and picked from the list
 *    ("carer") are one role. Existing roles, and the roles a document is
 *    shared with, move to the listed form, so nobody loses sight of a
 *    document because of a capital letter.
 * 2. Recording a death stops what was still running for that person. Open
 *    tasks are closed and future appointments cancelled, each marked as
 *    stopped by the death so that clearing the date by mistake brings them
 *    all back exactly as they were.
 * 3. Care homes and nursing homes filed as professionals move to
 *    Organisations, where people look for them.
 * 4. A care plan's standard review date is set once and kept, rather than
 *    moving a year out every time the plan is rebuilt. A reminder task is
 *    made ahead of it.
 */
const LISTED = ['family', 'friend', 'carer', 'organisation', 'legal', 'other'];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `UPDATE care_circle_members
        SET role = lower(trim(role))
      WHERE lower(trim(role)) = ANY(?) AND role <> lower(trim(role))`,
    [LISTED]
  );
  await knex.raw(`UPDATE care_circle_members SET role = 'legal' WHERE lower(trim(role)) = 'legal representative'`);
  await knex.raw(
    `UPDATE documents d
        SET visible_to_roles = (
          SELECT array_agg(DISTINCT CASE
                   WHEN lower(trim(r)) = ANY(?) THEN lower(trim(r))
                   WHEN lower(trim(r)) = 'legal representative' THEN 'legal'
                   ELSE trim(r) END)
            FROM unnest(d.visible_to_roles) AS r
        )
      WHERE d.visible_to_roles IS NOT NULL AND cardinality(d.visible_to_roles) > 0`,
    [LISTED]
  );

  // Care homes, nursing homes and the like were filed as professionals, so
  // they were missing from Organisations. File them where they belong.
  await knex.raw(
    `UPDATE providers SET kind = 'organisation'
      WHERE kind = 'person'
        AND name !~* '^(dr|prof|professor|mr|mrs|ms|miss|mx|sister)[.]{0,1} '
        AND (lower(trim(provider_type)) = ANY(?) OR name ~* '(aged care|nursing home|care home|hospice|retirement village)')`,
    [['aged care home', 'nursing home', 'care home', 'retirement village', 'group home', 'hospice', 'aged care service']]
  );

  await knex.schema.alterTable('reminders', (t) => {
    // When a recorded death closed this task. Cleared, with the task
    // reopened, if the date of death is removed.
    t.timestamp('stopped_by_death_at', { useTz: true }).nullable();
  });
  await knex.schema.alterTable('appointments', (t) => {
    // The status a future appointment had before a recorded death cancelled
    // it, so removing the date puts it back.
    t.string('status_before_death', 20).nullable();
  });
  await knex.schema.alterTable('care_profiles', (t) => {
    // The next standard care plan review, set once and kept.
    t.date('care_plan_review_due_on').nullable();
    // The reminder task made ahead of that review.
    t.uuid('care_plan_review_task_id').nullable().references('id').inTable('reminders').onDelete('SET NULL');
  });
  // Plans already built keep the review date their latest version shows,
  // so the first rebuild after this does not move it a year out.
  await knex.raw(`
    UPDATE care_profiles cp
       SET care_plan_review_due_on = sub.due::date
      FROM (
        SELECT DISTINCT ON (v.care_profile_id) v.care_profile_id,
               (SELECT e->'fields'->>'due_by'
                  FROM jsonb_array_elements(
                         CASE WHEN jsonb_typeof(v.content->'sections'->'review') = 'array'
                              THEN v.content->'sections'->'review' ELSE '[]'::jsonb END) e
                 WHERE e->>'key' = 'review:standard'
                 LIMIT 1) AS due
          FROM care_plan_versions v
         ORDER BY v.care_profile_id, v.version DESC
      ) sub
     WHERE sub.care_profile_id = cp.id
       AND sub.due ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('care_plan_review_task_id');
    t.dropColumn('care_plan_review_due_on');
  });
  await knex.schema.alterTable('appointments', (t) => {
    t.dropColumn('status_before_death');
  });
  await knex.schema.alterTable('reminders', (t) => {
    t.dropColumn('stopped_by_death_at');
  });
}
