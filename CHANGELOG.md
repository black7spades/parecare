# Changelog

All notable changes to PareCare are recorded here. Whoever runs the system
reads this record on the release notes screen, opened from the version number
in the sidebar, which links on to the exact commit each build came from, so the
record of updates stays traceable to source. Versions follow
[semantic versioning](https://semver.org).

## [0.57.0] - 2026-11-28

### Added

- **Pare keeps working when its main service stops.** Choose a backup AI service in System settings, and whenever the main one is switched off, still getting ready, overloaded or not answering, Pare answers from the backup instead. Nobody using PareCare has to notice or do anything, and Pare moves back by itself as soon as the main service answers again.
- **See when the backup is in use.** The Pare light turns amber and says it is using its backup service, and the Pare monitor and System settings say which service is answering, since when, and where records go while it is in use.

### Changed

- **Test AI connection checks both services.** It now tests the main service and the backup separately, so a broken one never hides behind the other.

## [0.56.0] - 2026-11-25

### Changed

- **Tables fit the screen.** Every table in PareCare now fits the width it has, on a phone, a tablet or a computer. When all the columns fit, every column shows. When they would not, each row becomes a card with every value named, and the column headings above still sort it. Nothing scrolls sideways.
- **New task opens in its own window.** The Tasks page gives the whole width to the list. Choose New task above the list to add one.
- **Already booked the next visit? Add it as you go.** In How did it go, a follow-up or referral now offers Add the booking. Put in the date and time if it is already booked, or leave it and it stays on your to-do list until it is.

### Fixed

- **A doctor uses their practice's phone.** Someone based at a clinic or health hub with no phone of their own now uses the practice's number, however they were filed, so a follow-up no longer asks for a number PareCare already has. The same goes for their email, booking link, fax and opening hours.

## [0.55.1] - 2026-11-25

### Fixed

- **The emergency sheet opens with no internet.** Save on this phone now keeps everything the sheet needs to start, so it opens with no connection instead of a blank page.
- **Changing a dose asks why and who said so.** Changing a dose or its times through Edit now asks why it changed and who said so, the same as Record a change, and keeps both in the medicine's history.
- **A document uploaded for a visit goes with it.** A document uploaded through Attach a document while adding an appointment or a test is ticked as one to bring straight away.
- **Importing the same medicines twice adds nothing twice.** A medicine already on the list, with the same name and dose, is matched instead of added again. Anything the file changes is updated and kept in its history, the rest is left alone, and the import says what it added, updated and left as it was.
- **No doses to give in hospital or after a death.** The Medications today tile on the overview, the calendar and the medication record agree: nothing is due while someone is in hospital, or from the day they died.
- **Dose and supply alerts stay at the top of the bell.** A dose not given or a medicine running low stays at the top of the bell until it is dealt with, however much else happens.
- **Decide by shows in the move into care table.** The date to decide how the room is paid for now shows in the table and on the move, even once a choice is made.
- **A cancelled appointment with no date says it is cancelled.** It no longer offers Book it, and the to-do to book it closes.
- **Journey suggestions fit the person's age.** The journey lists say who they are suggested for, such as someone aged 36, and journeys for the end of a life no longer lead the list.
- **Undo after one tap.** Recording a dose with one tap on the medication record, Log all due doses or Record a dose for several medicines now offers Undo straight away.
- **The add to home screen note no longer covers anything.** It sits at the top of the page instead of over the dose buttons.
- **Shared links work when no web address is set.** A link to the emergency sheet, a report, an appointment or the calendar feed uses the address PareCare was opened on, port and all.

## [0.55.0] - 2026-11-25

### Added

- **Works in any country.** Whoever runs PareCare picks the country it is used in: Australia, New Zealand, the United Kingdom, Ireland, Canada or the United States. PareCare works out a first guess from the server and the browser, so it is one tap to confirm. An account set up somewhere else can pick its own country in its settings.
- **National services for each country.** Journey steps that send someone to a national service, such as support for carers, an aged care assessment, a crisis line or quit smoking support, show that country's own service with its number and website. In the UK the carer step shows Carers UK; in Australia it shows Carer Gateway, as before.
- **Enter your own.** Every service can be changed, and new ones added, by whoever runs PareCare for everyone, or by an account owner for their own account. Back to the original puts the built-in details back, with Undo. A change shows everywhere the service is used, straight away.
- **Add the number for this service.** Where a country has no single national number for a step, the step says so and offers Add the number for this service, or Add a task, so nobody hits a dead end.
- **A yearly check.** Each service shows when it was last checked. Once a year, whoever runs PareCare gets a task on their home page, and an email, to check the services are still right. With Pare on, Check current services suggests changes one at a time to use or dismiss. With Pare off, each service's website is linked in the list to check by hand.
- **ID numbers for each country.** Edit profile, first setup and the emergency sheet ask for the numbers the person's country uses: Medicare, the IHI, DVA, NDIS and My Aged Care in Australia, the NHS number in the UK, the NHI number in New Zealand, the PPS number and medical card in Ireland, the provincial health card in Canada, and Medicare and Medicaid in the United States. Each is checked as it is saved.
- **The emergency number on the emergency sheet.** The sheet now starts with who to call in an emergency where the person lives: 000 in Australia, 999 in the UK, 911 in North America.

### Changed

- **Funding, yearly checks and referrals follow the country.** Funding plans offer the country's own schemes and name the local coordinator its way, such as an NDIS plan with a Local Area Coordinator in Australia or a personal budget with a social worker in the UK. Suggested yearly checks offer the 75+ health assessment only in Australia, and the flu vaccine from October in the north. A referral's end date is worked out only where referrals run out by rule.
- **Words and formats follow the country.** The advance care directive is called what the country calls it, such as an advance decision in the UK. Dates read month first in the United States and Canada, address boxes say County, Province or ZIP code where those are used, phone numbers in notes are found the way that country writes them, and health funds offered are that country's own. Currency and the financial year follow the country until someone changes them.
- The home card's last update reads as a sentence, such as Linda started a journey, Ageing well and staying independent, 5 minutes ago.

### Fixed

- When first setup stops because something on an earlier step needs fixing, such as an ID number that does not look right, the main button now goes straight to that step instead of offering Try again.

## [0.54.0] - 2026-11-25

### Added

- **Questions go to the visit.** A question can name who to ask and the visit to ask it at. Name the GP and it goes on the next visit with them, and says so, so it is on screen when you get there. The appointment lists its questions to ask, with a box to add another.
- **What did they say?** After a visit, How did it go lists the questions brought to it, each with a box for what they said. Saving the answer marks the question answered.
- **First setup asks the things that matter.** Setting up a new person now asks for their medicines with how much and when, their pharmacy, their ID numbers, whether they have an advance care directive and where it is kept, and who holds power of attorney. The person named as their carer can be picked as who to call in an emergency, and as who holds power of attorney, without typing them again.
- **Setting up your own profile speaks to you.** On your own profile, setup and every page say you and your: Your pharmacy, Medicines you take, Who looks after your care.
- **A short list of journeys to start with.** Setting up a new person offers up to five journeys that fit their age, with See all journeys and a search box for the rest, instead of every journey at once.
- **Empty pages say what they are for.** Medications, Appointments, the medication record, Questions, Test results, Equipment and Where they live each say what goes there and give one first step. Someone helping on a shift is told who adds things there, and that they can too where they are allowed.

### Changed

- **Works the same without Pare.** When no assistant is set up, the Pare button, Ask Pare, File with Pare and Read with Pare are hidden. A photo or an upload opens the plain filing form instead: what it is, the date written, who it is from and to, and what it is for. Each alert keeps its plain next step, such as Call, Mark as ordered or Open. Whoever runs this PareCare sees one line on where to switch Pare on; nobody else is told to ask anyone.
- **Names, not relationship words.** Pages say the person's name, Dorothy, rather than mother's or resident, and your on your own profile. The home card for your own profile reads Your own profile.
- **Typing part of a name never adds a contact.** Every box that names a contact offers the matches first, and only Add them as a new contact files someone new. A name typed in full that matches one contact picks them.
- **New people get a journey that fits.** A person added with no journey chosen, from a list, a file or Pare, starts the everyday journey for their age. A child or an adult under 65 is never put on the ageing journey.
- **Plain words for doses.** Doses read Skipped, Paused on advice and Took it themselves, and the activity list reads Linda added an appointment.
- **Links stand out.** Links to records, phone numbers and pages are the deeper green, underlined, everywhere.
- **Setup that fails can be tried again.** If setup stops part way, it says so in plain words, keeps everything typed, and Try again carries on from where it stopped without adding anything twice.

### Fixed

- **Times on your own clock.** An account that had never told PareCare where it is now takes its time zone from the device it signs in on, so reminders, dose times and whole day dates are worked out on its own clock.
- **Screen readers hear the right window.** A window opened over another, such as an upload over an appointment, reads out its own title, and Escape closes only the top one.
- **Saving a question's changes.** Editing a question now saves the new words, who to ask and the visit.

## [0.53.1] - 2026-11-24

### Fixed

- **Repeating tasks come round again.** Ticking a repeating task, such as the yearly flu shot, marks it done for this round and moves it on to its next date, wherever it is ticked: the Tasks page, ticking several at once, the task panel, a journey step or Pare. The screen says when it is next due, with Undo, and the task keeps a list of each time it was done and by whom. Its journey step reads done for this round with the next date. When the next round comes due, the step opens again. Choosing No longer needed stops it repeating.
- **Steps that need a service give its number.** Journey steps whose next move is to contact a national service show the number to call and the service's website: My Aged Care, with its find a provider page, Services Australia for the financial assessment, the NDIS, Carer Gateway, Dementia Australia, Lifeline, Beyond Blue, Kids Helpline, PANDA, the Australian Breastfeeding Association, the Butterfly Foundation and the National Alcohol and Other Drug Hotline.

## [0.53.0] - 2026-11-24

### Added

- **Journey steps do the job.** Each step on a care journey has the one thing that gets it done. Book it opens the booking form already filled in, with their GP or the right kind of contact. Add a task sets a date. Upload files the paper in the right category. A step with a number shows it to tap and call, with Done. A step about equipment, a hospital stay, a move into care, a funding plan or a test result opens that form, and a step that happens on another page opens it.
- **Due, who is doing it and repeats.** Any step can have a date, the person doing it and how often it repeats, such as the over 75 health check every year. It becomes a task that reminds them, and ticking either one ticks the other. A step that repeats comes round again on its next date.
- **Steps say what was done.** Once a step is done from the journey it says so: Booked for the day, Uploaded the document, or Added the record, each a link to open it.
- **Numbers in journeys can be tapped.** Phone numbers in a step, such as Quitline 13 7848 or the Carer Gateway, are links to call.
- **Every journey checked.** All 49 journeys were gone through so no step that asks for something is a dead end.
- **Your own steps work too.** A step added by hand, such as Book the dentist or Call Lifeline 13 11 14, works out what to do from its words.

### Changed

- **Journeys say the person's name.** The journey page says Dorothy's care journeys, and Your care journeys on your own profile.
- **Booking keeps a repeating task going.** Booking a yearly check from its task moves the task on to next year instead of ending it.
- **Deleting a step has Undo.** Deleting a step from a journey waits a few seconds with Undo.
- **Suggested reminders join the journey.** Adding a suggested reminder, such as the health check for people 75 and over, puts the repeating task on the matching journey step.
- **Journey library editing.** Whoever runs the system can set what each step in the library does, who to book or call, the number, the document category, the page to open, how many days after the phase starts it is due and how it repeats.

## [0.52.1] - 2026-11-24

### Fixed

- **Therapist phones can be tapped.** On the Funding page, each therapist's phone in Reports for the review is a link to call, the same deep green as everywhere else. The report tasks and the link to the progress report look like links too.
- **Late reports are asked for now.** When six weeks before the review has already passed, the report tasks are due today, not on a day already gone, and the Funding page says "Reports are overdue, ask now". A report task left past its day shows as overdue.
- **Names, not relationship words.** Funding, Equipment, Test results, Where they live and the move into care form say the person's name, such as Oliver's plan or What Dorothy uses, and "your" on your own profile.
- **Record links stand out.** Links to records, such as a result to talk about at an appointment or a task linked to equipment, use the deeper green link style.

## [0.52.0] - 2026-11-24

### Added

- **Where they live.** A new page shows the home they live in now, the home they left, their hospital stays and their moves into care. On your own profile it is called Where I live.
- **Hospital stays.** Record a hospital stay with the hospital, the day they went in, the ward, the treating team and why. While the stay is open, medicine reminders, low supply alerts and the medication record's due doses pause, because the hospital gives the medicines. Every page of the person says where they are, with Record the discharge.
- **Record the discharge.** Say the day they left, pick or upload the discharge letter, and say how many days to see the GP. PareCare adds a task to see their GP within those days and a task to look over the care plan, and files the letter against the stay. After two weeks in hospital PareCare asks whether they are still there, and a dose recorded at home asks whether they are back.
- **Test results.** Record what a test showed, each measure on its own line with its unit, normal range and whether it is low or high. A result is tied to the test appointment and shown at the next visit with whoever ordered it, under Results to talk about. Recording a result ticks off the Results to chase step.
- **Funding.** Keep an NDIS plan, Support at Home or a Home Care Package with its dates, how it is managed, the plan manager, support coordinator and Local Area Coordinator, and its budgets. A cost can count against a budget, so each budget shows what is spent and what is left. Before the review, each therapist gets a task to ask for their progress report, due six weeks before. The NDIS progress report opens on the plan period, with the care log, appointments and spend.
- **Equipment.** Each person has an Equipment page. Equipment can be owned, on loan or hired, with the day it goes back and the day it is due a service, and each makes a task in good time. An Equipment to get step has Add to equipment.
- **Move into care.** Record the care home, the room, the day they moved in, the agreement and cooling-off, how the room is paid for and by when, and notice dates. The care home becomes where they live, the old home is kept as their previous home, their care journey moves on, and tasks are added for the cooling-off and the payment decision.
- **Suggested reminders.** Tasks suggests the yearly and six-monthly checks worth not forgetting, by age and conditions: the flu shot, the health check for people 75 and over, a GP management plan review, dental and eye checks, and the driver's licence medical. Add makes a repeating task. Dismiss sets one aside, with Undo.
- **The roster.** Tasks can be shown as a roster: who does which repeating task on each day of the week.

### Changed

- **Only places in the place pickers.** Choosing where someone lives, a hospital or a care home lists only hospitals, care homes and similar places, never the GP or the pharmacy.
- **Reminders reach everyone.** A task assigned to someone added by name is emailed to them. With no email on file, the reminder goes to whoever manages the profile with their phone number to ring.
- **Care journeys move forward the same way everywhere.** A phase change from Pare goes through the care journey, the same as on screen.

### Fixed

- **Save on a cost always answers.** With no amount typed, Save says what to write instead of sitting greyed out.

## [0.51.0] - 2026-11-21

### Added

- **ID numbers.** Edit profile has an ID numbers tab with a box for each number: Medicare with the position on the card and the valid to month, the Individual Healthcare Identifier, DVA with the card colour, NDIS, the health fund and member number, and My Aged Care. Each number is checked. One that does not look right says what it should look like, and the rest still save.
- **How bad an allergy is.** Each allergy says how bad the reaction is: mild, moderate, severe or life threatening. An allergy that causes anaphylaxis is marked life threatening without being asked.
- **No known allergies is a checked answer.** With no allergies on file, No known allergies records who checked and when. Adding an allergy clears it.
- **Eating and drinking safely.** Care needs has a list for what keeps eating and drinking safe, such as sitting upright or thickened fluids, beside diet and mobility.
- **A fuller emergency sheet.** The sheet now runs in the order a paramedic needs it: who this is, where they are, ID numbers, allergies with how bad, conditions they have now, medicines, eating, drinking and moving, the advance care directive with its document, power of attorney holders with their phone and document, who to call, and every professional and organisation. Every phone on it can be tapped to call. The same sheet prints in bulk from the Homeboard.
- **Share the emergency sheet by link.** Share a link gives a link that opens the sheet with no login, for a paramedic, a hospital or family. It shows how many times it has been opened and keeps working until it is turned off, with Undo straight after.
- **Save on this phone.** The emergency sheet keeps a copy on the phone, so it opens with no internet.
- **Send a report.** A report for one person can be sent to a contact, someone in the care circle or any email, with documents such as a referral sent with it. It opens with no login for 30 days. Documents shared only with some people in the circle are never sent.
- **A fuller health summary.** The health summary now includes their GP and contacts, appointments coming up and from the last year, open questions, and who to call in an emergency, each detail in its own column.
- **Send an appointment.** Send to someone sends one appointment, such as to whoever is driving: the time, the place, the contact's phone, what to bring and how to get ready, with the calendar entry attached. Notes stay private. Add to my calendar puts it in your own calendar.

### Changed

- **A calendar feed that helps you get there.** Appointments in the calendar feed show the place, who it is with and their phone, what to bring, how to get ready, a link back into PareCare, and reminders a day before and two hours before. Finished tasks stay on the calendar marked Done.
- **Files that read plainly.** Downloads write dates as dates and phases as the screen names them, such as Residential ongoing. The medicines file now keeps how often, whether it is critical, the condition it is for and the prescriber's phone, and reads every column back in, so nothing is lost on the way round.
- **Reports without Pare.** With no Pare attached, the report builder makes the tables on its own and the AI summary choice is not offered. Generate report and Send always say what is missing instead of greying out.

### Fixed

- **Task notes stay private.** The calendar feed no longer sends out task notes or appointment notes.
- **Who to call in a report.** Emergency contacts in a report have a column each for name, relationship, phone and email.
- **Save on an allergy always answers.** With nothing typed, Save says what to write instead of sitting greyed out.

## [0.50.1] - 2026-11-20

### Fixed

- **Allergies read clearly.** Each allergy shows on its own, with the reaction after it, such as Penicillin: rash, so a reaction never reads as a second allergy. This is on the medicine round, Before you start and the medication record. Emergency sheets label the Allergy and Reaction columns.
- **Who said so picks before it adds.** Typing part of a name on Record a change offers the matching contacts first. A new contact is only filed after choosing Add as a new contact.
- **The medication record counts scheduled doses only.** As-needed doses no longer count towards the scheduled doses given. They show on a line of their own.
- **Raise question always answers.** With the question box empty, Raise question now says what to write instead of sitting greyed out.

## [0.50.0] - 2026-11-20

### Added

- **Before you start.** Someone starting a shift sees, on one card, what not to give, the GP, who to call in an emergency, the doses due now, how the person eats, moves and talks, and the last handover with who wrote it. It leads for helpers and comes second for the person who manages the profile, with Start the medicine round and Write a handover.
- **The medicine round.** Every dose due from two hours ago to two hours ahead, for everyone you give medicines to, grouped by room. Each dose is one tap: Given, Refused with why, Not in stock, or More for the full form, and each can be undone.
- **As-needed medicines say their limits.** An as-needed medicine keeps what it is for, the least hours between doses and the most in 24 hours, worked out from the instructions when nobody typed them. The medication record shows when it was last given, by whom, and how many in the last 24 hours.
- **A dose given too soon asks first.** A dose inside the gap or over the most in 24 hours shows a red notice with Wait until, or Give it now with why it must be given now. It never stops a dose. An as-needed dose asks why it is needed now.
- **Not in stock.** A dose with none to give is its own outcome. The person managing the profile is told, with the pharmacy to call.
- **Helpers record a change.** A support worker or nurse records a new dose or new times a doctor asked for, with why and who said so, and marks a repeat as ordered or arrived. Adding or deleting medicines stays with the person who manages the profile.
- **Who wrote it.** Every care log entry and every reply to a question shows who wrote it and when.
- **Find anyone in a home.** The Homeboard has a search by name or room, and the table has Room, GP, GP phone, Next of kin, Relationship and Next of kin phone columns, all sortable. The People directory has the same columns.
- **Emergency sheets in bulk.** Choose several people on the Homeboard and print their emergency sheets in one go, one to a page.
- **One invite for many people.** Choose several people on the Homeboard and invite one new carer to all of them. They accept once and see everyone.
- **Bring residents in by spreadsheet.** The people spreadsheet has Room, GP name, GP phone, GP practice and Next of kin columns. Importing it files each GP in Contacts and links them, and anyone who may add a person may import.

### Changed

- **Doses not yet recorded, once.** When several people have doses not yet recorded, Needs attention shows one row that says how many people, with Start the medicine round. Show who opens the detail for each person.
- **Without Pare.** On these screens, when no assistant is attached, the Pare buttons step aside and the plain next step shows instead, such as Mark as ordered on a medicine that has run out.
- **The medication form has Instructions.** Instructions now save, and an as-needed medicine has What it is for, Hours between doses and Most in 24 hours.

## [0.49.1] - 2026-11-20

### Fixed

- **Attached to looks like links.** On a document, each record under
  Attached to now shows as an underlined link in the same green as phone
  numbers and emails, so it is clear that tapping one opens that record.
- **A letter lists the medicines it changed.** When a medicine change, stop
  or start says it came from a letter, the letter now lists that medicine
  under Attached to. Changes already recorded are linked too.

## [0.49.0] - 2026-11-20

### Added

- **Dates on every document.** A document has a Date written and a Valid
  until, each in its own box, with Does not expire. The documents list has
  Date written, Valid until and Attached to columns, and a document that has
  run out says so.
- **Referrals work out their own dates.** A GP referral lasts 12 months and a
  referral from a specialist lasts 3 months, counted from the first visit
  with the specialist. Until that visit is booked, it counts from the date
  written. The referral says how its date was worked out, with Change.
- **A reminder before a referral runs out.** Six weeks before, a Get a new
  referral task appears with the GP and the letter attached. It moves when
  the date moves.
- **Who a letter is from and who it is to.** Each document can name who wrote
  it and who it is addressed to, picked from Contacts or added with their
  phone. A referral offers Book appointment with whoever it is to.
- **What a document is attached to.** Every document lists the tasks,
  appointments, medicines and other records it belongs to, and each one
  opens that record.
- **New document categories.** Referral, Prescription, Test request, Results,
  Letter, Service agreement and Behaviour support plan. A category with one
  of these names already becomes the built-in one, so nothing is listed
  twice.
- **A history for every medicine.** Changing a dose or the times asks why it
  changed and where the change came from: a recent visit or a letter on
  file. Each medicine lists its changes, newest first.
- **Stop a medicine properly.** Stop this medicine asks for the last day
  taken, why it stopped and anything in their words, then offers Undo. A
  stopped medicine offers Start again.
- **Courses that end.** A medicine can have a last day of the course. After
  that day its doses are no longer due, and it asks Stop it or Still taking
  it. Repeats left on the script has its own box.
- **Pare files more from a letter.** Everything Pare files from a letter is
  attached to it. A referral is filed with who wrote it and who it is to,
  with their phone, and joins the task already open for booking them. A
  letter that changes or stops a medicine already on the list changes it,
  with the reason, rather than adding a second copy. Pare also books
  appointments from booking letters with the letter to bring, and adds
  conditions, allergies and costs.
- **Long letters and scans.** Pare reads a long letter part by part instead
  of stopping partway. When Pare uses Claude it reads scanned pages too; on
  other AI services it says plainly to photograph the pages.
- **Two new Pare commands.** /stop for a medicine to stop and why, and
  /change for a medicine change and why.

### Changed

- **The Supplier column names the main pharmacy.** A medicine with no
  supplier of its own shows their main pharmacy, marked Main pharmacy, and
  sorts by it.
- **Inactive medicines are now stopped.** The list says stopped, and Stop
  these medicines on several at once keeps each stop in its history.
- **A next step's document belongs to its visit too.** Attaching a document to
  a task that came from an appointment attaches it to that appointment as
  well.

### Fixed

- Save on Edit document and Change category now says what is missing,
  instead of being greyed out.
- Read the document and File without reading now say when no file is
  chosen.
- A medicine Pare adds or changes keeps its dose amount and measure in their
  own columns.

## [0.48.0] - 2026-11-20

### Added

- **Who prescribes each medicine.** A medicine says who prescribes it and the
  visit it started at. The medications list has Prescribed by and Repeats due
  columns, and a medicine shows its prescriber with a phone to tap and Book a
  visit for scripts.
- **Reorder in one tap.** A medicine running low offers Order online, Call or
  Email for its pharmacy, with the repeat request already written, then Mark
  as ordered. With no pharmacy on file it says so and offers Add a pharmacy.
- **Alerts say who to call.** A low or empty medicine names the pharmacy and
  its number, and an overdue task names who it is with. Each alert opens the
  record itself and offers the next step: call, email, order online or book.
- **Who treats it, who provides it, who supplies it.** A condition can name
  who treats it, a treatment who provides it, and equipment its supplier,
  each with a phone to tap. Book an appointment for this on a condition books
  with whoever treats it.
- **More ways to reach a contact.** Contacts have an after-hours phone, a fax
  and opening hours, a row per day with Same hours Monday to Friday. A
  contact based at a clinic uses the clinic's when theirs are empty.
- **Main GP and past contacts.** The first GP and first pharmacy are the main
  ones, with Make main to change it. No longer seeing them moves a contact to
  past contacts from a date you choose, and Seeing them again brings them
  back.
- **Emergency contacts picked, not typed.** Choose who to call from you, the
  care circle or Contacts, and their phone comes from their own record, so a
  changed number changes everywhere. Arrows set who to call first. With
  nobody chosen, the person who looks after them is worked out from the
  profile, with Change.
- **Your phone.** Add your phone once, in Settings or from your own row in
  the care circle, and it shows wherever you are picked.
- **New kinds of contact.** Plan manager, Local Area Coordinator, Behaviour
  support practitioner, Care coordinator, Pharmacist, Teacher and Teacher
  aide, plus Respite service and Plan management provider for organisations.
  Someone saved under a school is filed as a teacher.
- **Support worker and Nurse.** Two new roles in the care circle and in
  invitations.
- **A care plan reviewer from Contacts or the circle.** Invite someone
  already on file to review the care plan, and their email comes from their
  own record. The plan shows who supports each condition with their phone,
  read live.

### Changed

- **Home cards say whose phone it is.** A daughter, the care home, the GP or
  the person's own phone, with the name above the number. The GP has a row of
  their own.
- **Phone numbers look tappable.** Phone numbers, emails and links on
  contacts are underlined in a deeper green, so they read as links to tap.
- **The care circle reads the right way round.** A row now says "Dorothy is
  their mother".

### Fixed

- How did it go? only shows once an appointment has happened.
- An appointment no longer lists who it is with twice. Their name under Who
  with opens them in Contacts.
- Save on the medication, condition, treatment, equipment and contact forms
  now says what is missing, instead of doing nothing.

## [0.47.0] - 2026-11-20

### Added

- **Book anything from anywhere.** A task that books something now has a
  Book it button, in the list and on the task. It opens the booking form
  already filled in: what it is for, the kind, who it is with, the
  condition and the documents to bring. A contact has New appointment with
  them, a condition has Book an appointment for this, and a health alert
  books with the GP for that condition.
- **Who a task is with.** New task asks who it is with. Pick someone from
  Contacts or type a new name with what they do and their phone, and they
  are filed in Contacts. The task shows them with a phone to tap, and the
  task list has Who with and Their phone columns.
- **Tasks can be edited.** Open a task and choose Edit to change anything
  on it.
- **PareCare works out who and what.** "Ask OT for progress report" links
  the occupational therapist, and "Book a neurologist" becomes a booking
  task. The task says what was worked out, with Change.
- **One task per booking.** A next step or a new task for a booking that
  an open task already covers joins it, rather than making a second task.
  The screen says so and offers Keep them separate. Two tasks that already
  look like the same booking offer Join them.
- **Numbers in notes can be tapped.** Phone numbers, emails and links in
  task, appointment and record notes can be tapped. A note that names
  someone with a number offers to add them to Contacts, and a contact with
  no number offers to save the one in the note.
- **Documents on tasks and appointments.** A task can have documents
  attached as it is written, and an appointment can list documents to
  bring when it is made. Booking from a task brings its documents along.
- **More on every appointment.** Who's going, with who is driving; an
  interpreter and the language; a video call link that shows as Join the
  video call; and how to get ready, with a reminder at 7pm the night
  before. The appointment shows who it is with, their phone, email and
  booking link.
- **Repeats from every day to every year.** Tasks and appointments can
  repeat every day, every week, every 2 weeks, every month, every 3 months,
  every 6 months or every year. A repeating appointment can stop repeating,
  and moving one offers to move the ones after it.
- **Contacts show their appointments and open tasks.**

### Changed

- **A blank time means any time that day.** A task or appointment saved
  with a date and no time shows as "any time" that day rather than 9am,
  and is not overdue until the day is over.
- **The appointment form is grouped** into What and who, When, Where,
  Getting there, Bring and get ready, and Notes and cost.
- **The next appointment on the overview** shows who to call and what to
  bring.
- **Save always answers.** Add task, Upload, Add note, Attach, Add on
  emergency contacts and Send to Pare say what is missing rather than
  sitting greyed out.
- **Pare books and adds tasks the same way the forms do,** with who it is
  with, their phone, documents, repeats and everything else above.

### Fixed

- **Task notes are in one place.** Notes added to a task in either of the
  two old places now show together on the task.

## [0.46.3] - 2026-11-20

### Fixed

- **A refused dose is not a given dose.** A dose recorded as refused, held
  or omitted no longer quiets the overdue alert, and the family is told
  straight away, for example "Jess recorded Dorothy's Metoprolol as
  refused." The activity list says the same, rather than "Medication added".
- **One tap records the dose as prescribed.** A dose recorded with one tap,
  with Log all due doses or with Record all doses now counts as the right
  dose by the right route. Before, every one was flagged as wrong.
- **Directories show everything that is yours.** People, Professionals,
  Organisations, Suppliers, Assets and Addresses now list every person
  and record set up on the account, not only those shared with it. An empty
  People directory explains what it is for and offers Add a person.
- **Care homes are in Organisations.** A care home, nursing home or hospice
  is now filed with Organisations rather than Professionals, including
  those already saved.
- **Residents' profiles save again.** Saving Edit profile for a resident of
  a care home no longer stops with a message about the home not being
  linked. The home is linked to them on the spot.
- **Sharing a document with carers reaches every carer.** A role is now
  picked from the list when editing someone in the care circle, and roles
  match whatever their capitals, so "Carer" and "carer" are the same role.
  Roles already saved have been tidied to match.
- **Recording a death stops what was still running.** Saving a date of death
  now stops task reminders, dose and supply alerts and the calendar feed,
  closes open tasks and cancels future appointments, which stay on the
  record as history. The screen says what stopped. Undo, or clearing the
  date, puts everything back as it was.
- **A hospital stay keeps the home address.** Choosing a hospital or care
  facility as where someone lives no longer wipes their home address, and
  reaching them through the facility no longer erases a personal contact
  such as a daughter.
- **Letters land on the right visit.** When Pare files a letter about a
  visit, such as a discharge summary, it only attaches it to an appointment
  whose name matches. Otherwise it files the visit on its own, with every
  next step, rather than on whatever appointment happened last.
- **The care plan review date stays put.** The yearly review date is set
  once and no longer moves a year out every time the plan is rebuilt. A
  reminder task comes two weeks before, and Change date on the care plan
  moves both.
- **Archive is only offered where it works.** Archive shows only on profiles
  set up on this account. When some of the profiles chosen belong to someone
  else, the screen says which were left and why.
- **Birthdays no longer slip back a day.** Saving Edit profile without
  changes no longer moves a date of birth to the day before. Dates of birth,
  dates of death, repeat dates and other whole-day dates now show and save
  as the same day everywhere, including exports.
- **Blocked changes say who can make them.** Someone who cannot change a
  medication, a treatment, care costs or the care circle is now told exactly
  what they cannot do and who can, by name, instead of a message about the
  care circle.
- **Replies stay with their own question.** Replies to a question can only
  be read and written from the profile the question belongs to.
- **A task keeps the contact it was made with.** A task made with a contact
  now keeps that contact, checked as one of the person's own contacts.

## [0.46.2] - 2026-11-20

### Fixed

- **New contacts keep everything you entered.** Someone added to Contacts
  from a referral or a booking now gets the address and map link typed for
  their appointment, not just their name. Edit them in Contacts and it is
  all there. A later booking fills in anything Contacts is still missing,
  and never overwrites what is already saved. People already added with
  only a name pick up their address from their appointment.
- **You can see they were added.** Saving now says who was added to
  Contacts, with a link to open them, and each referral in How did it go
  shows who it is with, linked to their entry in Contacts.

## [0.46.1] - 2026-11-20

### Changed

- **Not booked yet books it, wherever it appears.** Clicking Not booked yet
  in Appointments, on the appointment itself, in How did it go, in
  condition tracking or on a condition opens the booking straight away.
  The buttons that do it now say Book it.

## [0.46.0] - 2026-11-20

### Added

- **Save an appointment before it is booked.** Fill in who it is with,
  where, what for and any notes, and leave the date blank. It saves as Not
  booked yet, with a to-do to book it. Book it now in How did it go works
  the same way.
- **Add the date when it is booked.** Not booked yet appointments sit at
  the top of Appointments with an Add the date button. Adding the date
  books the appointment and ticks its to-do off. Ticking that to-do on the
  Tasks page takes you straight to adding the date.
- **Pare saves appointments that are not booked yet.** Tell Pare about an
  appointment you still need to book and it keeps the details with a
  to-do. Give Pare the date later and it books it.

### Fixed

- The panel that slides in from the right closes every time. Opening
  another record from inside it, or clicking a row twice, no longer leaves
  Close and the background unable to shut it.
- On a phone, the Add PareCare to your home screen bar no longer sits on
  top of an open record and blocks what is underneath it.

## [0.45.1] - 2026-11-20

### Fixed

- **Save always says what is missing.** In How did it go and the
  appointment form, Save no longer greys out without a word. Press it and
  anything still needed is named in red under its box, the form takes you
  there, and a sentence by the button says what to add or that Not now
  books it later.
- **A refused save names the box.** When an appointment or How did it go
  cannot save, the message now says which box to check instead of
  "Invalid request". A booking that does not go through says why.

## [0.45.0] - 2026-11-20

### Added

- **Referrals go straight into Contacts.** A referral in How did it go now
  asks who it is to and what they do, as two separate boxes. Pick someone
  already in Contacts, or type a new name and they are filed there for you,
  linked to the person you care for. Booking the referral later starts with
  them already chosen.
- **New names are filed for you.** Typing a new name for who an appointment
  is with now adds them to Contacts when the appointment is saved. There is
  no separate button to press. Pare does the same when it books.

### Changed

- **Appointment addresses use the address finder.** Where an appointment is
  now works the same as every other address: start typing, pick the place,
  and each part fills its own box. Picking who it is with fills in their
  address. A map link has its own box. Existing locations have moved into
  the first address line, ready to tidy.
- **One appointment form everywhere.** Adding an appointment from the
  Calendar now opens the same form as the Appointments page.

## [0.44.0] - 2026-11-20

### Added

- **Add people to the care circle without inviting them.** Choose Add
  someone, type their name and pick who they are. A neighbour, a friend who
  drives or a support worker joins the circle with their phone and email if
  you have them. They do not need an account, nobody is emailed, and they
  cannot see anything.
- **Doctors and other professionals in the circle.** Pick GP, Specialist,
  Psychologist, Allied health or Social worker and they are filed in
  Contacts too, so the same person is ready for appointments and referrals.
  Everyone in Contacts now shows in the circle under Professionals, and
  names already on file are offered so nobody is entered twice.
- **Invite to log in, any time.** Anyone added by name can be invited later
  with one button. They keep their place in the circle.
- **Pare knows your circle.** Ask Pare to add, change or remove someone in
  the care circle, or use the new circle command. Pare also knows who
  everyone is and how to reach them.

### Changed

- **Removing someone added by name has Undo.** Nothing is lost by removing
  them, so it happens straight away with a few seconds to Undo. Removing
  someone who logs in still asks first.
- **People added by name do not count toward your plan's circle limit.**
  Only people who log in or have an invite on the way count.

## [0.43.0] - 2026-11-19

### Added

- **Book the next appointment while recording how it went.** Add a referral
  or follow-up in How did it go and choose Book it now. The same appointment
  form opens right there, with the condition already filled in, and a
  follow-up starts with the same doctor and place. No date yet? Leave it and
  the step stays on your tasks until it is booked.
- **Forward notes to another appointment.** Choose Forward notes on an
  appointment, or Forward on a single note, tick all or some of what was
  noted, trim the text if only part of it matters, and pick where it goes.
  The original turns grey with "Forwarded to" and the name and date. The copy
  at the other end says who it is from and when.
- **Send notes with a referral before it is booked.** When a referral is
  added in How did it go, everything noted at that visit is ticked to go with
  it. The notes wait on the referral and land on the appointment the moment
  it is booked, whether that is now or weeks later.
- **Take back a forward.** Take back removes the copy from the other
  appointment, with a few seconds to Undo.
- **Pare forwards notes too.** Ask Pare to send today's notes to the
  neurologist, or use the new forward command. Booking a referral through
  Pare also brings the notes waiting on it.

### Changed

- **Appointments list newest first.** The most recent appointment is at the
  top.
- **Tables remember your order.** Every list keeps the order you last sorted
  it by, on this device, so it is the same the next time you come back.

## [0.42.0] - 2026-11-19

### Added

- **Say why a condition resolved.** Mark resolved now offers three optional
  boxes: when it resolved, why it resolved and what happened. Fill in as much
  or as little as you like. Leave them blank and the condition simply stops
  being tracked.
- **Why it resolved on the list.** The Conditions page has a Why it resolved
  column, and the reason and what happened show on each condition and in
  reports. Edit a resolved condition to add or change the detail later.

### Changed

- **Pare no longer guesses the date.** Telling Pare a condition has cleared
  up no longer records today as the day it resolved. Pare records a date and
  a reason only when you give them.

### Fixed

- A condition marked resolved without a date no longer counts toward how
  unwell someone looks on their profile.

## [0.41.0] - 2026-11-19

### Changed

- **Resolved conditions leave the list.** Conditions that are over drop off
  the Conditions page and stay on record. Show resolved conditions brings
  them back whenever they are needed.
- **Mark conditions resolved in one go.** Tick the ones that are over and
  choose Mark resolved, or open one and press Mark resolved. No date is
  needed, and Undo brings them back for a few seconds.

## [0.40.0] - 2026-11-18

### Added

- **Open any record.** Click any line in any list (appointments, tasks,
  medications, doses, conditions, allergies, documents, contacts, the care
  circle, questions, substance use, memories, achievements, treatments, care
  log entries, activity and every directory list) and it opens on its own,
  with every detail and what it is linked to. On a laptop it slides in beside
  the list; on a phone it fills the screen.
- **The same buttons on every record.** Edit, Done where it applies, Add a
  note, Attach a document, Ask Pare about this, Print, Copy link and Delete,
  plus the buttons that belong to that kind of record, such as Record a dose
  or How did it go.
- **Notes and documents on any record.** Add notes to anything, and attach a
  new or existing document to it. Each record also shows who changed it and
  when.
- **A link to every record.** Copy link gives an address that opens straight
  to that record, and Back closes it.

### Changed

- **Delete with Undo.** Deleting no longer asks "are you sure". The record
  goes at once and Undo brings it back for a few seconds. Removing someone
  from the care circle still asks first, because it ends their access.
- **More lists sort by any column**, including tasks, allergies, substance use,
  the dose record and achievements.
- **Substance use shows the amount and the unit as separate columns.**
- **Recent activity on the overview opens the exact record** each line is
  about.

## [0.39.0] - 2026-11-18

### Added

- **Add a prescription to medications from the appointment.** A prescription
  to fill has Add to medications. The medication form opens with the name and
  condition filled in, and saving it ticks the prescription off.
- **Upload a document from the appointment.** A document to file, a form or a
  medical certificate has Upload. The upload window opens with its name and
  condition filled in, and uploading ticks it off.
- **Letters from doctors fill in the outcome.** When Pare reads a specialist's
  letter, a consult summary or a discharge summary, it proposes how the visit
  went and each next step the letter asks for. Check or change every step
  before filing.

### Changed

- **Tasks sort by any column.** Click a heading to sort, and again to reverse.

## [0.38.0] - 2026-11-18

### Added

- **How did it go?** After an appointment, note what happened and what came
  out of it. Choose from common next steps such as a referral, a follow-up,
  a prescription to fill, a blood test, a urine, stool or semen sample, an
  X-ray or scan, results to chase or a document to file. Anything else is
  added by typing it, and is then on the list for everyone you care for.
- **Every next step is tracked.** Each one becomes a task with its own date,
  so it shows on the Tasks page, in At a glance and in the bell until it is
  done. A referral, test or follow-up can be booked straight from it, and
  booking it ticks it off.
- **A thread for each condition.** A condition's appointments now read in
  order, each with how it went and what it led to, from the first visit on.
- **A nudge after each appointment.** The bell asks how an appointment went
  once it has finished, and clears itself when you answer. It can be turned
  off in notification settings.
- **Pare records outcomes.** Tell Pare "saw Dr Lee, got a referral to physio
  and a script for Naproxen", or use /outcome, and it files the outcome and
  both next steps.
- **Edit the list of next steps.** The account owner can rename, combine and
  delete kinds of next step, with Undo.

### Changed

- **Appointments sort by any column.** Click a heading to sort, and again to
  reverse.

## [0.37.2] - 2026-11-18

### Fixed

- **Back to the overview in one click.** Click a person's name or picture
  at the top of any of their pages to return to their overview.

## [0.37.1] - 2026-11-18

### Fixed

- **Each dose counts on its own.** Recording one dose of a medication taken
  three times a day no longer marks all three as given. Medications today,
  the calendar and the overdue dose alert now agree on what is still to give.
- **Medication times show in your own time.** The calendar placed scheduled
  doses at the wrong hour for anyone outside UTC. An 8am dose now shows at
  8am.
- **The bell clears itself.** An alert to record a dose goes away the moment
  the dose is recorded, whether on the medication chart, the medications
  page or through Pare.

## [0.37.0] - 2026-11-18

### Added

- **At a glance.** The top of each overview now shows the next appointment,
  medications still to give today, open and overdue tasks, and the newest
  document. Each one opens its page.
- **Cards with news come first.** A card with changes since your last visit
  has a dot beside its name and moves up, unless you have arranged the
  cards yourself.

## [0.36.0] - 2026-11-18

### Added

- **Recent activity on the overview.** Each person's overview now opens with
  what changed since you last looked, headed with the date of that visit.
  It counts what was added, lists each change by day with who made it, and
  each line opens the record it is about. The first time, it shows the
  last two weeks.

## [0.35.0] - 2026-11-18

### Changed

- **More room for your documents.** The upload form no longer sits beside
  the documents list, so the list now uses the whole width of the screen.
  Choose Upload above the list to add a document. It asks the same things
  as before: the file, its name, its category, what it is for and who can
  see it.
- **Drop a file onto the list to upload it.** Drag a file from your
  computer onto the documents list and the upload window opens with that
  file ready and its name filled in.
- **See where a new document went.** After an upload the list shows newest
  first and the new document lights up for a few seconds.
- **A clearer start.** With no documents yet, the page says what to keep
  here and offers one button to upload the first one.

## [0.34.0] - 2026-11-18

### Added

- **Your own document categories.** Type a category when filing a document.
  If it is not on the list yet, choose Add and it is created on the spot.
  Categories are shared by everyone you care for, so Tax set up for one
  person is there for all of them.
- **Edit categories.** The account owner has Edit categories beside the
  Category filter on Documents. Rename a category and every document filed
  under it follows. Rename it to a name already in use and it offers to
  combine the two. Delete one and its documents move to Other, with Undo
  right there. Care plan, Advance care directive and Other are always kept,
  because PareCare files things there, but they can still be renamed.
- **Change category for many documents at once.** Tick documents and choose
  Change category.
- **Pare files the document itself.** When Pare reads a document it now
  suggests the category it belongs in and a clear name for it, such as
  "Discharge letter, Example Hospital, March 2026" in place of
  "IMG_2034". Check or change both before saving. In the chat, ask Pare to
  "put the discharge letter under Hospital", or use /file.

### Changed

- **Medical record and Medical certificate are now two categories.**
  Documents already filed with "certificate" or "cert" in their name moved
  to Medical certificate. The rest stay in Medical record.

## [0.33.0] - 2026-11-18

### Added

- **File a document without Pare reading it.** Uploading with Pare now offers
  File without reading, which puts the file straight into documents and
  leaves it there untouched. Handy when there is no time to check what Pare
  finds, or when the file only needs keeping.
- **Have Pare read a document already on file.** Every document in the list
  now has Read with Pare. Pare reads it, says what it is and proposes what to
  file from it, the same as a fresh upload, and nothing is saved until you
  check it. Documents filed before today work too. It sits beside each
  document in the list and in the window that opens when you view one.

### Fixed

- **The documents list fits on a laptop screen.** Every button beside a
  document now shows without scrolling sideways, and the upload form moves
  under the list until the screen is wide enough for both.

## [0.32.0] - 2026-11-16

### Added

- **Contact details shared from the organisation.** Everyone based at an
  organisation now uses its phone, email, booking link and directions, as
  well as its address, whenever they have none of their own. Change the
  organisation's phone once and everyone there has the new number. Type in a
  doctor's own mobile and it stays theirs. An empty box shows what will be
  used, and from where. Records already filed were filled in the same way.

## [0.31.0] - 2026-11-16

### Changed

- **Organisations and Professionals, in place of Providers.** The directory
  now keeps two lists. Organisations holds clinics, health hubs, hospitals,
  pharmacies, government departments, agencies, law firms and every other
  body. Professionals holds the people: doctors, specialists, lawyers,
  caseworkers. Everything already filed was sorted into the right list, and a
  name with a title, like Dr Karen Sank, is always a professional.
- **Each form asks the right question.** A professional is Based at an
  organisation. An organisation is Part of a bigger one, such as a clinic
  inside a health hub. The Type list offers kinds of organisation on one form
  and kinds of professional on the other, with Government department, Law
  firm, Case manager and Support coordinator among the new ones.
- **Filed in the wrong list?** Tick it and choose Move to Professionals or
  Move to Organisations. Everything linked to it stays linked.
- **Contacts on each person's page.** The Providers tab is now Contacts, with
  their professionals on one tab and their organisations on the other.
  Appointments now say who they are With.
- **Pare and your assistants know the difference.** Saying "add the
  Department of Justice" files an organisation, and "add Dr Carly Examplename
  to Health Hub Morayfield" files a professional there.

## [0.30.0] - 2026-11-16

### Added

- **Merge two records for the same thing.** Tick both in the provider
  directory and choose Merge selected, or use the list of likely duplicates
  PareCare spots for you. Everything linked to the duplicate moves across: the
  people it is linked to, appointments, and whatever is based there. Details
  only the duplicate had are copied in, and its name is kept as another name,
  so Pare and your assistants still find it. Undo is there for 30 minutes.
- **Also known as.** A provider can go by more than one name. Add names people
  use, and Pare, your assistants and imports find it by any of them.

### Changed

- **A better address finder.** It looks in your own directory first, then
  searches your own country before the rest of the world. When a place is not
  on the map, as with some shopping centres, it says so and points you to
  typing the address in yourself.
- **Fewer second copies.** Filing a new place with a name close to one you
  already have, like Health Hub Doctors Morayfield, now finds the one you have
  instead of making another.
- **Clearer filters.** They read Any type and Anywhere, in place of All type
  and All based at.

## [0.29.0] - 2026-11-16

### Added

- **Health hubs, with places inside places.** A health hub such as Health Hub
  Morayfield is now its own type, for one building with many services under
  the one roof. Clinics and practices are based at the hub, and doctors are
  based at their clinic, so the address of the hub reaches everyone inside.
  Move the hub and every clinic and doctor in it follows. Tell Pare or your
  assistant "add Dr Carly Examplename to the Neuro Clinic at Health Hub
  Morayfield" and it files all three in one go. Health Hub Morayfield is
  already filed as a health hub.

### Changed

- **Based at, in place of Works at.** The same field now suits a doctor at a
  clinic and a clinic inside a hub, and the list of what is based at a place
  includes its clinics as well as its people.

## [0.28.1] - 2026-11-16

### Changed

- **One type means one thing.** Clinic and Practice are now two provider
  types, with Medical centre and Health centre in the list as well. Places you
  had filed are sorted by their name, so Brain Clinic is now a clinic. A new
  place gets a fitting type from its name without you choosing one.
- **Two more lists split the same way.** Condition tracking has Test result
  and Scan result as separate kinds of entry, and a task can be closed as
  Blocked or as Unable to complete.

### Fixed

- **The Pare conversations list under System loads again.** It had stopped
  showing any conversations at all and only said it could not load them. It
  now lists them, leaves out empty ones, and says so when there are more than
  it shows.

## [0.28.0] - 2026-11-16

### Added

- **Use PareCare from Claude, ChatGPT, Gemini, Open WebUI and other
  assistants.** Connect the assistant you already chat with, then say things
  like "Mum took her evening tablets at 7, file it in PareCare" and it is
  saved to the right person with the same checks as Pare. Connecting is one
  copied address and a click on Allow. Choose whether it may add records or
  only look, see everything connected in one list, and disconnect any of it
  with one click. Changes to a medication list are read back for you to agree
  first, every change is marked as made by an assistant, and most new records
  can be undone for 30 minutes.
- **Clinics and the people who work there.** File a doctor at their clinic and
  they share its address, so Health Hub Morayfield is typed once, not once per
  doctor. Pick where someone works as you add them, or open the clinic and add
  the people who work there. Move or rename the clinic and everyone there
  follows. Or just tell Pare: "add Dr Carly Examplename to Health Hub
  Morayfield". Your existing providers have been grouped under the
  organisation each one named.
- **A recording guide that works with any assistant.** Whatever you talk to,
  it is taught how to log a day, an appointment or a cost so the record is
  clear later and holds up for a claim or a review. Ask it to summarise any
  period, such as the last three months before a plan review, and it pulls
  together your log, symptoms, appointments and costs with their dates. Add it
  to Gemini or Claude as a skill, or copy it into ChatGPT custom instructions
  or Open WebUI, from Connected apps.
- **Any kind of provider.** Type Neurologist, Dentist, Physiotherapist or
  whatever kind of provider someone sees, and it joins the list for next time.
  Common specialties are already there, so there is no need to pick Other.

### Changed

- App passwords for bots and scripts moved from Notifications to the new
  Connected apps screen in your account menu.
- The provider directory has sortable Works at and People here columns, and
  both provider forms ask where someone works in place of a separate
  organisation box.

## [0.27.0] - 2026-09-02

### Added

- **Editable subheader copy.** Super admins now edit the description text
  below every page heading, either inline on the page itself or from a
  centralised Site copy screen under System. Changes appear for everyone
  straight away. Profile pages support a {name} placeholder that fills in
  the person being cared for.

## [0.26.0] - 2026-09-02

### Added

- **Dismiss a notification.** Every new notification now has a dismiss control,
  and the count on the bell drops the moment you dismiss one, without leaving the
  panel or opening the page it points to. Opening or clearing notifications
  updates the count straight away too.

### Fixed

- **Pare answers again.** Pare's built-in choice of model was tied to a dated
  version that can be retired out from under it. It now always uses the current
  one, so chatting with Pare and having it read documents keep working.
- **A clear message when Pare cannot read a file.** Uploading a document while
  Pare is not set up, still getting ready, or having trouble now says so plainly
  and points to where it is put right, instead of looking as though the file
  itself could not be read. Your file is saved either way.

## [0.25.1] - 2026-08-06

### Changed

- **System settings read as a numbered checklist.** For whoever runs the system,
  the settings are now in numbered sections, most important first, with plainer
  headings and less jargon.

## [0.25.0] - 2026-08-06

### Added

- **A Pare status light.** A small traffic light in the top corner shows at a
  glance how Pare is doing: green when it is online and working well, amber when
  it is online but under load or still getting ready, and red when it is offline
  and may need attention.
- **A Pare monitor for whoever runs the system.** The Pare screen now opens with
  how Pare is running, its response time, how busy it is, how long it has been
  up, and how much it is being used and by whom, with every conversation in a
  sortable table. Empty chats are left out.

## [0.24.0] - 2026-08-06

### Changed

- **Profile and Settings are one screen now.** Your details, your photo and how
  you sign in all live under Settings, laid out in numbered sections with the
  most-used first. The separate Profile screen is gone, and its link goes
  straight to Settings.
- **Pare greets you by name.** Opening Pare starts with a friendly hello and an
  offer to help, and a nudge to type /help to see everything it can do, in place
  of the technical note that used to sit there and meant little to anyone.

### Removed

- **The Relationships feature has been removed.** It was little used and did not
  earn its place.

## [0.23.0] - 2026-08-06

### Added

- **The activity log shows when Pare made a change.** Every entry now says
  whether a person made it by hand, Pare did, or an outside assistant did, so
  the record tells you how something changed, not only who and when.

## [0.22.0] - 2026-08-06

### Added

- **Edit several people or pets at once.** Select more than one on the
  homeboard and set what they share in one go: relationship, pronouns, main
  language, and for pets their species, breed and more. Only the fields ticked
  change; the rest are left exactly as they are.

### Fixed

- **People cards stay within the screen.** A long condition name, journey or
  note now wraps inside the card instead of stretching it sideways off the
  display.

## [0.21.0] - 2026-08-06

### Added

- **Install PareCare on your phone.** Add it to the home screen and open it like
  any other app, in thumb reach in a corridor or a waiting room.
- **Capture anywhere.** One button on the phone opens a quick note or a photo
  against the person you are looking at. Write a note, with the phone's own
  microphone typing it for anyone who would rather speak, or take a photo of a
  letter, a prescription or a receipt for Pare to read and propose what to file,
  to check before anything is saved.
- **Notes save even with no signal.** A note written with no connection is kept
  on the phone and sent the moment the connection returns, and it arrives once
  however patchy the signal. A short buzz and a line confirm every save.

### Changed

- **Photos and scans are read now.** A photographed or scanned document goes
  straight to Pare to read, the same as an uploaded file, instead of asking for
  its details to be typed in by hand.

## [0.20.0] - 2026-08-06

### Added

- **What's new gathers everything happening across the people in your care.** A
  new screen brings every change across your care circles into one place, what
  needs attention first, then the rest by recency, so nothing gets lost between
  profiles. Reach it from the sidebar or the bell.
- **Alerts you set up yourself.** Under Notifications, build exactly the alerts
  you want and choose where each one goes. Watch a medication running low within
  a chosen number of days, a dose not recorded, an appointment coming up, a task
  due, a new message or document, a health change, or a medication record. Each
  arrives the moment it happens or bundled into a daily, weekly, fortnightly or
  monthly digest, sent to email or any destination you have set up. Several
  digest alerts to the same place come as one message, so a fortnightly email
  can carry supply, appointments and a medication record together, and a
  low-supply alert brings a reorder link where there is one.

### Changed

- **What's new now means your own care circle.** The developer release notes
  behind the version number are kept to whoever runs the system.

## [0.19.0] - 2026-08-06

### Added

- **Turn update notices off.** A new switch under Notifications, in what you are
  notified about, controls the quiet mark that appears when PareCare has a new
  version. It stays on by default and is kept on this device.

### Changed

- **The version number opens What's new.** Tap the version in the sidebar to
  read what has changed at any time, not only when there is a new mark waiting.

### Fixed

- **A new version now always announces itself.** After an update, the quiet
  What's new mark appears as it should, instead of staying hidden for people who
  came straight to the newest version.

## [0.18.0] - 2026-08-05

### Changed

- **The overview leads with what matters for each person.** Without anyone
  arranging anything, the current health card rises to the top when someone is
  unwell, and the power of attorney comes forward once care has ended. Arrange
  the cards yourself and your own arrangement is kept exactly as you left it; the
  two never fight. The overview cards also match the sidebar now, so an expected
  arrival or an infant is not shown Substance use.

## [0.17.1] - 2026-08-05

### Changed

- **A tidier sidebar and account menu.** The foot of the sidebar now shows just
  the version, with What's new appearing there only when there is something new
  to read rather than sitting as a permanent link. The light and dark switch, the
  text size control and Sign out have moved into the menu under your profile
  picture.

## [0.17.0] - 2026-08-05

### Changed

- **Each person is shown only the sections that fit them.** A pet no longer has
  Neurotypes or Substance use in its sidebar or on its overview, and an expected
  arrival or an infant is not offered Substance use. PareCare works this out from
  who the person is, with nothing to turn off.
- **The command bar has been taken out.** The keyboard jump-to-anything bar added
  recently overlapped the person switcher and the assistant without clearly
  helping, so it is gone. The person switcher at the top of the screen and Pare's
  own button cover the same ground more simply.

## [0.16.0] - 2026-08-05

### Added

- **Find or do anything from one place.** A command bar opens from the bar at the
  top of any screen, or with a keystroke on a computer. Type a few letters to
  jump straight to a person, a section, a record, or an action like recording a
  dose or booking an appointment, without hunting through menus. Open it before
  typing and it shows what needs attention first, so the first thing it offers is
  what to do next.

### Changed

- **There is now one way to ask Pare, not two.** The separate Ask PareCare page
  has folded into the assistant that sits on every screen and already knows whose
  profile is open, so asking is the same wherever you are.

## [0.15.0] - 2026-08-05

### Added

- **Make the text bigger.** A text size control sits next to the light and dark
  switch in the sidebar. Three steps, starting from the size your device already
  uses, so PareCare can be larger than the rest of your phone when you need it.

### Changed

- **PareCare now follows the comfort settings on your device.** When your device
  asks for less motion, movement stops. When it asks for more contrast, edges and
  quiet text firm up. Nothing to turn on; it matches what you have already set.

### Fixed

- **Voice typing works again when talking to Pare and writing messages.**
  Dictating a note no longer cuts off part way through or sends before you have
  finished, so the words you speak are the words that are saved.

## [0.14.0] - 2026-08-05

### Added

- **Choose and download the on-machine assistant from settings.** In System
  settings the person running PareCare now sees which model is in use and what
  it is called, switches to another that is already downloaded, or fetches a new
  one by name or a Hugging Face link, without editing any files.

## [0.13.0] - 2026-08-04

### Added

- **Pare now runs on your own machine.** A private assistant is ready from the
  first start, with nothing to set up and nothing leaving your machine. The
  right assistant for your machine is chosen for you: a larger, more capable one
  where there is power for it, otherwise a smaller one that still reads text and
  images. Pare says in one line which one is in use, and that stays changeable.
- **Pare says when it is still getting ready.** On the first start the assistant
  can take a while to prepare itself. Instead of an error, Pare now says it is
  still getting ready and that everything else works in the meantime.

### Changed

- **Pare records what you ask it to, more reliably.** The assistant can no
  longer garble what it is recording, so a dose or a note you ask Pare to log is
  saved as you meant it, even on the assistant that runs on your machine.
- **A long reply is given the time it needs.** A thoughtful answer from the
  assistant on your machine is no longer cut off part way through, and a request
  that never arrives now says so instead of waiting forever.

## [0.12.5] - 2026-07-30

### Fixed

- **A care plan that fails to generate now says so where you are looking.** The
  message appeared on the screen behind the open window, so the person who had
  just pressed Generate saw nothing happen at all.

## [0.12.4] - 2026-07-30

### Fixed

- **Sorting the conditions table now works one way rather than two.** The sort
  chosen from the toolbar and the sort shown on the column headings were
  separate, so choosing one left the other showing something else. They are now
  the same control, and Resolved, Codes and Treatments sort as well.

## [0.12.3] - 2026-07-30

### Fixed

- **The calendar now goes as far ahead as the appointments in it.** Moving to
  any future month was blocked, so an appointment booked for next month, or
  next year, could not be seen on the calendar at all. It now moves forward and
  back without limit.

## [0.12.2] - 2026-07-30

### Fixed

- **Make an appointment and Add a treatment now go where they say.** Under a
  condition on someone's overview, both links led nowhere. They now open the
  appointments and treatments screens for that person.

## [0.12.1] - 2026-07-30

### Fixed

- **The contact details card no longer sits empty with nothing under it.** When
  no phone number, email address or address has been recorded for someone, the
  card now says what it is for and offers one button to fill it in, rather than
  showing a heading over blank space.

## [0.12.0] - 2026-07-30

### Changed

- **The app downloads less before it will open.** Opening PareCare used to pull
  down every screen in it, including all the administration screens most people
  never see. It now fetches the screen being opened and keeps the rest until
  they are asked for, which cuts what has to arrive first by about a third.
  This is most noticeable on a phone and on a slow connection.
- The parts that rarely change are now kept by the browser between releases,
  so an update downloads only what actually changed.
- While a screen is still arriving, the navigation and the headings stay on
  screen and only the part still coming says so.

## [0.11.1] - 2026-07-30

### Fixed

- **The arrangement of a person's overview is now kept for that person alone.**
  Folding cards away or moving them around used to change the overview for
  everybody in your care at once, and two people signing in on the same computer
  overwrote each other's arrangement. Each person's overview is now remembered
  separately, for each carer. Existing arrangements start again from the
  standard order once.
- Pare's summary on a card no longer rewrites itself every time the card is
  folded away and opened again.

## [0.11.0] - 2026-07-30

### Added

- **Copies of everything are made from the day you install.** Nothing to set up
  and nothing to remember: a copy of every record and every uploaded document is
  taken automatically. Change how often they are taken and how long they are kept
  under Backups, or leave it alone and it looks after itself.
- **Keep a copy off this server.** Connect Google Drive or Dropbox and every copy
  is kept there as well as here, so the records survive the server being lost.
  Anyone who already has their own storage may use that instead. PareCare only
  ever sees the files it puts there.
- **A walkthrough for connecting Google Drive and Dropbox**, one step at a time,
  with the address they need to be given shown ready to copy, so setting one up
  never means holding two values and hunting for another screen.
- **Put a copy back.** Choose a copy and restore everything as it was on that
  day. A copy of how things are right now is taken first, so restoring the wrong
  one is itself undoable.
- **Test a restore.** This makes a practice copy of everything, deletes every
  record and every document file in it, puts it all back, and compares what
  returned with what was there. Real records are never touched at any point. The
  result names real records out of the copy and shows each one found, then gone,
  then back with every field identical, and the full report saves to a file.
- **Three levels showing how protected the records are**, worked out from what
  has actually happened rather than from anything ticked: copies are being made,
  a copy lives somewhere else, and a restore has been proved.
- **Forgotten your password.** A link on the sign-in screen sends a way back in
  by email. It works once, lasts an hour, and choosing a new password signs out
  everything else signed in as you, on every device.
- **Pare does more of the work.** Ask for an appointment and it goes on the
  calendar as an appointment rather than a note. Pare also records a medication
  as given straight into the medication record, closes a task, records a cost,
  and records a reading such as a blood pressure or a blood sugar.

### Changed

- Backups are reached by an administrator as well as a super admin, so one
  person being away is never the difference between having the records and
  losing them.
- The Backups screen says plainly when copies exist but have never left this
  server, rather than calling that protected.
- Copies stop before they fill the server, and say so, instead of taking the
  machine down with them.

### Fixed

- The app no longer becomes unreachable after the server is updated.

## [0.10.0] - 2026-07-28

### Added

- **Wi-Fi on an address.** An address now records the network name and the
  password, each its own field, so a carer arriving at the house can get online
  without hunting for the router. The network name is a sortable column in the
  address directory and both fields are in the import and export. The password
  is stored encrypted and only shown when asked for.
- **Secrets**, a vault under Documents for the logins kept for someone's life
  admin: social accounts, the rental, the bank. Each login records its name,
  kind, website, who you sign in as, the password, the account number and
  notes, every fact its own field. Passwords are stored encrypted and masked
  until revealed, with a control to copy one without showing it.
  - Access is deliberately narrow: **the account owner only**. Carers, editors
    and viewers in the care circle never see the section, and neither do
    platform administrators or super admins. A **power of attorney** in the
    care circle gains access **once a date of death is recorded**, since
    settling an estate means getting into the accounts.
  - A **date of death** field on a person's details, which is what hands the
    vault to a power of attorney.
- **Per-condition tracking.** A condition under Current health now carries its
  own thread, so something long-running can be followed on its own instead of
  being hunted for across the whole care log. An ankle sprained in March that
  still hurts in July keeps together:
  - its **own tracking log**, separate from the care log, with each entry typed
    as a note, a change in symptoms, a treatment, what came of an appointment,
    or a test or scan result;
  - the **appointments** booked under it. An appointment records what it is
    for, and the calendar marks it with the condition;
  - the **documents** filed against it, such as a scan report or a medical
    certificate, chosen when the document is uploaded;
  - the **therapies** being done for it.
  Appointments, documents and therapies still live in their own sections; the
  condition shows the same records from its own side.
- The assistant can add to a condition's tracking log (a new `log_condition`
  action), so "note that his ankle is still sore going down stairs" files
  itself under the ankle.

## [0.9.0] - 2026-07-23

### Added

- **A people switcher in the middle of the top bar.** Search across everyone in
  your care and jump straight to a person or pet, without first returning to the
  All people list. The current profile is marked and listed first.

### Changed

- **A consistent icon for every record action across the app.** Edit, Delete,
  Remove, Unlink, Link, Dismiss and the add-or-edit-note action on rows and
  cards are now the same small icons everywhere, in the directories (People,
  Pets, Providers, Suppliers, Assets, Addresses), throughout a person's record
  (Conditions, Allergies, Neurotypes, Treatments, Substance use, Care needs,
  Appointments, Documents, Medication record, Care circle, Care plan access,
  Questions, Logs, the current-health and managed-with panels), on the
  Homeboard's needs-attention items, in notification settings and the upload
  review, and on the admin screens. Each icon keeps a tooltip and a spoken
  label naming the record it acts on, and every icon still means one thing:
  a pencil edits, a bin deletes, a cross removes or dismisses, a broken chain
  unlinks, a chain links.
- Buttons that confirm an action in a dialog, and actions that work on a whole
  selection at once, keep their words, so the meaning stays clear where it
  matters most.
- **Every left-hand section of a person's record now has its own icon**, from
  Overview and Care journey through Conditions, Medications and the Medication
  record to Messages, Questions and Ask PareCare, so the navigation reads at a
  glance and matches the icons already used in the Directory.

## [0.8.0] - 2026-07-22

### Added

- Uploads filed with Pare are now **reviewed and edited before saving**: each
  proposed record is an editable card, so an imprecise vendor or a wrong address
  can be corrected or dropped before it is committed.
- **File with Pare** from more places: a paperclip in Pare's chat composer, and
  a button on the out-of-stock, reorder and appointment-cost attention items
  where a receipt or invoice belongs.
- **Equipment that manages a condition is now a real asset.** Under a condition,
  a device draws from the asset register (pick an existing one, autofilling its
  details) or adds a new one with the same asset editor, and links the equipment
  to the condition it treats.
- Under a condition, a **surgery** now opens the make-appointment editor to
  book it properly, prefilled as a procedure, rather than sitting as a flat note.

### Changed

- The assistant checks a document's addresses against the addresses already on
  file, so the person's own "invoice to" address is not filed as a vendor.

## [0.7.0] - 2026-07-22

### Added

- **Upload and file with Pare**: upload any document, invoice, care plan or
  business card and the assistant reads it, says what it is, and proposes what
  to file into the person's record. Nothing is written until you confirm. A tax
  invoice for a CPAP machine, for example, becomes an asset with its make and
  model, serial number, price, purchase date, supplier and warranty, linked to
  the person. The source file is kept in the document repository.
- The assistant can now **file equipment into the asset register** (a new
  add_asset action) and link it to a profile, on its own or from an upload.

## [0.6.0] - 2026-07-22

### Added

- **Accounting on health spend**, so the ledger can be reconciled and claimed
  against. Each cost can carry the tax (GST or VAT) component split out from the
  total, a funding source (self, NDIS, private health, Medicare, government), an
  account code, how much is claimable, its claim status (unclaimed, submitted,
  reimbursed) and how much has come back.
- The Health spend card now shows the **net out of pocket**, what has been
  **reimbursed**, and the **claims still outstanding**, alongside the total and
  the category split, over a Last 12 months, This year, **This financial year**,
  or All time view.
- **Receipts**: attach a receipt or invoice to any cost, and download it later
  as evidence for a claim or the tax return.
- **Export for accounting**, a CSV of the confirmed costs over the chosen window
  with the tax split out and the claim and reimbursement columns, ready for a
  spreadsheet or accounting software.
- Two enriched reports: **Health spend** now includes tax, reimbursed, net and
  outstanding, and a new **Health spend claims** report lists what is claimable,
  reimbursed and outstanding by funding source.
- **Asset depreciation**: an asset can carry a useful life, and its straight
  line yearly write-down and current **book value** are worked out from the
  price and purchase date, shown in the register and the export.
- A **financial year start month** in System settings (default July), used by
  the financial-year view and the accounting export.

## [0.5.0] - 2026-07-22

### Added

- **Assets**, a new Directory section for the equipment kept for someone's
  care: a wheelchair, a hoist, a bed, a monitor. Each asset records its unit
  name, category, serial or unit number, make or model, price, purchase date,
  where it was bought, warranty expiry, condition and location, every fact in
  its own field.
- Assets sit in the **Directory** beside People, Pets, Providers, Suppliers and
  Addresses, with the same tools: search, sort, edit, delete, bulk edit and
  delete, bulk import and export, and the same **link-to-profiles** flow, so a
  piece of equipment can be tied to the person or pet it belongs to.

## [0.4.0] - 2026-07-22

### Added

- **Health spend tracking**, built as a ledger of real costs rather than a
  projection. Every amount is a dated entry, so spend over any period is just
  the entries in that window.
- A medication's cost is recorded **when a repeat is replenished**: the "repeat
  arrived" step now takes what it cost, logged and dated to the day it arrived.
- An appointment or therapy takes an **estimated cost when it is booked** and a
  confirmed **actual cost afterwards**. Until it is confirmed, the estimate is
  kept apart and does not count towards spend, and the Homeboard's
  needs-attention list prompts you to log what a past appointment actually
  cost.
- A one-off cost (a mobility aid, a dental bill) can be **added by hand**.
- A **Health spend** card on each person's overview, for the account owner and
  admins only, with a Last 12 months / This year / All time switch, the total
  and its split into medications, appointments and other, and every dated
  entry.
- Two **date-range reports**: Health spend (per person, by category) and Health
  spend, itemised (every entry), so costs roll up across everyone in your care
  over whatever range you choose.
- A **currency** setting in System settings, under a new Health spend group,
  used across the whole account.

## [0.3.0] - 2026-07-22

### Added

- An **as needed** checkbox on the add and edit medication form, for a
  medication with no set schedule (a painkiller, or diazepam taken when
  required). It sits in the as needed group and a dose is logged when taken.
- A tracked **reorder workflow** for a medication running low: depleted, then
  ordered, then replenished. Mark a low medication ordered when a repeat is
  requested, and replenished when it arrives (which tops the supply back up).
  A repeat ordered but **not replenished after five days** is raised as an
  urgent item on the Homeboard's needs-attention list.
- A **normal level** (baseline severity) on a condition, on the 1 to 10 symptom
  scale. Everyone is different: if someone's chronic condition sits at a 6 or 7
  every day, that is their normal.

### Changed

- Health alerts now respect a condition's normal level. An alert is raised only
  when a symptom rises above the person's normal, not at a fixed threshold, so a
  chronic condition that sits high every day no longer alarms at its usual
  level. A condition without a normal level still follows the standard
  above-moderate rule.

## [0.2.0] - 2026-07-21

### Added

- **Suppliers**, a shared account-level directory of the pharmacies and shops
  medications are reordered from, kept separate from care providers but
  mirroring them field for field: name, phone, email, the same segmented
  address filled by the type-ahead address finder, and a reorder link. Two
  branches of one vendor are told apart by suburb as "Vendor (Suburb)".
- Suppliers surfaced in the **Directory** alongside People, Pets, Providers and
  Addresses, with the identical tools: search, sort, edit, delete, bulk edit
  and delete, and the same Link-to-profiles flow (a supplier can be linked to
  any person or pet). The list also shows how many medications use each one.
- The **Add/Edit medication** editor picks its supplier from the shared list,
  autofilling the reorder link, and can create a new supplier inline, with the
  same address finder.
- **Add person / Add pet** buttons on the People and Pets directory pages,
  pre-selecting the kind on the new-profile form.
- **Bulk import and export** (CSV and JSON, with a blank template) on every
  Directory sub-item: People, Pets, Providers, Suppliers and Addresses.
- A **sort dropdown on every top-level nav group** (Directory, Tools, Pinned):
  default, A to Z, Z to A, or a custom manual order. The dropdown is theme
  aware, following light, dark or device mode. Custom order shows move controls
  and a tick to lock the order in place.
- **Small icons** for each Directory nav item.
- A **versioning system**: the sidebar shows the app version linked to the
  build's commit, next to a "What's new" link that opens an in-app Updates page
  (`/app/updates`) rendering these notes, so the record of updates is visible
  inside the app, not only in this file.

### Changed

- Medication row actions (Record dose, Order, Edit, Delete) are now compact
  icons with tooltips. The reorder (cart) icon appears on a medication only
  when its supply drops under five days and it has a supplier reorder link, so
  it means "reorder now" rather than being a permanent fixture. The low-supply
  threshold is now under five days (was a week).
- Suppliers gain a directions link (a map link to the shop) alongside the
  reorder link, matching a provider's directions link, in both the directory
  editor and the inline add-supplier form, and in import/export.
- **Bulk edit selected medications**: an "Edit selected" action applies one
  change (supplier, route, taken with food, dangerous to miss, active status)
  to every selected medication at once.
- Sortable table headers now show a faint sort arrow at rest (brighter on
  hover), so every sortable column reads as clickable instead of looking like
  static text. Applies to every sortable table, including the medications list.
- **Sign out** moved from the top-right account menu to the sidebar footer,
  beside the theme picker.

## [0.1.0]

- Initial PareCare platform: care profiles, medications and the medication
  record, conditions, providers and addresses directories, care plans, the
  assistant, reports, and account and subscription management.
