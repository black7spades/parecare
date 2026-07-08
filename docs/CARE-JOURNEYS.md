# Care Journeys: from conception to death, and beyond

This document proposes the Care Journeys system: a library of journey
templates covering every stage of a human life, a composition model that
lets administrators build custom journeys or cherry-pick phases from
existing ones, and a per-person journey instance model that makes each
person's journey genuinely theirs. It replaces the single hard-coded
ageing journey (the `current_phase` enum on `care_profiles`) that
`PLATFORM-PLAN.md` already flagged as the thing to fix in Pass 5.

## What we are trying to achieve

Today PareCare is at its best when someone is already in trouble: an
ageing parent declining, a child with complex needs. The journey is one
fixed corridor, early concern to end of life, and if your situation is
not "ageing relative" the corridor is meaningless. That makes the app a
nice to have: you arrive in a crisis, and when the crisis passes, you
leave.

Care Journeys make PareCare the place a life is looked after, from before
birth to after death:

- **A journey is a situation, not a diagnosis.** "Leukaemia" is a
  condition. "A teenager going through cancer treatment while trying to
  stay a teenager" is a journey. Templates are written around what the
  circle actually has to do next, in plain language.
- **Everyone has a journey, including the healthy.** A 35-year-old smoker
  with no dependants has a preventive health journey with real phases and
  real tasks. PareCare stops being a crisis tool and becomes a lifelong
  companion. People who arrive for a pregnancy stay for the newborn, the
  school years, their own midlife health, their parents' later life, and
  eventually their own. That continuity is the moat: the app that already
  holds forty years of your family's care record is indispensable.
- **Journeys run concurrently.** Clair's leukaemia treatment does not
  pause her adolescence. She can be on "Serious illness treatment" and
  "Getting ready for adulthood" at the same time, because both are true.
- **Journeys hand over to each other.** Treatment forks into recovery or
  palliative care. Ageing at home hands over to residential care. A
  pregnancy hands over to a newborn journey, sometimes on a brand new
  care profile. The system models these handovers instead of pretending
  one linear corridor fits every life.
- **Templates propose, people decide.** Life stage, derived from date of
  birth, drives *suggestions* only. Any journey can be applied to anyone,
  edited per person, or built from scratch. History is never rewritten:
  a person's journey is a copy, not a live reference to the template.

### Two people, two very different journeys

**Clair, 15, terminally ill with leukaemia.** Her profile sits in the
Teenage years life stage. Her circle enrolled her in **Serious illness
treatment** at diagnosis: Diagnosis and staging, Treatment rounds, Living
during treatment, Response review. At the response review the news was
bad, and the journey's built-in handover offered two branches: "Recovery
and monitoring" or **Living with a terminal illness**. Her family took
the second, which brought phases like Understanding the news, Choices and
priorities, Living fully, and Comfort first, with checklist seeds about
advance care planning written for a minor, palliative team introductions,
school and friends staying in the picture, and starting a Memory Book.
Alongside it, a cherry-picked slice of **Getting ready for adulthood**
stays active, because turning 16 still matters to her. Her dashboard
shows both journeys, each with its own current phase, one set of tasks,
one shared record.

**Ashe, 35, no kids, smokes a pack a day.** Same app, entirely different
journey. Ashe self-manages a profile in the Adulthood life stage,
enrolled in **Preventive health and risk reduction**: Where am I now,
My risks and my plan, Making the change, Holding the line, Yearly review.
The checklist seeds are a baseline GP check, blood pressure and
cholesterol numbers logged as observations, a quit-smoking plan with a
quit date, lung health check eligibility, and a recurring yearly review.
No crisis, no circle of ten people, just one person and an app that keeps
them honest. If Ashe later gets a COPD diagnosis, the journey hands over
to **Managing a long-term condition** and the years of logged baseline
data come along.

The same platform serves both because journeys, not the schema, carry
the shape of each situation.

## Life stages

Life stages organise the template library and drive journey suggestions,
never restrictions. A person's stages are derived from their date of
birth, or due date for a baby not yet born.

Life stages are **data, not code**. They live in a `life_stages` table
that anyone with admin rights can edit: rename a stage, change its age
boundaries, reorder the list, retire a stage, or add entirely new ones.
A children's hospice deployment might replace the default eight with
stages that match its clinical pathways; an aged care operator might
split Later life into finer bands. The eight below are the seeded
defaults, ordinary rows like the seeded rights templates, not a fixed
vocabulary.

| Life stage | Ages |
|---|---|
| Pregnancy and birth | conception to birth |
| Baby and toddler years | birth to 4 |
| Childhood | 5 to 12 |
| Teenage years | 13 to 17 |
| Young adulthood | 18 to 29 |
| Adulthood | 30 to 59 |
| Later life | 60 and over |
| End of life and beyond | any age |

Rules for editable stages:

- **Overlaps are allowed and useful.** A stage with no age bounds, like
  End of life and beyond, applies to everyone; a person whose age falls
  in two stages sees the suggestions of both, merged. There is no
  requirement that stages tile the lifespan without gaps.
- **Editing a stage never touches anyone's journeys.** Stages only
  select which templates are suggested; enrolled journeys are copies and
  carry no stage reference.
- **A stage with templates assigned cannot be deleted**, only retired
  from suggestions or edited; deleting requires reassigning or
  unassigning its templates first, so no template silently loses its
  place in the library.

Notes:

- **Pregnancy and birth** requires a small addition: `care_profiles`
  gains a nullable `due_date` column so an expected baby can have a
  profile before birth. When the baby arrives, `date_of_birth` is set and
  the pregnancy journey hands over to a newborn journey on the same
  profile. The expecting parent can also carry the pregnancy journey on
  their own profile instead; both patterns work.
- **End of life and beyond** is a cross-cutting stage: its journeys are
  suggested at any age when relevant, and the "beyond" is deliberate.
  A profile does not end at death. The after-death journey carries the
  practical work (funeral, estate, paperwork) and the Memory Book keeps
  the person present for the circle.
- A birthday that crosses a stage boundary triggers a gentle notification
  to the circle: "Indigo turns 13 next month. Review the journeys
  suggested for the teenage years." Nothing changes automatically.

## The default journey catalogue

Six defaults per life stage, 48 templates in total. Every journey name
and phase name below is UI copy: plain language, no parentheses, no
jargon, no em dashes. Each phase ships with 4 to 8 checklist seeds in the
seed file, written the way the existing phase checklists are written,
with two fully worked examples at the end of this section.

### Pregnancy and birth

1. **Trying for a baby** — Getting ready, Trying, Fertility help,
   Pregnancy confirmed. Preconception health, cycle tracking as
   observations, when to seek help, specialist referrals.
2. **Expecting a baby** — First trimester, Second trimester, Third
   trimester, Birth, First weeks home. The routine pregnancy: scans,
   screening choices, birth plan, hospital bag, registering the birth.
3. **A pregnancy that needs extra care** — Extra care identified,
   Specialist care plan, Close monitoring, Planning the birth, Birth and
   recovery. For pregnancies flagged high risk.
4. **Expecting a baby with a diagnosed condition** — The diagnosis,
   Learning and deciding, Building the specialist team, Planning the
   birth, Birth and intensive care. Antenatal diagnosis support.
5. **Losing a pregnancy** — Immediate care, Physical recovery, Grieving,
   Thinking about what comes next. Written with care; every task
   optional, nothing presumptuous.
6. **Becoming a parent through surrogacy or adoption** — Preparation and
   approvals, Matching and waiting, Getting the home ready, Arrival,
   Settling in as a family.

### Baby and toddler years

1. **Newborn and the first year** — First weeks, Feeding and sleep,
   Immunisations and checks, Watching milestones, First birthday review.
   The default handover target from every pregnancy journey.
2. **A premature or medically fragile baby coming home** — Planning the
   trip home, First weeks at home, Equipment and follow up appointments,
   Growing stronger, Stepping down support.
3. **Something to watch in early development** — Something to watch,
   Getting assessed, Understanding the diagnosis, Early intervention
   underway, Review and adjust. Speech delay, autism assessment, motor
   concerns; National Disability Insurance Scheme early childhood
   pathway seeds for Australian deployments.
4. **A young child with complex medical needs** — Building the team,
   Daily routine in place, Therapy blocks, Hospital stays, Plan reviews.
   Deliberately cyclical: the last three phases repeat.
5. **Feeding, growth and sleep support** — Naming the problem, Getting
   help, Trying the plan, Reviewing progress.
6. **Starting childcare with additional needs** — Choosing the setting,
   Preparing the handover, Settling in, First term review.

### Childhood

1. **Starting school with additional needs** — Choosing the school,
   Transition planning, First term, Support plan review, Each new year.
2. **Managing a long-term condition** — The new diagnosis, Learning the
   ropes, A stable routine, School and activities covered, Growing
   independence. Asthma, diabetes, epilepsy, allergies.
3. **Support for a neurodivergent child** — Understanding the profile,
   Therapy and supports in place, School partnership, Plan reviews,
   Preparing for high school.
4. **Serious illness treatment in childhood** — Diagnosis and staging,
   Treatment rounds, Living during treatment, Response review, Recovery
   and monitoring. Hands over to Living with a terminal illness when the
   news is bad, exactly as the teenage version does.
5. **Mental health and wellbeing support for a child** — Noticing,
   Getting assessed, Support underway, Review and adjust.
6. **Recovery from injury or major surgery** — The event, In hospital,
   Coming home, Rehabilitation, Back to full strength.

### Teenage years

1. **Teen mental health support** — Noticing and talking, Getting help,
   Support underway, Staying steady, Standing down support.
2. **Taking over your own condition** — Understanding my condition,
   Sharing the load, Leading my own care, Moving to adult services. The
   handover of self-management from parents to the teenager, ending in
   the transfer from paediatric to adult health services.
3. **Serious illness treatment** — Diagnosis and staging, Treatment
   rounds, Living during treatment, Response review, Recovery and
   monitoring. Clair's journey. The response review phase carries the
   fork: continue, another round, or hand over to Living with a terminal
   illness.
4. **Disability support through the teenage years** — Reviewing supports
   for the teen years, Body and identity changes, School transitions,
   Building independence, Preparing for adult supports.
5. **Getting ready for adulthood** — Understanding what changes at 18,
   Decision making support, Money and documents, Adult health services,
   Launch. Guardianship and supported decision making in plain language.
6. **Recovery support** — Naming the problem, Finding the right help,
   Treatment underway, Rebuilding routines, Staying well. Eating
   disorders and substance use, written without judgement.

### Young adulthood

1. **Owning my own health** — My baseline, My general practitioner and my
   records, Screening and immunisations up to date, My habits, Yearly
   check in. The first journey most self-managed profiles enrol in.
2. **Living independently with disability** — Planning the move, Setting
   up supports, Settling in, Running my own supports, Plan reviews.
3. **Mental health recovery** — Reaching out, Finding the right support,
   Treatment underway, Recovery rhythm, Staying well.
4. **A new long-term diagnosis** — Hearing the news, Learning the
   condition, Building the routine, Condition under control, Yearly
   review. The adult onset counterpart of the childhood journey.
5. **Rehabilitation after serious injury** — The event, In hospital,
   Coming home, Rehabilitation, New normal.
6. **Recovery from addiction** — Deciding to change, Detox and
   stabilising, Treatment underway, Rebuilding, Staying well.

### Adulthood

1. **Preventive health and risk reduction** — Where am I now, My risks
   and my plan, Making the change, Holding the line, Yearly review.
   Ashe's journey: baseline checks, quit plans, screening schedules.
2. **Managing a long-term condition** — The new diagnosis, Learning the
   condition, Building the routine, Condition under control, Yearly
   review.
3. **Cancer and serious illness treatment** — Diagnosis and staging,
   Treatment decisions, Treatment rounds, Living during treatment,
   Response review, Recovery and monitoring. Same fork to Living with a
   terminal illness.
4. **Mental health support** — Reaching out, Getting assessed, Support
   underway, Staying steady, Standing down support.
5. **Looking after the carer** — Naming the load, Respite and backup,
   My own health checks, Sharing the load, Regular review. For the
   person whose main health risk is the caring they do for everyone
   else. PareCare knows who the organisers are; this journey is offered
   to them.
6. **Surgery and rehabilitation** — Preparing for surgery, In hospital,
   Coming home, Rehabilitation, Recovered.

### Later life

1. **Ageing well and staying independent** — My baseline, Home and
   habits, Plans and paperwork in order, Staying connected, Yearly
   review. Proactive: wills, power of attorney and advance care planning
   land here, before any crisis.
2. **Memory concerns and dementia support** — First concerns, Assessment
   and diagnosis, Living well with dementia, Increasing support, Time to
   decide what is next. Hands over to residential care or palliative
   journeys.
3. **More help at home to residential care** — Early concern, Home with
   support, Increased dependency, Moving to residential care, Life in
   residential care, End of life. This is the existing built-in journey,
   preserved exactly, and every existing profile is enrolled in it by
   the migration.
4. **Long-term conditions in later life** — The new diagnosis, Learning
   the condition, A routine that works, More support needed, Regular
   reviews. Heart failure, lung disease, Parkinson's.
5. **Falls, frailty and getting home from hospital** — The fall or the
   admission, In hospital, Planning the trip home, First month home,
   Stronger and steadier.
6. **Life in residential care** — Choosing the home, Admission,
   Settling in, Ongoing care and reviews. The resident journey for
   facilities; pairs with the organisation accounts planned in Pass 5 of
   the platform plan.

### End of life and beyond

1. **Planning ahead while well** — Why plan now, My wishes written down,
   The legal documents, Telling the people who matter, Reviewing every
   few years. Suggested from young adulthood onward; the earlier this is
   done, the kinder every later journey becomes.
2. **Living with a terminal illness** — Understanding the news, Choices
   and priorities, Living fully, Comfort first. The journey Clair's
   family chose. Living fully seeds Memory Book prompts, trips and
   milestones worth planning; Comfort first hands over to a palliative
   journey.
3. **Palliative care at home** — Setting up care at home, The team and
   the plan, Day to day comfort, When things change.
4. **Palliative care in a hospice or hospital** — Choosing the place,
   Moving in, Day to day comfort, When things change.
5. **The final days** — Keeping them comfortable, Who should be here,
   Saying goodbye, The death itself. Short, gentle, practical. Every
   task optional.
6. **After a death** — The first days, The funeral and the formalities,
   The estate and the paperwork, Grief support, Remembering. The profile
   is not archived by this journey; the Memory Book becomes its heart.

### Worked example: checklist seeds for one phase of each demonstration journey

**Living with a terminal illness → Choices and priorities**, as Clair's
circle sees it:

- *Talk about what matters most now.* There is no right answer. Some
  people want every treatment, some want time and comfort. Write down
  what Clair says, in her words.
- *Meet the palliative care team.* Palliative care means comfort and
  quality of life, not giving up. Ask for a team experienced with young
  people.
- *Write the advance care plan.* For a person under 18 this is a family
  and treating team conversation recorded in writing. Store it in
  Documents so everyone can find it.
- *Decide together about school.* Full days, some days, or friends
  visiting instead. Whatever keeps her connected on her terms.
- *Ask about clinical trials and second opinions.* If the family wants
  them, now is the moment. The treating team can refer.
- *Start the Memory Book.* Photos, voice notes, messages from friends.
  It belongs to Clair while she is here and to her family after.

**Preventive health and risk reduction → Making the change**, as Ashe
sees it:

- *Set a quit date within the next two weeks.* A date makes it real.
  Add it as a task so PareCare reminds you.
- *Book a quit support appointment.* Your general practitioner can
  prescribe support that doubles your odds. Quitline 13 7848 is free.
- *Choose your nicotine replacement or medication.* Patches, gum,
  spray or prescription tablets. Pick before the quit date, not on it.
- *Log your smoke-free days.* Tick each day in the tracker. The record
  is the motivation.
- *Plan for the three hardest moments.* Morning coffee, after meals,
  stress. Write down what you will do instead for each one.
- *Book the follow up for four weeks after quit day.* Most relapses
  happen in the first month. A booked appointment is an anchor.

## Data model

Everything follows the one-fact-one-column rule. Two layers: the
**template library** (what admins curate) and **journey instances**
(what a person is actually on). Enrolment copies template content into
the instance tables, so editing a template never rewrites anyone's
history, and personalising one person's journey never touches the
template.

### Life stages

- `life_stages` — `id`, `name`, `description`, `min_age_years`
  (nullable), `max_age_years` (nullable), `applies_before_birth`
  (boolean, true only for pregnancy-type stages matched by due date),
  `sort_order`, `retired` (boolean, hides the stage from suggestions
  without breaking template assignments), `is_system` (seeded default),
  `created_by_account_id`, timestamps. Null age bounds mean unbounded on
  that side; both null means the stage applies at any age. One fact per
  column: the age range is two columns, never a packed string.

### Template library

- `journey_templates` — `id`, `name`, `description`, `kind`
  (`life_stage`, `condition`, `event`, `end_of_life`), `is_system`
  (seeded defaults), `status` (`draft`, `published`, `archived`),
  `source_template_id` (nullable, clone lineage), `created_by_account_id`,
  timestamps. Archiving hides a template from new enrolments; existing
  instances are copies and are unaffected.
- `journey_template_life_stages` — `template_id`, `life_stage_id`
  (references `life_stages`). One row per stage the template is
  suggested for; cross-cutting templates have several rows. A template
  with no rows is still enrollable from the full library; it simply
  appears in no stage's suggestions.
- `journey_template_phases` — `id`, `template_id`, `name`, `description`,
  `sort_order`.
- `journey_template_tasks` — `id`, `template_phase_id`, `title`,
  `description`, `sort_order`. The checklist seeds; replaces the
  hard-coded `PHASE_CHECKLISTS` constant.
- `journey_template_handovers` — `id`, `from_template_id`,
  `from_phase_id` (nullable, meaning any phase), `to_template_id`,
  `label`. Powers the fork at Clair's response review: the UI offers the
  labelled handovers when a phase completes.

### Journey instances

- `care_journeys` — `id`, `care_profile_id`, `template_id` (nullable:
  bespoke journeys have none), `name`, `status` (`active`, `paused`,
  `completed`, `handed_over`), `started_at`, `ended_at`,
  `handed_over_to_journey_id` (nullable), `created_by_account_id`,
  timestamps. A profile can hold several active journeys.
- `care_journey_phases` — `id`, `care_journey_id`, `name`, `description`,
  `sort_order`, `state` (`upcoming`, `current`, `locked`), `entered_at`,
  `locked_at`, `locked_by`. This is `care_phase_history` generalised:
  the existing lock-when-you-move-on semantics carry over unchanged.
- `checklist_items` gains `care_journey_phase_id`. During migration the
  legacy `phase` string is backfilled into real phase rows; once the UI
  reads only the new column, `phase` is dropped.

### What goes, what stays

- `care_profiles.current_phase` (the enum) is replaced by the phases of
  the person's active journeys. During transition the API keeps the
  column synced from the primary journey so old clients keep working;
  a final migration drops it.
- `care_phase_history` rows migrate into `care_journey_phases` under the
  migrated ageing journey, preserving `entered_at`, `locked_at` and
  `locked_by` exactly.
- `care_profiles` gains `due_date` (nullable date) for expected babies.

## Who can do what

- **Super admin** curates the system catalogue: edit, archive and add
  system templates and system life stages, and everything below.
- **Admin** manages the template library and the life stages for their
  deployment. Templates: create **brand-new library items from
  scratch** with their own phases and task seeds, assign them to any
  set of life stages, clone any published template, and **compose** new
  templates in the journey builder by cherry-picking phases, with their
  task seeds, from any mix of published templates, then reordering and
  editing them. New, composed and cloned templates are first-class
  library items: they appear in stage suggestions, can be handover
  targets, and can themselves be cloned and composed from. Composed and
  cloned templates record their lineage in `source_template_id`; brand
  new ones have none. Life stages: rename, reorder, change age
  boundaries, retire, and add new stages, with template assignments
  updating live in the suggestion lists.
- **Care circle organisers** enrol a person in journeys, choose from the
  suggested list or the full library, and personalise the enrolled copy:
  rename, add, remove and reorder phases and tasks for that person only.
  This is how Clair keeps a slice of Getting ready for adulthood inside
  her situation.
- **Contributors and viewers** see journeys and work the checklists under
  the existing care circle permission rules; `blockViewerWrites` and the
  audit trail apply to journey writes like any other write.

Self-hosted deployments get the whole catalogue and full template
editing on every tier. In SaaS mode the free tier includes system
templates and personalisation; custom template authoring sits with the
professional tier, alongside the organisation features it pairs with.

## Product surfaces

- **Journey tab on the care profile** replaces the current phase strip:
  each active journey renders as its own progress line with locked past
  phases, the current phase, its checklist, and upcoming phases.
  Completing a final phase surfaces the template's handovers as clearly
  labelled choices, never automatic.
- **Enrolment flow** on profile creation and from the journey tab:
  suggested journeys for the person's life stage first, the full library
  behind a search. Preview shows phases and task counts before enrolling.
- **Journey builder** in the admin panel: two-pane compose view, library
  on the left, the new template on the right, drag phases across,
  reorder, edit inline, publish. Starting from a blank template creates
  a brand-new library item; a life stage picker on the template assigns
  it to any set of stages.
- **Life stage manager** in the admin panel: the stage list with name,
  description, age boundaries and order editable inline, retire and add
  actions, and a count of assigned templates per stage linking into the
  library filtered to that stage.
- **Life stage transitions**: a birthday crossing a stage boundary
  notifies organisers with the new stage's suggested journeys. Nothing
  auto-enrols. Because boundaries are editable, transitions are computed
  against the current `life_stages` rows at notification time, not
  precomputed.
- **The assistant** gains journey context in `aiContext.ts`: active
  journeys, current phases, open tasks. It can answer "what should we be
  doing next for Dad" from the journey, and gains two actions,
  `complete_journey_task` and `suggest_journey`, the latter only ever
  producing a suggestion card for a human to accept.
  `complete_journey_task` takes the achieved date and a note, so "we did
  the sunrise trip on Saturday, she loved it" lands as a completed
  milestone with its memory attached, in one sentence to the assistant.
- **Exports**: journeys, phases and tasks export with one column per
  field, like everything else.

## The Memory Book: goals, achievements and memories

Every journey in the catalogue is worked through the same way: a phase,
its checklist, a box ticked, a note added. That mechanism is already the
richest record in the platform, and today it evaporates into a task
list. This section gives it a home. The Memory Book stops being a
standalone scrapbook and becomes the place where everything a person set
out to do, did, and felt about it is kept, sorted and searched.

One mechanism captures three kinds of record:

- **Life goals.** A checklist item that has not happened yet is a goal.
  Clair's circle adds "See the ocean at sunrise" to her Living fully
  phase; Ashe adds "One hundred smoke-free days" to Holding the line.
  Template task seeds and hand-added items are goals the moment they
  exist.
- **Accomplishments.** Ticking the box with the date it really happened
  turns the goal into an achievement: who recorded it, when it happened,
  which journey and phase it belonged to.
- **Memories.** The note thread on the item is where the story lives:
  what happened, who was there, what she said, the photo. Notes can be
  added at completion time in the same action as the tick, and forever
  after, by anyone in the circle.

### The achievements database

The Memory Book gains an **Achievements** view: every completed
checklist item for the person, across every journey past and present,
as a table where every facet is its own sortable, filterable column,
per the platform's one-fact-one-column rule:

| Column | Filter and sort |
|---|---|
| What was achieved | text search |
| Journey | pick list |
| Phase | pick list |
| Date it happened | range |
| Date it was recorded | range |
| Recorded by | pick list of the circle |
| Milestone | yes or no |
| Notes | count, has photos |

There is no copy table. The view reads the checklist and journey
instance tables directly, so an achievement can never drift from the
item it is: one fact, one column, one owner. Locked phases keep their
completed items visible here forever; a journey handing over or
completing removes nothing. The whole view exports to CSV with one
column per field.

### Milestones

Not every ticked box is worth celebrating in a timeline: "Booked the
financial assessment" is the record, "First day back at school" is the
memory. A **milestone** flag separates the two without losing either.
Template tasks seed it (everything in Living fully is a milestone;
everything in The estate and the paperwork is not) and anyone in the
circle can toggle it per item. The achievements database shows
everything; the Memory Book timeline interleaves milestone achievements
with freeform Memory Book entries, newest first, one life in one
stream. Any achievement can be promoted with **Write the story**, which
starts a full Memory Book entry linked back to the item.

### Schema additions

- `checklist_items` gains `achieved_on` (nullable date, the day it
  really happened) alongside the existing `completed_at` (when the box
  was ticked in the app) — two facts, two columns — and `is_milestone`
  (boolean).
- `journey_template_tasks` gains `is_milestone` so templates seed the
  flag.
- `checklist_item_notes` gains `photo_url` (nullable), stored like
  Memory Book photos.
- `memory_book_entries` gains `checklist_item_id` (nullable), the Write
  the story link.

### Protecting the record

A completed item is part of a person's history, not a row in a to-do
list. A completed checklist item cannot be deleted, custom or not; it
must be un-completed first, and both actions land in the audit log.
Notes are never deleted with their item. Archiving a profile keeps the
Memory Book and the achievements database intact; for the After a death
journey they are the point.

### The two examples again

Clair's family opens Achievements, filters to journey Living with a
terminal illness, phase Living fully, milestones only, has photos, and
sorts by the date it happened. That result is the record of her last
year, built entirely out of boxes the circle was ticking anyway. Ashe
filters to Preventive health and risk reduction and sorts by date to
watch the streak build: quit date set, first smoke-free week, first
smoke-free month, the follow up appointment kept, one hundred days.

## Delivery plan

Ordered so every pass ships something usable and nothing breaks:

1. **Schema and backfill.** New tables including `life_stages` seeded
   with the eight defaults; migrate the ageing enum into a system
   template; enrol every existing profile in it; migrate
   `care_phase_history` and checklist links. API compatibility layer
   keeps `current_phase` readable and writable, mapped to the migrated
   journey. No visible change.
2. **Journey API and profile UI.** CRUD for journey instances, phase
   progression with locking, checklist rework including `achieved_on`,
   `is_milestone` and note photos, the journey tab, multiple active
   journeys, enrolment flow with life stage suggestions, and the Memory
   Book achievements view with the milestone timeline and Write the
   story. The seed catalogue ships with the six later life and six end
   of life journeys first, since they serve today's user base.
3. **Template and life stage administration.** Library screens, create
   from scratch, clone, compose in the journey builder, publish and
   archive, the life stage manager, rights wiring, SaaS tier gate.
4. **Full catalogue.** The remaining life stages seeded, reviewed
   against the UI copy rules, with checklist seeds localised the way the
   existing Australian seeds are, behind a per-deployment region setting.
5. **Assistant and notifications.** Journey context in the AI, the two
   new actions, birthday stage transition notifications, handover
   prompts when a final phase completes.
6. **Retire the legacy column.** Drop `current_phase` and the
   `checklist_items.phase` string once nothing reads them.

## Rules that keep this honest

- Templates are suggestions; the person's journey is theirs. Enrolment
  copies, edits are per person, history locks and is never rewritten.
- Life stage never restricts. It orders the menu; it does not lock doors.
- Every journey name, phase name and task is plain language, no
  parentheses in headings, no em dashes in UI copy, no jargon without an
  explanation, and written to be read on the worst day of someone's
  life.
- One fact, one column, one owner, in the template tables and the
  instance tables alike.
- Journey writes go through the same care circle permission middleware
  and audit trail as every other write.
