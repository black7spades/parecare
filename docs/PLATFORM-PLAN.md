# PareCare platform plan: streamlined data, integrated AI, wider scope

This document records an analysis of the codebase as it stands, what was
changed in the first implementation pass, and the plan for the passes that
follow. The goal: every piece of data is captured once, structured, and
available everywhere it is useful, including to the AI assistant, and the
product serves anyone coordinating care, not only families of ageing
parents.

## Where the codebase stands

The bones are good: a clean monorepo, per-profile access control enforced
in one middleware chain (`requireCareProfileAccess` → `blockViewerWrites` →
`auditTrail`), migrations for everything, and a shared medication
catalogue that already de-duplicates drugs across people. The problems are
where the same fact lives in two places, or where a structured fact is
stored as prose:

1. **Medications exist twice.** `care_plans.medications` is a JSONB blob
   from the original care plan; `medications` + `medication_catalogue` +
   `medication_administrations` are the real system. Migration 022 copied
   the blob across but the care plan page still reads and writes its own
   copy, so the two can drift.
2. **GP details exist twice.** `care_plans.gp_name/gp_practice/gp_phone`
   duplicate what `providers` (type `gp`) models properly.
3. **Emergency contacts are packed JSONB.** Name, relationship and phone
   are three data points stored in one JSONB array on the care plan,
   against the project's own one-column-per-data-point rule.
4. **Names were one field.** `full_name` packed title, first, middle,
   last and suffix into one string. Fixed in this pass (see below).
5. **The calendar is synthesised.** Events are reminders plus expanded
   medication schedule times. There is no first-class appointment (with a
   provider, a location, an outcome), so "appointments for Indigo" are
   just reminders with hopeful titles.
6. **Observations are prose.** A seizure is a care log entry with the
   type, duration and recovery packed into the body text. Nothing can
   chart seizure frequency or duration over time.
7. **The AI knew almost nothing.** The system prompt carried a first
   name, a phase and a role. It could not answer "what medications does
   Dad take" from the record. Fixed in this pass.
8. **The journey is hard-coded to ageing.** The six `current_phase`
   values (early concern → end of life) are baked into the DB enum, the
   checklist seeds and the UI. They make no sense for Stan managing his
   own autism and medications, or for Indigo.

## Done in this pass

### Structured names composing a display name

- Migration 026 adds `title`, `first_name`, `middle_name`, `last_name`
  and `suffix` to `care_profiles`, each its own column, and backfills
  them by splitting existing full names.
- `full_name` remains as the **composed display name**, recomputed by the
  API whenever any name part changes, so every existing consumer (lists,
  avatars, exports, audit summaries) keeps working unchanged.
- Create and edit forms capture each name part separately and preview the
  display name. Older clients sending only `full_name` still work; the
  API splits it into parts.

### The assistant knows the whole record, for one person only

- New `services/aiContext.ts` builds a context block from everything the
  platform knows about the open profile: person details, care plan
  (conditions, dietary, mobility, directive, GP, emergency contacts),
  active medications with schedules and remaining supply, the last 14
  days of the medication administration record, upcoming tasks, the care
  circle with roles and power of attorney, providers, open questions, 30
  days of care log, and document names (respecting per-role document
  visibility, exactly like the documents API).
- Scoping is structural: the context builder takes the care profile and
  the caller's resolved access from the same middleware the REST API
  uses. Invoked in Person01's session, the assistant is given Person01's
  record and an explicit instruction to discuss no one else.
- The system prompt now describes the real product scope: self-managed
  care, children, relatives, residents.

### The assistant does the logging grunt work

- The model can emit `parecare-action` JSON blocks alongside its reply.
  The server validates them (zod), strips them from the visible reply,
  executes them under the caller's permissions (viewers cannot write),
  and appends a plain confirmation line for each.
- Three actions: `log_event` (care log entry, e.g. a seizure observation
  with time), `record_medication` (a MAR entry: status, dose, notes;
  draws down supply exactly like the MAR endpoint; the dose/route/time
  verification rights stay false because a chat cannot verify them), and
  `add_task` (a reminder with due time and repeat).
- Every action writes to the audit log like any other change.

### The assistant is a widget on every screen

- `AssistantWidget` floats bottom-right in the app shell. It follows the
  route: inside a profile it chats about that person (one running
  conversation per person per browser session); outside any profile it
  says it can only discuss an open profile.
- The full-page "Ask PareCare" tab remains for long conversations and
  history.

### Scope copy

- Prompts, emails, README and project docs no longer say "ageing
  parents". Relationship options now include Myself, Son, Daughter,
  Partner, Client and Resident; a profile marked "Myself" reads as "Your
  own care" instead of "Your Myself".

## Next passes, in order

### Pass 2: one source of truth per fact

1. Drop `care_plans.medications`: point the care plan page and the
   emergency sheet at the `medications` table, then remove the column by
   migration. The emergency sheet and CSV export already have proper
   per-column data there.
2. Move GP into `providers`: migrate the three GP columns into a `gp`
   provider row per profile, teach the emergency sheet and dashboard
   summary to read providers, drop the columns.
3. Promote emergency contacts to a table (`emergency_contacts`: name,
   relationship, phone, sort order) with one column per data point, and
   an import/export descriptor like medications.

### Pass 3: first-class appointments

- New `appointments` table: title, provider reference, location, starts
  at, ends at, notes, outcome. The calendar merges appointments, task due
  times and medication schedule times; the ICS feed includes all three.
- Reminders go back to being tasks. The AI gains a `add_appointment`
  action.

### Pass 4: structured observations

- New `observation_types` (name, unit fields) and `observations` (type,
  occurred at, one column per typed value: duration in seconds, severity,
  free-text note). Seed with the common ones: seizure (type, duration),
  blood pressure, weight, temperature, pain, mood, food and fluid intake.
- Charts on the profile overview; the AI gains a `log_observation`
  action so "Indigo had a tonic-clonic seizure, about two minutes" lands
  as queryable data, not prose.

### Pass 5: journeys per kind of care, and organisations

- Replace the hard-coded phase enum with journey templates in the DB
  (ageing, self-managed, child with complex needs, residential), each
  with its own phases and checklist seeds; existing profiles map to the
  ageing template so nothing moves.
- Organisation accounts for facilities like an aged care home: an org
  owns profiles (residents), staff are members with facility roles, and
  the MAR gains shift handover and round reports. The professional tier
  already gates multi-family access; this makes it real.

### Pass 6: AI v2

- Provider-native tool calling for Anthropic/OpenAI/Gemini instead of
  the JSON-block protocol, with the same server-side executor.
- Streaming replies in the widget.
- Voice input in the widget (Web Speech API), so logging from a phone is
  hands-free: that is the "talk to PareCare and it does the logging"
  experience end to end.
- Retrieval for large records: a facility resident with years of MAR
  history will not fit a context block; switch the bulky sections to
  on-demand lookups via tools.

## Rules that keep this on track

- One fact, one column, one owner. Anything displayed in two places reads
  from the same table.
- The AI reads through the same permission model as the REST API, always
  scoped to a single profile, and writes only through validated actions
  that land in the audit log.
- Plain language everywhere; every clinical term ships with its
  explanation.
