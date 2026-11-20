import type { Knex } from 'knex';

/**
 * Book anything from anywhere.
 *
 * 1. A task knows what it is for (a condition), can be given to the account
 *    holder as well as a circle member, can be due any time on a day rather
 *    than at a set time, can be joined into another task for the same
 *    booking, and remembers which of its details were worked out rather than
 *    chosen. Tasks can now repeat every year.
 * 2. An appointment can have no set time, preparation with its own
 *    night-before reminder, a video call link, an interpreter, a repeat
 *    group, the people going with it, and documents to bring.
 * 3. Task notes move into the notes every record shares, so a task has one
 *    set of notes, not two.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reminders', (t) => {
    t.uuid('medical_condition_id').nullable().references('id').inTable('medical_conditions').onDelete('SET NULL');
    t.uuid('assigned_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.boolean('all_day').notNullable().defaultTo(false);
    t.uuid('merged_into_id').nullable().references('id').inTable('reminders').onDelete('SET NULL');
    t.specificType('inferred_fields', 'text[]').notNullable().defaultTo('{}');
    t.index(['medical_condition_id']);
    t.index(['assigned_account_id']);
    t.index(['merged_into_id']);
  });
  await knex.raw(
    'ALTER TABLE reminders ADD CONSTRAINT reminders_one_assignee CHECK (assigned_to IS NULL OR assigned_account_id IS NULL)'
  );
  await knex.raw('ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_reminder_type_check');
  await knex.raw(
    "ALTER TABLE reminders ADD CONSTRAINT reminders_reminder_type_check CHECK (reminder_type IN ('once', 'daily', 'weekly', 'monthly', 'yearly'))"
  );
  // The repeat rule is the truth from now on; fill it for repeating tasks.
  await knex.raw(`
    UPDATE reminders SET rrule = CASE reminder_type
      WHEN 'daily' THEN 'FREQ=DAILY'
      WHEN 'weekly' THEN 'FREQ=WEEKLY'
      WHEN 'monthly' THEN 'FREQ=MONTHLY'
      ELSE NULL END
    WHERE reminder_type <> 'once' AND (rrule IS NULL OR rrule = '')
  `);

  await knex.schema.createTable('appointment_series', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.string('rrule', 255).notNullable();
    t.date('repeat_until').nullable();
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['care_profile_id']);
  });

  await knex.schema.alterTable('appointments', (t) => {
    t.boolean('all_day').notNullable().defaultTo(false);
    t.text('preparation').nullable();
    t.uuid('preparation_task_id').nullable().references('id').inTable('reminders').onDelete('SET NULL');
    t.text('telehealth_link').nullable();
    t.boolean('interpreter_needed').notNullable().defaultTo(false);
    t.string('interpreter_language', 100).nullable();
    t.uuid('series_id').nullable().references('id').inTable('appointment_series').onDelete('SET NULL');
    t.index(['preparation_task_id']);
    t.index(['series_id']);
  });

  await knex.schema.createTable('appointment_attendees', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('appointment_id').notNullable().references('id').inTable('appointments').onDelete('CASCADE');
    t.uuid('circle_member_id').nullable().references('id').inTable('care_circle_members').onDelete('CASCADE');
    t.uuid('account_id').nullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.boolean('is_driver').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['appointment_id', 'circle_member_id']);
    t.unique(['appointment_id', 'account_id']);
    t.index(['circle_member_id']);
    t.index(['account_id']);
  });
  await knex.raw(
    'ALTER TABLE appointment_attendees ADD CONSTRAINT appointment_attendees_one_ref CHECK ((circle_member_id IS NULL) <> (account_id IS NULL))'
  );

  await knex.schema.alterTable('document_links', (t) => {
    t.boolean('bring').notNullable().defaultTo(false);
  });

  // One set of notes per record: task notes join the shared notes.
  if (await knex.schema.hasTable('task_notes')) {
    await knex.raw(`
      INSERT INTO record_notes (care_profile_id, entity_type, entity_id, body, author_account_id, created_at, updated_at)
      SELECT r.care_profile_id, 'reminders', n.reminder_id, n.content, n.account_id, n.created_at, n.updated_at
        FROM task_notes n JOIN reminders r ON r.id = n.reminder_id
    `);
    await knex.schema.dropTable('task_notes');
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.createTable('task_notes', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('reminder_id').notNullable().references('id').inTable('reminders').onDelete('CASCADE');
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.text('content').notNullable();
    t.timestamps(true, true);
    t.index(['reminder_id']);
  });
  await knex.raw(`
    INSERT INTO task_notes (reminder_id, account_id, content, created_at, updated_at)
    SELECT n.entity_id, n.author_account_id, n.body, n.created_at, n.updated_at
      FROM record_notes n JOIN reminders r ON r.id = n.entity_id
     WHERE n.entity_type = 'reminders' AND n.author_account_id IS NOT NULL
  `);
  await knex('record_notes').where({ entity_type: 'reminders' }).delete();

  await knex.schema.alterTable('document_links', (t) => {
    t.dropColumn('bring');
  });
  await knex.schema.dropTableIfExists('appointment_attendees');
  await knex.schema.alterTable('appointments', (t) => {
    t.dropColumn('series_id');
    t.dropColumn('interpreter_language');
    t.dropColumn('interpreter_needed');
    t.dropColumn('telehealth_link');
    t.dropColumn('preparation_task_id');
    t.dropColumn('preparation');
    t.dropColumn('all_day');
  });
  await knex.schema.dropTableIfExists('appointment_series');

  await knex.raw("UPDATE reminders SET reminder_type = 'monthly', rrule = 'FREQ=MONTHLY;INTERVAL=12' WHERE reminder_type = 'yearly'");
  await knex.raw('ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_reminder_type_check');
  await knex.raw(
    "ALTER TABLE reminders ADD CONSTRAINT reminders_reminder_type_check CHECK (reminder_type IN ('once', 'daily', 'weekly', 'monthly'))"
  );
  await knex.raw('ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_one_assignee');
  await knex.schema.alterTable('reminders', (t) => {
    t.dropColumn('inferred_fields');
    t.dropColumn('merged_into_id');
    t.dropColumn('all_day');
    t.dropColumn('assigned_account_id');
    t.dropColumn('medical_condition_id');
  });
}
