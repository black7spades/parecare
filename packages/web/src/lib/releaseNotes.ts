/**
 * The on-site record of updates, rendered by the Updates page and linked from
 * the sidebar version badge. Kept in step with CHANGELOG.md in the repo root.
 * Plain language only, no jargon, no parentheses in headings, no em dashes,
 * per the UI copy rules.
 */

export interface ReleaseGroup {
  heading: string;
  items: string[];
}

export interface Release {
  version: string;
  /** ISO date, or empty for the original release. */
  date: string;
  summary: string;
  groups: ReleaseGroup[];
}

export const RELEASES: Release[] = [
  {
    version: '0.53.1',
    date: '2026-11-24',
    summary: 'Repeating tasks come round again wherever they are ticked, and journey steps that need a service give its number and website.',
    groups: [
      { heading: 'Fixed', items: [
        'Repeating tasks come round again. Ticking a repeating task, such as the yearly flu shot, marks it done for this round and moves it on to its next date, wherever it is ticked: the Tasks page, ticking several at once, the task panel, a journey step or Pare. The screen says when it is next due, with Undo, and the task keeps a list of each time it was done and by whom. Its journey step reads done for this round with the next date. When the next round comes due, the step opens again. Choosing No longer needed stops it repeating.',
        'Steps that need a service give its number. Journey steps whose next move is to contact a national service show the number to call and the service\'s website: My Aged Care, with its find a provider page, Services Australia for the financial assessment, the NDIS, Carer Gateway, Dementia Australia, Lifeline, Beyond Blue, Kids Helpline, PANDA, the Australian Breastfeeding Association, the Butterfly Foundation and the National Alcohol and Other Drug Hotline.',
      ] },
    ],
  },
  {
    version: '0.53.0',
    date: '2026-11-24',
    summary: 'Journeys that act: every step books, adds a task, uploads, calls or opens the form it needs, with a date, who is doing it and repeats.',
    groups: [
      { heading: 'Added', items: [
        'Journey steps do the job. Each step on a care journey has the one thing that gets it done. Book it opens the booking form already filled in, with their GP or the right kind of contact. Add a task sets a date. Upload files the paper in the right category. A step with a number shows it to tap and call, with Done. A step about equipment, a hospital stay, a move into care, a funding plan or a test result opens that form, and a step that happens on another page opens it.',
        'Due, who is doing it and repeats. Any step can have a date, the person doing it and how often it repeats, such as the over 75 health check every year. It becomes a task that reminds them, and ticking either one ticks the other. A step that repeats comes round again on its next date.',
        'Steps say what was done. Once a step is done from the journey it says so: Booked for the day, Uploaded the document, or Added the record, each a link to open it.',
        'Numbers in journeys can be tapped. Phone numbers in a step, such as Quitline 13 7848 or the Carer Gateway, are links to call.',
        'Every journey checked. All 49 journeys were gone through so no step that asks for something is a dead end.',
        'Your own steps work too. A step added by hand, such as Book the dentist or Call Lifeline 13 11 14, works out what to do from its words.',
      ] },
      { heading: 'Changed', items: [
        'Journeys say the person\'s name. The journey page says Dorothy\'s care journeys, and Your care journeys on your own profile.',
        'Booking keeps a repeating task going. Booking a yearly check from its task moves the task on to next year instead of ending it.',
        'Deleting a step has Undo. Deleting a step from a journey waits a few seconds with Undo.',
        'Suggested reminders join the journey. Adding a suggested reminder, such as the health check for people 75 and over, puts the repeating task on the matching journey step.',
        'Journey library editing. Whoever runs the system can set what each step in the library does, who to book or call, the number, the document category, the page to open, how many days after the phase starts it is due and how it repeats.',
      ] },
    ],
  },
  {
    version: '0.52.1',
    date: '2026-11-24',
    summary: 'Tappable therapist phones, late reports asked for today, names instead of relationship words, and record links that stand out.',
    groups: [
      { heading: 'Fixed', items: [
        'Therapist phones can be tapped. On the Funding page, each therapist\'s phone in Reports for the review is a link to call, the same deep green as everywhere else. The report tasks and the link to the progress report look like links too.',
        'Late reports are asked for now. When six weeks before the review has already passed, the report tasks are due today, not on a day already gone, and the Funding page says "Reports are overdue, ask now". A report task left past its day shows as overdue.',
        'Names, not relationship words. Funding, Equipment, Test results, Where they live and the move into care form say the person\'s name, such as Oliver\'s plan or What Dorothy uses, and "your" on your own profile.',
        'Record links stand out. Links to records, such as a result to talk about at an appointment or a task linked to equipment, use the deeper green link style.',
      ] },
    ],
  },
  {
    version: '0.52.0',
    date: '2026-11-24',
    summary: 'Life events: hospital stays that pause medicine reminders, test results at the next visit, funding plans, equipment on loan, moves into care, suggested reminders and the roster.',
    groups: [
      { heading: 'Added', items: [
        'Where they live. A new page shows the home they live in now, the home they left, their hospital stays and their moves into care. On your own profile it is called Where I live.',
        'Hospital stays. Record a hospital stay with the hospital, the day they went in, the ward, the treating team and why. While the stay is open, medicine reminders, low supply alerts and the medication record\'s due doses pause, because the hospital gives the medicines. Every page of the person says where they are, with Record the discharge.',
        'Record the discharge. Say the day they left, pick or upload the discharge letter, and say how many days to see the GP. PareCare adds a task to see their GP within those days and a task to look over the care plan, and files the letter against the stay. After two weeks in hospital PareCare asks whether they are still there, and a dose recorded at home asks whether they are back.',
        'Test results. Record what a test showed, each measure on its own line with its unit, normal range and whether it is low or high. A result is tied to the test appointment and shown at the next visit with whoever ordered it, under Results to talk about. Recording a result ticks off the Results to chase step.',
        'Funding. Keep an NDIS plan, Support at Home or a Home Care Package with its dates, how it is managed, the plan manager, support coordinator and Local Area Coordinator, and its budgets. A cost can count against a budget, so each budget shows what is spent and what is left. Before the review, each therapist gets a task to ask for their progress report, due six weeks before. The NDIS progress report opens on the plan period, with the care log, appointments and spend.',
        'Equipment. Each person has an Equipment page. Equipment can be owned, on loan or hired, with the day it goes back and the day it is due a service, and each makes a task in good time. An Equipment to get step has Add to equipment.',
        'Move into care. Record the care home, the room, the day they moved in, the agreement and cooling-off, how the room is paid for and by when, and notice dates. The care home becomes where they live, the old home is kept as their previous home, their care journey moves on, and tasks are added for the cooling-off and the payment decision.',
        'Suggested reminders. Tasks suggests the yearly and six-monthly checks worth not forgetting, by age and conditions: the flu shot, the health check for people 75 and over, a GP management plan review, dental and eye checks, and the driver\'s licence medical. Add makes a repeating task. Dismiss sets one aside, with Undo.',
        'The roster. Tasks can be shown as a roster: who does which repeating task on each day of the week.',
      ] },
      { heading: 'Changed', items: [
        'Only places in the place pickers. Choosing where someone lives, a hospital or a care home lists only hospitals, care homes and similar places, never the GP or the pharmacy.',
        'Reminders reach everyone. A task assigned to someone added by name is emailed to them. With no email on file, the reminder goes to whoever manages the profile with their phone number to ring.',
        'Care journeys move forward the same way everywhere. A phase change from Pare goes through the care journey, the same as on screen.',
      ] },
      { heading: 'Fixed', items: [
        'Save on a cost always answers. With no amount typed, Save says what to write instead of sitting greyed out.',
      ] },
    ],
  },
  {
    version: '0.51.0',
    date: '2026-11-21',
    summary: 'Emergency and sending information out: ID numbers, a fuller emergency sheet shared by link, reports and appointments sent to someone, and a calendar feed that helps you get there.',
    groups: [
      { heading: 'Added', items: [
        'ID numbers. Edit profile has an ID numbers tab with a box for each number: Medicare with the position on the card and the valid to month, the Individual Healthcare Identifier, DVA with the card colour, NDIS, the health fund and member number, and My Aged Care. Each number is checked. One that does not look right says what it should look like, and the rest still save.',
        'How bad an allergy is. Each allergy says how bad the reaction is: mild, moderate, severe or life threatening. An allergy that causes anaphylaxis is marked life threatening without being asked.',
        'No known allergies is a checked answer. With no allergies on file, No known allergies records who checked and when. Adding an allergy clears it.',
        'Eating and drinking safely. Care needs has a list for what keeps eating and drinking safe, such as sitting upright or thickened fluids, beside diet and mobility.',
        'A fuller emergency sheet. The sheet now runs in the order a paramedic needs it: who this is, where they are, ID numbers, allergies with how bad, conditions they have now, medicines, eating, drinking and moving, the advance care directive with its document, power of attorney holders with their phone and document, who to call, and every professional and organisation. Every phone on it can be tapped to call. The same sheet prints in bulk from the Homeboard.',
        'Share the emergency sheet by link. Share a link gives a link that opens the sheet with no login, for a paramedic, a hospital or family. It shows how many times it has been opened and keeps working until it is turned off, with Undo straight after.',
        'Save on this phone. The emergency sheet keeps a copy on the phone, so it opens with no internet.',
        'Send a report. A report for one person can be sent to a contact, someone in the care circle or any email, with documents such as a referral sent with it. It opens with no login for 30 days. Documents shared only with some people in the circle are never sent.',
        'A fuller health summary. The health summary now includes their GP and contacts, appointments coming up and from the last year, open questions, and who to call in an emergency, each detail in its own column.',
        'Send an appointment. Send to someone sends one appointment, such as to whoever is driving: the time, the place, the contact\'s phone, what to bring and how to get ready, with the calendar entry attached. Notes stay private. Add to my calendar puts it in your own calendar.',
      ] },
      { heading: 'Changed', items: [
        'A calendar feed that helps you get there. Appointments in the calendar feed show the place, who it is with and their phone, what to bring, how to get ready, a link back into PareCare, and reminders a day before and two hours before. Finished tasks stay on the calendar marked Done.',
        'Files that read plainly. Downloads write dates as dates and phases as the screen names them, such as Residential ongoing. The medicines file now keeps how often, whether it is critical, the condition it is for and the prescriber\'s phone, and reads every column back in, so nothing is lost on the way round.',
        'Reports without Pare. With no Pare attached, the report builder makes the tables on its own and the AI summary choice is not offered. Generate report and Send always say what is missing instead of greying out.',
      ] },
      { heading: 'Fixed', items: [
        'Task notes stay private. The calendar feed no longer sends out task notes or appointment notes.',
        'Who to call in a report. Emergency contacts in a report have a column each for name, relationship, phone and email.',
        'Save on an allergy always answers. With nothing typed, Save says what to write instead of sitting greyed out.',
      ] },
    ],
  },
  {
    version: '0.50.1',
    date: '2026-11-20',
    summary: 'Clearer allergies, a safer Who said so, scheduled doses counted on their own, and Raise question that always answers.',
    groups: [
      { heading: 'Fixed', items: [
        'Allergies read clearly. Each allergy shows on its own, with the reaction after it, such as Penicillin: rash, so a reaction never reads as a second allergy. This is on the medicine round, Before you start and the medication record. Emergency sheets label the Allergy and Reaction columns.',
        'Who said so picks before it adds. Typing part of a name on Record a change offers the matching contacts first. A new contact is only filed after choosing Add as a new contact.',
        'The medication record counts scheduled doses only. As-needed doses no longer count towards the scheduled doses given. They show on a line of their own.',
        'Raise question always answers. With the question box empty, Raise question now says what to write instead of sitting greyed out.',
      ] },
    ],
  },
  {
    version: '0.50.0',
    date: '2026-11-20',
    summary: 'The shift: Before you start, the medicine round, as-needed limits, and a home full of residents found, printed and invited at once.',
    groups: [
      { heading: 'Added', items: [
        'Before you start. Someone starting a shift sees, on one card, what not to give, the GP, who to call in an emergency, the doses due now, how the person eats, moves and talks, and the last handover with who wrote it. It leads for helpers and comes second for the person who manages the profile, with Start the medicine round and Write a handover.',
        'The medicine round. Every dose due from two hours ago to two hours ahead, for everyone you give medicines to, grouped by room. Each dose is one tap: Given, Refused with why, Not in stock, or More for the full form, and each can be undone.',
        'As-needed medicines say their limits. An as-needed medicine keeps what it is for, the least hours between doses and the most in 24 hours, worked out from the instructions when nobody typed them. The medication record shows when it was last given, by whom, and how many in the last 24 hours.',
        'A dose given too soon asks first. A dose inside the gap or over the most in 24 hours shows a red notice with Wait until, or Give it now with why it must be given now. It never stops a dose. An as-needed dose asks why it is needed now.',
        'Not in stock. A dose with none to give is its own outcome. The person managing the profile is told, with the pharmacy to call.',
        'Helpers record a change. A support worker or nurse records a new dose or new times a doctor asked for, with why and who said so, and marks a repeat as ordered or arrived. Adding or deleting medicines stays with the person who manages the profile.',
        'Who wrote it. Every care log entry and every reply to a question shows who wrote it and when.',
        'Find anyone in a home. The Homeboard has a search by name or room, and the table has Room, GP, GP phone, Next of kin, Relationship and Next of kin phone columns, all sortable. The People directory has the same columns.',
        'Emergency sheets in bulk. Choose several people on the Homeboard and print their emergency sheets in one go, one to a page.',
        'One invite for many people. Choose several people on the Homeboard and invite one new carer to all of them. They accept once and see everyone.',
        'Bring residents in by spreadsheet. The people spreadsheet has Room, GP name, GP phone, GP practice and Next of kin columns. Importing it files each GP in Contacts and links them, and anyone who may add a person may import.',
      ] },
      { heading: 'Changed', items: [
        'Doses not yet recorded, once. When several people have doses not yet recorded, Needs attention shows one row that says how many people, with Start the medicine round. Show who opens the detail for each person.',
        'Without Pare. On these screens, when no assistant is attached, the Pare buttons step aside and the plain next step shows instead, such as Mark as ordered on a medicine that has run out.',
        'The medication form has Instructions. Instructions now save, and an as-needed medicine has What it is for, Hours between doses and Most in 24 hours.',
      ] },
    ],
  },
  {
    version: '0.49.1',
    date: '2026-11-20',
    summary: 'Documents link both ways: Attached to opens each record, and a letter lists the medicines it changed.',
    groups: [
      { heading: 'Fixed', items: [
        'Attached to looks like links. On a document, each record under Attached to now shows as an underlined link in the same green as phone numbers and emails, so it is clear that tapping one opens that record.',
        'A letter lists the medicines it changed. When a medicine change, stop or start says it came from a letter, the letter now lists that medicine under Attached to. Changes already recorded are linked too.',
      ] },
    ],
  },
  {
    version: '0.49.0',
    date: '2026-11-20',
    summary: 'Documents follow the work: dates on every letter, referrals that warn before they run out, and a history for every medicine.',
    groups: [
      { heading: 'Added', items: [
        'Dates on every document. A document has a Date written and a Valid until, each in its own box, with Does not expire. The documents list has Date written, Valid until and Attached to columns, and a document that has run out says so.',
        'Referrals work out their own dates. A GP referral lasts 12 months and a referral from a specialist lasts 3 months, counted from the first visit with the specialist. Until that visit is booked, it counts from the date written. The referral says how its date was worked out, with Change.',
        'A reminder before a referral runs out. Six weeks before, a Get a new referral task appears with the GP and the letter attached. It moves when the date moves.',
        'Who a letter is from and who it is to. Each document can name who wrote it and who it is addressed to, picked from Contacts or added with their phone. A referral offers Book appointment with whoever it is to.',
        'What a document is attached to. Every document lists the tasks, appointments, medicines and other records it belongs to, and each one opens that record.',
        'New document categories. Referral, Prescription, Test request, Results, Letter, Service agreement and Behaviour support plan. A category with one of these names already becomes the built-in one, so nothing is listed twice.',
        'A history for every medicine. Changing a dose or the times asks why it changed and where the change came from: a recent visit or a letter on file. Each medicine lists its changes, newest first.',
        'Stop a medicine properly. Stop this medicine asks for the last day taken, why it stopped and anything in their words, then offers Undo. A stopped medicine offers Start again.',
        'Courses that end. A medicine can have a last day of the course. After that day its doses are no longer due, and it asks Stop it or Still taking it. Repeats left on the script has its own box.',
        'Pare files more from a letter. Everything Pare files from a letter is attached to it. A referral is filed with who wrote it and who it is to, with their phone, and joins the task already open for booking them. A letter that changes or stops a medicine already on the list changes it, with the reason, rather than adding a second copy. Pare also books appointments from booking letters with the letter to bring, and adds conditions, allergies and costs.',
        'Long letters and scans. Pare reads a long letter part by part instead of stopping partway. When Pare uses Claude it reads scanned pages too; on other AI services it says plainly to photograph the pages.',
        'Two new Pare commands. /stop for a medicine to stop and why, and /change for a medicine change and why.',
      ] },
      { heading: 'Changed', items: [
        'The Supplier column names the main pharmacy. A medicine with no supplier of its own shows their main pharmacy, marked Main pharmacy, and sorts by it.',
        'Inactive medicines are now stopped. The list says stopped, and Stop these medicines on several at once keeps each stop in its history.',
        'A next step\'s document belongs to its visit too. Attaching a document to a task that came from an appointment attaches it to that appointment as well.',
      ] },
      { heading: 'Fixed', items: [
        'Save on Edit document and Change category now says what is missing, instead of being greyed out.',
        'Read the document and File without reading now say when no file is chosen.',
        'A medicine Pare adds or changes keeps its dose amount and measure in their own columns.',
      ] },
    ],
  },
  {
    version: '0.48.0',
    date: '2026-11-20',
    summary: 'A contact on every record: who prescribes, who treats, who supplies, who to call in an emergency, and alerts that name the number.',
    groups: [
      { heading: 'Added', items: [
        'Who prescribes each medicine. A medicine says who prescribes it and the visit it started at. The medications list has Prescribed by and Repeats due columns, and a medicine shows its prescriber with a phone to tap and Book a visit for scripts.',
        'Reorder in one tap. A medicine running low offers Order online, Call or Email for its pharmacy, with the repeat request already written, then Mark as ordered. With no pharmacy on file it says so and offers Add a pharmacy.',
        'Alerts say who to call. A low or empty medicine names the pharmacy and its number, and an overdue task names who it is with. Each alert opens the record itself and offers the next step: call, email, order online or book.',
        'Who treats it, who provides it, who supplies it. A condition can name who treats it, a treatment who provides it, and equipment its supplier, each with a phone to tap. Book an appointment for this on a condition books with whoever treats it.',
        'More ways to reach a contact. Contacts have an after-hours phone, a fax and opening hours, a row per day with Same hours Monday to Friday. A contact based at a clinic uses the clinic\'s when theirs are empty.',
        'Main GP and past contacts. The first GP and first pharmacy are the main ones, with Make main to change it. No longer seeing them moves a contact to past contacts from a date you choose, and Seeing them again brings them back.',
        'Emergency contacts picked, not typed. Choose who to call from you, the care circle or Contacts, and their phone comes from their own record, so a changed number changes everywhere. Arrows set who to call first. With nobody chosen, the person who looks after them is worked out from the profile, with Change.',
        'Your phone. Add your phone once, in Settings or from your own row in the care circle, and it shows wherever you are picked.',
        'New kinds of contact. Plan manager, Local Area Coordinator, Behaviour support practitioner, Care coordinator, Pharmacist, Teacher and Teacher aide, plus Respite service and Plan management provider for organisations. Someone saved under a school is filed as a teacher.',
        'Support worker and Nurse. Two new roles in the care circle and in invitations.',
        'A care plan reviewer from Contacts or the circle. Invite someone already on file to review the care plan, and their email comes from their own record. The plan shows who supports each condition with their phone, read live.',
      ] },
      { heading: 'Changed', items: [
        'Home cards say whose phone it is. A daughter, the care home, the GP or the person\'s own phone, with the name above the number. The GP has a row of their own.',
        'Phone numbers look tappable. Phone numbers, emails and links on contacts are underlined in a deeper green, so they read as links to tap.',
        'The care circle reads the right way round. A row now says "Dorothy is their mother".',
      ] },
      { heading: 'Fixed', items: [
        'How did it go? only shows once an appointment has happened.',
        'An appointment no longer lists who it is with twice. Their name under Who with opens them in Contacts.',
        'Save on the medication, condition, treatment, equipment and contact forms now says what is missing, instead of doing nothing.',
      ] },
    ],
  },
  {
    version: '0.47.0',
    date: '2026-11-20',
    summary: 'Book anything from anywhere: Book it on tasks, who a task is with and their number, documents to bring, and repeats from every day to every year.',
    groups: [
      { heading: 'Added', items: [
        'Book anything from anywhere. A task that books something now has a Book it button, in the list and on the task. It opens the booking form already filled in: what it is for, the kind, who it is with, the condition and the documents to bring. A contact has New appointment with them, a condition has Book an appointment for this, and a health alert books with the GP for that condition.',
        'Who a task is with. New task asks who it is with. Pick someone from Contacts or type a new name with what they do and their phone, and they are filed in Contacts. The task shows them with a phone to tap, and the task list has Who with and Their phone columns.',
        'Tasks can be edited. Open a task and choose Edit to change anything on it.',
        'PareCare works out who and what. "Ask OT for progress report" links the occupational therapist, and "Book a neurologist" becomes a booking task. The task says what was worked out, with Change.',
        'One task per booking. A next step or a new task for a booking that an open task already covers joins it, rather than making a second task. The screen says so and offers Keep them separate. Two tasks that already look like the same booking offer Join them.',
        'Numbers in notes can be tapped. Phone numbers, emails and links in task, appointment and record notes can be tapped. A note that names someone with a number offers to add them to Contacts, and a contact with no number offers to save the one in the note.',
        'Documents on tasks and appointments. A task can have documents attached as it is written, and an appointment can list documents to bring when it is made. Booking from a task brings its documents along.',
        'More on every appointment. Who\'s going, with who is driving; an interpreter and the language; a video call link that shows as Join the video call; and how to get ready, with a reminder at 7pm the night before. The appointment shows who it is with, their phone, email and booking link.',
        'Repeats from every day to every year. Tasks and appointments can repeat every day, every week, every 2 weeks, every month, every 3 months, every 6 months or every year. A repeating appointment can stop repeating, and moving one offers to move the ones after it.',
        'Contacts show their appointments and open tasks.',
      ] },
      { heading: 'Changed', items: [
        'A blank time means any time that day. A task or appointment saved with a date and no time shows as "any time" that day rather than 9am, and is not overdue until the day is over.',
        'The appointment form is grouped into What and who, When, Where, Getting there, Bring and get ready, and Notes and cost.',
        'The next appointment on the overview shows who to call and what to bring.',
        'Save always answers. Add task, Upload, Add note, Attach, Add on emergency contacts and Send to Pare say what is missing rather than sitting greyed out.',
        'Pare books and adds tasks the same way the forms do, with who it is with, their phone, documents, repeats and everything else above.',
      ] },
      { heading: 'Fixed', items: [
        'Task notes are in one place. Notes added to a task in either of the two old places now show together on the task.',
      ] },
    ],
  },
  {
    version: '0.46.3',
    date: '2026-11-20',
    summary: 'Urgent fixes: refused doses alert the family, recording a death stops reminders, and birthdays stay on the right day.',
    groups: [
      { heading: 'Fixed', items: [
        'A refused dose is not a given dose. A dose recorded as refused, held or omitted no longer quiets the overdue alert, and the family is told straight away, for example "Jess recorded Dorothy\'s Metoprolol as refused." The activity list says the same, rather than "Medication added".',
        'One tap records the dose as prescribed. A dose recorded with one tap, with Log all due doses or with Record all doses now counts as the right dose by the right route. Before, every one was flagged as wrong.',
        'Directories show everything that is yours. People, Professionals, Organisations, Suppliers, Assets and Addresses now list every person and record set up on the account, not only those shared with it. An empty People directory explains what it is for and offers Add a person.',
        'Care homes are in Organisations. A care home, nursing home or hospice is now filed with Organisations rather than Professionals, including those already saved.',
        'Residents\' profiles save again. Saving Edit profile for a resident of a care home no longer stops with a message about the home not being linked. The home is linked to them on the spot.',
        'Sharing a document with carers reaches every carer. A role is now picked from the list when editing someone in the care circle, and roles match whatever their capitals, so "Carer" and "carer" are the same role. Roles already saved have been tidied to match.',
        'Recording a death stops what was still running. Saving a date of death now stops task reminders, dose and supply alerts and the calendar feed, closes open tasks and cancels future appointments, which stay on the record as history. The screen says what stopped. Undo, or clearing the date, puts everything back as it was.',
        'A hospital stay keeps the home address. Choosing a hospital or care facility as where someone lives no longer wipes their home address, and reaching them through the facility no longer erases a personal contact such as a daughter.',
        'Letters land on the right visit. When Pare files a letter about a visit, such as a discharge summary, it only attaches it to an appointment whose name matches. Otherwise it files the visit on its own, with every next step, rather than on whatever appointment happened last.',
        'The care plan review date stays put. The yearly review date is set once and no longer moves a year out every time the plan is rebuilt. A reminder task comes two weeks before, and Change date on the care plan moves both.',
        'Archive is only offered where it works. Archive shows only on profiles set up on this account. When some of the profiles chosen belong to someone else, the screen says which were left and why.',
        'Birthdays no longer slip back a day. Saving Edit profile without changes no longer moves a date of birth to the day before. Dates of birth, dates of death, repeat dates and other whole-day dates now show and save as the same day everywhere, including exports.',
        'Blocked changes say who can make them. Someone who cannot change a medication, a treatment, care costs or the care circle is now told exactly what they cannot do and who can, by name, instead of a message about the care circle.',
        'Replies stay with their own question. Replies to a question can only be read and written from the profile the question belongs to.',
        'A task keeps the contact it was made with. A task made with a contact now keeps that contact, checked as one of the person\'s own contacts.',
      ] },
    ],
  },
  {
    version: '0.46.2',
    date: '2026-11-20',
    summary: 'New contacts keep everything you entered, and you can see they were added.',
    groups: [
      { heading: 'Fixed', items: [
        'New contacts keep everything you entered. Someone added to Contacts from a referral or a booking now gets the address and map link typed for their appointment, not just their name. Edit them in Contacts and it is all there. A later booking fills in anything Contacts is still missing, and never overwrites what is already saved. People already added with only a name pick up their address from their appointment.',
        'You can see they were added. Saving now says who was added to Contacts, with a link to open them, and each referral in How did it go shows who it is with, linked to their entry in Contacts.',
      ] },
    ],
  },
  {
    version: '0.46.1',
    date: '2026-11-20',
    summary: 'Click Not booked yet anywhere to book it.',
    groups: [
      { heading: 'Changed', items: [
        'Not booked yet books it, wherever it appears. Clicking Not booked yet in Appointments, on the appointment itself, in How did it go, in condition tracking or on a condition opens the booking straight away. The buttons that do it now say Book it.',
      ] },
    ],
  },
  {
    version: '0.46.0',
    date: '2026-11-20',
    summary: 'Save an appointment before it is booked, and add the date later.',
    groups: [
      { heading: 'Added', items: [
        'Save an appointment before it is booked. Fill in who it is with, where, what for and any notes, and leave the date blank. It saves as Not booked yet, with a to-do to book it. Book it now in How did it go works the same way.',
        'Add the date when it is booked. Not booked yet appointments sit at the top of Appointments with an Add the date button. Adding the date books the appointment and ticks its to-do off. Ticking that to-do on the Tasks page takes you straight to adding the date.',
        'Pare saves appointments that are not booked yet. Tell Pare about an appointment you still need to book and it keeps the details with a to-do. Give Pare the date later and it books it.',
      ] },
      { heading: 'Fixed', items: [
        'The panel that slides in from the right closes every time. Opening another record from inside it, or clicking a row twice, no longer leaves Close and the background unable to shut it.',
        'On a phone, the Add PareCare to your home screen bar no longer sits on top of an open record and blocks what is underneath it.',
      ] },
    ],
  },
  {
    version: '0.45.1',
    date: '2026-11-20',
    summary: 'Save always says what is missing.',
    groups: [
      { heading: 'Fixed', items: [
        'Save always says what is missing. In How did it go and the appointment form, Save no longer greys out without a word. Press it and anything still needed is named in red under its box, the form takes you there, and a sentence by the button says what to add or that Not now books it later.',
        'A refused save names the box. When an appointment or How did it go cannot save, the message now says which box to check instead of "Invalid request". A booking that does not go through says why.',
      ] },
    ],
  },
  {
    version: '0.45.0',
    date: '2026-11-20',
    summary: 'Referrals file the specialist in Contacts, and appointment addresses use the address finder.',
    groups: [
      { heading: 'Added', items: [
        'Referrals go straight into Contacts. A referral in How did it go now asks who it is to and what they do, as two separate boxes. Pick someone already in Contacts, or type a new name and they are filed there for you, linked to the person you care for. Booking the referral later starts with them already chosen.',
        'New names are filed for you. Typing a new name for who an appointment is with now adds them to Contacts when the appointment is saved. There is no separate button to press. Pare does the same when it books.',
      ] },
      { heading: 'Changed', items: [
        'Appointment addresses use the address finder. Where an appointment is now works the same as every other address: start typing, pick the place, and each part fills its own box. Picking who it is with fills in their address. A map link has its own box. Existing locations have moved into the first address line, ready to tidy.',
        'One appointment form everywhere. Adding an appointment from the Calendar now opens the same form as the Appointments page.',
      ] },
    ],
  },
  {
    version: '0.44.0',
    date: '2026-11-20',
    summary: 'Add the people around someone to their care circle by name, no invite needed.',
    groups: [
      { heading: 'Added', items: [
        'Add people to the care circle without inviting them. Choose Add someone, type their name and pick who they are. A neighbour, a friend who drives or a support worker joins the circle with their phone and email if you have them. They do not need an account, nobody is emailed, and they cannot see anything.',
        'Doctors and other professionals in the circle. Pick GP, Specialist, Psychologist, Allied health or Social worker and they are filed in Contacts too, so the same person is ready for appointments and referrals. Everyone in Contacts now shows in the circle under Professionals, and names already on file are offered so nobody is entered twice.',
        'Invite to log in, any time. Anyone added by name can be invited later with one button. They keep their place in the circle.',
        'Pare knows your circle. Ask Pare to add, change or remove someone in the care circle, or use the new circle command. Pare also knows who everyone is and how to reach them.',
      ] },
      { heading: 'Changed', items: [
        'Removing someone added by name has Undo. Nothing is lost by removing them, so it happens straight away with a few seconds to Undo. Removing someone who logs in still asks first.',
        "People added by name do not count toward your plan's circle limit. Only people who log in or have an invite on the way count.",
      ] },
    ],
  },
  {
    version: '0.43.0',
    date: '2026-11-19',
    summary: 'Book the next appointment from How did it go, and forward notes from one appointment to another.',
    groups: [
      { heading: 'Added', items: [
        'Book the next appointment while recording how it went. Add a referral or follow-up in How did it go and choose Book it now. The same appointment form opens right there, with the condition already filled in, and a follow-up starts with the same doctor and place. No date yet? Leave it and the step stays on your tasks until it is booked.',
        'Forward notes to another appointment. Choose Forward notes on an appointment, or Forward on a single note, tick all or some of what was noted, trim the text if only part of it matters, and pick where it goes. The original turns grey with "Forwarded to" and the name and date. The copy at the other end says who it is from and when.',
        'Send notes with a referral before it is booked. When a referral is added in How did it go, everything noted at that visit is ticked to go with it. The notes wait on the referral and land on the appointment the moment it is booked, whether that is now or weeks later.',
        'Take back a forward. Take back removes the copy from the other appointment, with a few seconds to Undo.',
        "Pare forwards notes too. Ask Pare to send today's notes to the neurologist, or use the new forward command. Booking a referral through Pare also brings the notes waiting on it.",
      ] },
      { heading: 'Changed', items: [
        'Appointments list newest first. The most recent appointment is at the top.',
        'Tables remember your order. Every list keeps the order you last sorted it by, on this device, so it is the same the next time you come back.',
      ] },
    ],
  },
  {
    version: '0.42.0',
    date: '2026-11-19',
    summary: 'Record when, why and how a condition resolved, all optional.',
    groups: [
      { heading: 'Added', items: [
        'Say why a condition resolved. Mark resolved now offers three optional boxes: when it resolved, why it resolved and what happened. Fill in as much or as little as you like. Leave them blank and the condition simply stops being tracked.',
        'Why it resolved on the list. The Conditions page has a Why it resolved column, and the reason and what happened show on each condition and in reports. Edit a resolved condition to add or change the detail later.',
      ] },
      { heading: 'Changed', items: [
        'Pare no longer guesses the date. Telling Pare a condition has cleared up no longer records today as the day it resolved. Pare records a date and a reason only when you give them.',
      ] },
      { heading: 'Fixed', items: [
        'A condition marked resolved without a date no longer counts toward how unwell someone looks on their profile.',
      ] },
    ],
  },
  {
    version: '0.41.0',
    date: '2026-11-19',
    summary: 'Resolved conditions leave the Conditions page, and old ones are quick to clear.',
    groups: [
      { heading: 'Changed', items: [
        'Resolved conditions leave the list. Conditions that are over drop off the Conditions page and stay on record. Show resolved conditions brings them back whenever they are needed.',
        'Mark conditions resolved in one go. Tick the ones that are over and choose Mark resolved, or open one and press Mark resolved. No date is needed, and Undo brings them back for a few seconds.',
      ] },
    ],
  },
  {
    version: '0.40.0',
    date: '2026-11-18',
    summary: 'Click any line in any list to open it, with the same buttons on every record, and delete with Undo.',
    groups: [
      { heading: 'Added', items: [
        'Open any record. Click any line in any list, from appointments, tasks and medications to documents, contacts, the care log and every directory list, and it opens on its own with every detail and what it is linked to. On a laptop it slides in beside the list; on a phone it fills the screen.',
        'The same buttons on every record. Edit, Done where it applies, Add a note, Attach a document, Ask Pare about this, Print, Copy link and Delete, plus the buttons that belong to that kind of record, such as Record a dose or How did it go.',
        'Notes and documents on any record. Add notes to anything, and attach a new or existing document to it. Each record also shows who changed it and when.',
        'A link to every record. Copy link gives an address that opens straight to that record, and Back closes it.',
      ] },
      { heading: 'Changed', items: [
        'Delete with Undo. Deleting no longer asks “are you sure”. The record goes at once and Undo brings it back for a few seconds. Removing someone from the care circle still asks first, because it ends their access.',
        'More lists sort by any column, including tasks, allergies, substance use, the dose record and achievements.',
        'Substance use shows the amount and the unit as separate columns.',
        'Recent activity on the overview opens the exact record each line is about.',
      ] },
    ],
  },
  {
    version: '0.39.0',
    date: '2026-11-18',
    summary: 'Add a prescription or upload a document straight from an appointment, and letters fill in the outcome.',
    groups: [
      { heading: 'Added', items: [
        'Add a prescription to medications from the appointment. A prescription to fill has Add to medications. The medication form opens with the name and condition filled in, and saving it ticks the prescription off.',
        'Upload a document from the appointment. A document to file, a form or a medical certificate has Upload. The upload window opens with its name and condition filled in, and uploading ticks it off.',
        'Letters from doctors fill in the outcome. When Pare reads a specialist’s letter, a consult summary or a discharge summary, it proposes how the visit went and each next step the letter asks for. Check or change every step before filing.',
      ] },
      { heading: 'Changed', items: ['Tasks sort by any column. Click a heading to sort, and again to reverse.'] },
    ],
  },
  {
    version: '0.38.0',
    date: '2026-11-18',
    summary: 'Record how each appointment went, and track every referral, test and script it sets off.',
    groups: [
      { heading: 'Added', items: [
        'How did it go? After an appointment, note what happened and what came out of it. Choose from common next steps such as a referral, a follow-up, a prescription to fill, a blood test, a urine, stool or semen sample, an X-ray or scan, results to chase or a document to file. Anything else is added by typing it, and is then on the list for everyone you care for.',
        'Every next step is tracked. Each one becomes a task with its own date, so it shows on the Tasks page, in At a glance and in the bell until it is done. A referral, test or follow-up can be booked straight from it, and booking it ticks it off.',
        'A thread for each condition. A condition’s appointments now read in order, each with how it went and what it led to, from the first visit on.',
        'A nudge after each appointment. The bell asks how an appointment went once it has finished, and clears itself when you answer. It can be turned off in notification settings.',
        'Pare records outcomes. Tell Pare “saw Dr Lee, got a referral to physio and a script for Naproxen”, or use /outcome, and it files the outcome and both next steps.',
        'Edit the list of next steps. The account owner can rename, combine and delete kinds of next step, with Undo.',
      ] },
      { heading: 'Changed', items: ['Appointments sort by any column. Click a heading to sort, and again to reverse.'] },
    ],
  },
  {
    version: '0.37.2',
    date: '2026-11-18',
    summary: 'Click a person’s name or picture to go back to their overview.',
    groups: [
      { heading: 'Fixed', items: ['Back to the overview in one click. Click a person’s name or picture at the top of any of their pages to return to their overview.'] },
    ],
  },
  {
    version: '0.37.1',
    date: '2026-11-18',
    summary: 'Each dose counts on its own, medication times show in your own time, and the bell clears itself.',
    groups: [
      { heading: 'Fixed', items: ['Each dose counts on its own. Recording one dose of a medication taken three times a day no longer marks all three as given. Medications today, the calendar and the overdue dose alert now agree on what is still to give.', 'Medication times show in your own time. The calendar placed scheduled doses at the wrong hour for anyone outside UTC. An 8am dose now shows at 8am.', 'The bell clears itself. An alert to record a dose goes away the moment the dose is recorded, whether on the medication chart, the medications page or through Pare.'] },
    ],
  },
  {
    version: '0.37.0',
    date: '2026-11-18',
    summary: 'What matters today at the top of the overview, and cards with news come first.',
    groups: [
      { heading: 'Added', items: ['At a glance. The top of each overview now shows the next appointment, medications still to give today, open and overdue tasks, and the newest document. Each one opens its page.', 'Cards with news come first. A card with changes since your last visit has a dot beside its name and moves up, unless you have arranged the cards yourself.'] },
    ],
  },
  {
    version: '0.36.0',
    date: '2026-11-18',
    summary: 'See what changed since you last looked, right on the overview.',
    groups: [
      { heading: 'Added', items: ['Recent activity on the overview. Each person’s overview now opens with what changed since you last looked, headed with the date of that visit. It counts what was added, lists each change by day with who made it, and each line opens the record it is about. The first time, it shows the last two weeks.'] },
    ],
  },
  {
    version: '0.35.0',
    date: '2026-11-18',
    summary: 'More room for your documents, and drop a file onto the list to upload it.',
    groups: [
      { heading: 'Changed', items: ['More room for your documents. The upload form no longer sits beside the documents list, so the list now uses the whole width of the screen. Choose Upload above the list to add a document. It asks the same things as before: the file, its name, its category, what it is for and who can see it.', 'Drop a file onto the list to upload it. Drag a file from your computer onto the documents list and the upload window opens with that file ready and its name filled in.', 'See where a new document went. After an upload the list shows newest first and the new document lights up for a few seconds.', 'A clearer start. With no documents yet, the page says what to keep here and offers one button to upload the first one.'] },
    ],
  },
  {
    version: '0.34.0',
    date: '2026-11-18',
    summary: 'Your own document categories, and Pare files each document it reads.',
    groups: [
      { heading: 'Added', items: ['Your own document categories. Type a category when filing a document. If it is not on the list yet, choose Add and it is created on the spot. Categories are shared by everyone you care for, so Tax set up for one person is there for all of them.', 'Edit categories. The account owner has Edit categories beside the Category filter on Documents. Rename a category and every document filed under it follows. Rename it to a name already in use and it offers to combine the two. Delete one and its documents move to Other, with Undo right there. Care plan, Advance care directive and Other are always kept, because PareCare files things there, but they can still be renamed.', 'Change category for many documents at once. Tick documents and choose Change category.', 'Pare files the document itself. When Pare reads a document it now suggests the category it belongs in and a clear name for it, such as "Discharge letter, Example Hospital, March 2026" in place of "IMG_2034". Check or change both before saving. In the chat, ask Pare to "put the discharge letter under Hospital", or use /file.'] },
      { heading: 'Changed', items: ['Medical record and Medical certificate are now two categories. Documents already filed with "certificate" or "cert" in their name moved to Medical certificate. The rest stay in Medical record.'] },
    ],
  },
  {
    version: '0.33.0',
    date: '2026-11-18',
    summary: 'File a document now, and have Pare read it whenever you are ready.',
    groups: [
      { heading: 'Added', items: ['File a document without Pare reading it. Uploading with Pare now offers File without reading, which puts the file straight into documents and leaves it there untouched. Handy when there is no time to check what Pare finds, or when the file only needs keeping.', 'Have Pare read a document already on file. Every document in the list now has Read with Pare. Pare reads it, says what it is and proposes what to file from it, the same as a fresh upload, and nothing is saved until you check it. Documents filed before today work too. It sits beside each document in the list and in the window that opens when you view one.'] },
      { heading: 'Fixed', items: ['The documents list fits on a laptop screen. Every button beside a document now shows without scrolling sideways, and the upload form moves under the list until the screen is wide enough for both.'] },
    ],
  },
  {
    version: '0.32.0',
    date: '2026-11-16',
    summary: 'Contact details shared from the organisation, so nothing is typed twice.',
    groups: [
      { heading: 'Added', items: ['Contact details shared from the organisation. Everyone based at an organisation now uses its phone, email, booking link and directions, as well as its address, whenever they have none of their own. Change the organisation\'s phone once and everyone there has the new number. Type in a doctor\'s own mobile and it stays theirs. An empty box shows what will be used, and from where. Records already filed were filled in the same way.'] },
    ],
  },
  {
    version: '0.31.0',
    date: '2026-11-16',
    summary: 'Organisations and Professionals, in place of Providers.',
    groups: [
      { heading: 'Changed', items: ['Organisations and Professionals, in place of Providers. The directory now keeps two lists. Organisations holds clinics, health hubs, hospitals, pharmacies, government departments, agencies, law firms and every other body. Professionals holds the people: doctors, specialists, lawyers, caseworkers. Everything already filed was sorted into the right list, and a name with a title, like Dr Karen Sank, is always a professional.', 'Each form asks the right question. A professional is Based at an organisation. An organisation is Part of a bigger one, such as a clinic inside a health hub. The Type list offers kinds of organisation on one form and kinds of professional on the other, with Government department, Law firm, Case manager and Support coordinator among the new ones.', 'Filed in the wrong list? Tick it and choose Move to Professionals or Move to Organisations. Everything linked to it stays linked.', 'Contacts on each person\'s page. The Providers tab is now Contacts, with their professionals on one tab and their organisations on the other. Appointments now say who they are With.', 'Pare and your assistants know the difference. Saying "add the Department of Justice" files an organisation, and "add Dr Carly Examplename to Health Hub Morayfield" files a professional there.'] },
    ],
  },
  {
    version: '0.30.0',
    date: '2026-11-16',
    summary: 'Merge duplicate records, other names for providers, and a better address finder.',
    groups: [
      { heading: 'Added', items: ['Merge two records for the same thing. Tick both in the provider directory and choose Merge selected, or use the list of likely duplicates PareCare spots for you. Everything linked to the duplicate moves across: the people it is linked to, appointments, and whatever is based there. Details only the duplicate had are copied in, and its name is kept as another name, so Pare and your assistants still find it. Undo is there for 30 minutes.', 'Also known as. A provider can go by more than one name. Add names people use, and Pare, your assistants and imports find it by any of them.'] },
      { heading: 'Changed', items: ['A better address finder. It looks in your own directory first, then searches your own country before the rest of the world. When a place is not on the map, as with some shopping centres, it says so and points you to typing the address in yourself.', 'Fewer second copies. Filing a new place with a name close to one you already have, like Health Hub Doctors Morayfield, now finds the one you have instead of making another.', 'Clearer filters. They read Any type and Anywhere, in place of All type and All based at.'] },
    ],
  },
  {
    version: '0.29.0',
    date: '2026-11-16',
    summary: 'Health hubs, with clinics and doctors inside them.',
    groups: [
      { heading: 'Added', items: ['Health hubs, with places inside places. A health hub such as Health Hub Morayfield is now its own type, for one building with many services under the one roof. Clinics and practices are based at the hub, and doctors are based at their clinic, so the address of the hub reaches everyone inside. Move the hub and every clinic and doctor in it follows. Tell Pare or your assistant "add Dr Carly Examplename to the Neuro Clinic at Health Hub Morayfield" and it files all three in one go. Health Hub Morayfield is already filed as a health hub.'] },
      { heading: 'Changed', items: ['Based at, in place of Works at. The same field now suits a doctor at a clinic and a clinic inside a hub, and the list of what is based at a place includes its clinics as well as its people.'] },
    ],
  },
  {
    version: '0.28.1',
    date: '2026-11-16',
    summary: 'One type means one thing, and the Pare conversations list loads again.',
    groups: [
      {
        heading: 'Changed',
        items: [
          'One type means one thing. Clinic and Practice are now two provider types, with Medical centre and Health centre in the list as well. Places you had filed are sorted by their name, so Brain Clinic is now a clinic. A new place gets a fitting type from its name without you choosing one.',
          'Two more lists split the same way. Condition tracking has Test result and Scan result as separate kinds of entry, and a task can be closed as Blocked or as Unable to complete.',
        ],
      },
      {
        heading: 'Fixed',
        items: [
          'The Pare conversations list under System loads again. It had stopped showing any conversations at all and only said it could not load them. It now lists them, leaves out empty ones, and says so when there are more than it shows.',
        ],
      },
    ],
  },
  {
    version: '0.28.0',
    date: '2026-11-16',
    summary: 'Use PareCare from the assistant you already chat with, keep records that hold up for claims, file doctors at their clinic once, and add any kind of provider.',
    groups: [
      {
        heading: 'Added',
        items: [
          'Use PareCare from Claude, ChatGPT, Gemini, Open WebUI and other assistants. Connect the assistant you already chat with, then say things like "Mum took her evening tablets at 7, file it in PareCare" and it is saved to the right person with the same checks as Pare. Connecting is one copied address and a click on Allow. Choose whether it may add records or only look, see everything connected in one list, and disconnect any of it with one click. Changes to a medication list are read back for you to agree first, every change is marked as made by an assistant, and most new records can be undone for 30 minutes.',
          'Clinics and the people who work there. File a doctor at their clinic and they share its address, so Health Hub Morayfield is typed once, not once per doctor. Pick where someone works as you add them, or open the clinic and add the people who work there. Move or rename the clinic and everyone there follows. Or just tell Pare: "add Dr Carly Examplename to Health Hub Morayfield". Your existing providers have been grouped under the organisation each one named.',
          'A recording guide that works with any assistant. Whatever you talk to, it is taught how to log a day, an appointment or a cost so the record is clear later and holds up for a claim or a review. Ask it to summarise any period, such as the last three months before a plan review, and it pulls together your log, symptoms, appointments and costs with their dates. Add it to Gemini or Claude as a skill, or copy it into ChatGPT custom instructions or Open WebUI, from Connected apps.',
          'Any kind of provider. Type Neurologist, Dentist, Physiotherapist or whatever kind of provider someone sees, and it joins the list for next time. Common specialties are already there, so there is no need to pick Other.',
        ],
      },
      {
        heading: 'Changed',
        items: [
          'App passwords for bots and scripts moved from Notifications to the new Connected apps screen in your account menu.',
          'The provider directory has sortable Works at and People here columns, and both provider forms ask where someone works in place of a separate organisation box.',
        ],
      },
    ],
  },
  {
    version: '0.27.0',
    date: '2026-09-02',
    summary: 'Editable subheader copy across the whole app.',
    groups: [
      {
        heading: 'Added',
        items: [
          'Editable subheader copy. Super admins now edit the description text below every page heading, either inline on the page itself or from a centralised Site copy screen under System. Changes appear for everyone straight away. Profile pages support a name placeholder that fills in the person being cared for.',
        ],
      },
    ],
  },
  {
    version: '0.26.0',
    date: '2026-09-02',
    summary: 'Dismiss a notification, Pare answers again, and a clear message when Pare cannot read a file.',
    groups: [
      {
        heading: 'Added',
        items: [
          'Dismiss a notification. Every new notification now has a dismiss control, and the count on the bell drops the moment you dismiss one, without leaving the panel or opening the page it points to. Opening or clearing notifications updates the count straight away too.',
        ],
      },
      {
        heading: 'Fixed',
        items: [
          'Pare answers again. Pare\'s built-in choice of model was tied to a dated version that can be retired out from under it. It now always uses the current one, so chatting with Pare and having it read documents keep working.',
          'A clear message when Pare cannot read a file. Uploading a document while Pare is not set up, still getting ready, or having trouble now says so plainly and points to where it is put right, instead of looking as though the file itself could not be read. Your file is saved either way.',
        ],
      },
    ],
  },
  {
    version: '0.25.1',
    date: '2026-08-06',
    summary: 'System settings read as a numbered checklist.',
    groups: [
      {
        heading: 'Changed',
        items: [
          'System settings read as a numbered checklist. For whoever runs the system, the settings are now in numbered sections, most important first, with plainer headings and less jargon.',
        ],
      },
    ],
  },
  {
    version: '0.25.0',
    date: '2026-08-06',
    summary: 'A Pare status light in the top corner, and a monitor for whoever runs the system.',
    groups: [
      {
        heading: 'Added',
        items: [
          'A Pare status light. A small traffic light in the top corner shows at a glance how Pare is doing: green when it is online and working well, amber when it is online but under load or still getting ready, and red when it is offline and may need attention.',
          'A Pare monitor for whoever runs the system. The Pare screen now opens with how Pare is running, its response time, how busy it is, how long it has been up, and how much it is being used and by whom, with every conversation in a sortable table. Empty chats are left out.',
        ],
      },
    ],
  },
  {
    version: '0.24.0',
    date: '2026-08-06',
    summary: 'Profile and Settings are one screen, and Pare greets you by name.',
    groups: [
      {
        heading: 'Changed',
        items: [
          'Profile and Settings are one screen now. Your details, your photo and how you sign in all live under Settings, laid out in numbered sections with the most-used first. The separate Profile screen is gone, and its link goes straight to Settings.',
          'Pare greets you by name. Opening Pare starts with a friendly hello and an offer to help, and a nudge to type /help to see everything it can do, in place of the technical note that used to sit there and meant little to anyone.',
        ],
      },
      {
        heading: 'Removed',
        items: [
          'The Relationships feature has been removed. It was little used and did not earn its place.',
        ],
      },
    ],
  },
  {
    version: '0.23.0',
    date: '2026-08-06',
    summary: 'The activity log now shows how a change was made, not only who and when.',
    groups: [
      {
        heading: 'Added',
        items: [
          'The activity log shows when Pare made a change. Every entry now says whether a person made it by hand, Pare did, or an outside assistant did, so the record tells you how something changed, not only who and when.',
        ],
      },
    ],
  },
  {
    version: '0.22.0',
    date: '2026-08-06',
    summary: 'Edit several people or pets at once, and people cards that stay within the screen.',
    groups: [
      {
        heading: 'Added',
        items: [
          'Edit several people or pets at once. Select more than one on the homeboard and set what they share in one go: relationship, pronouns, main language, and for pets their species, breed and more. Only the fields ticked change; the rest are left exactly as they are.',
        ],
      },
      {
        heading: 'Fixed',
        items: [
          'People cards stay within the screen. A long condition name, journey or note now wraps inside the card instead of stretching it sideways off the display.',
        ],
      },
    ],
  },
  {
    version: '0.21.0',
    date: '2026-08-06',
    summary: 'Put PareCare on your phone, and capture a note or a photo in thumb reach, even with no signal.',
    groups: [
      {
        heading: 'Added',
        items: [
          'Install PareCare on your phone. Add it to the home screen and open it like any other app, in thumb reach in a corridor or a waiting room.',
          'Capture anywhere. One button on the phone opens a quick note or a photo against the person you are looking at. Write a note, with the phone\'s own microphone typing it for anyone who would rather speak, or take a photo of a letter, a prescription or a receipt for Pare to read and propose what to file, to check before anything is saved.',
          'Notes save even with no signal. A note written with no connection is kept on the phone and sent the moment the connection returns, and it arrives once however patchy the signal. A short buzz and a line confirm every save.',
        ],
      },
      {
        heading: 'Changed',
        items: [
          'Photos and scans are read now. A photographed or scanned document goes straight to Pare to read, the same as an uploaded file, instead of asking for its details to be typed in by hand.',
        ],
      },
    ],
  },
  {
    version: '0.20.0',
    date: '2026-08-06',
    summary: 'See everything new across your care circle in one place, and set up your own alerts.',
    groups: [
      {
        heading: 'Added',
        items: [
          "What's new gathers everything happening across the people in your care into one screen: what needs attention first, then the rest by recency, so nothing gets lost between profiles. Reach it from the sidebar or the bell.",
          'Alerts you set up yourself. Under Notifications, build exactly the alerts you want and choose where each one goes: a medication running low within a chosen number of days, a dose not recorded, an appointment coming up, a task due, a new message or document, a health change, or a medication record. Each arrives the moment it happens or bundled into a daily, weekly, fortnightly or monthly digest, sent to email or any destination you have set up. Several digest alerts to the same place come as one message, so a fortnightly email can carry supply, appointments and a medication record together, and a low-supply alert brings a reorder link where there is one.',
        ],
      },
      {
        heading: 'Changed',
        items: [
          "What's new now means your own care circle. The developer release notes behind the version number are kept to whoever runs the system.",
        ],
      },
    ],
  },
  {
    version: '0.19.0',
    date: '2026-08-06',
    summary: 'You decide whether to hear about updates, and a new version always says so.',
    groups: [
      {
        heading: 'Added',
        items: [
          'Turn update notices off. A new switch under Notifications, in what you are notified about, controls the quiet mark that appears when PareCare has a new version. It stays on by default and is kept on this device.',
        ],
      },
      {
        heading: 'Changed',
        items: [
          'The version number in the sidebar now opens What\'s new, so you can read what has changed at any time, not only when there is a new mark waiting.',
        ],
      },
      {
        heading: 'Fixed',
        items: [
          'After an update, the quiet What\'s new mark now appears as it should, instead of staying hidden for people who came straight to the newest version.',
        ],
      },
    ],
  },
  {
    version: '0.18.0',
    date: '2026-08-05',
    summary: 'The overview leads with what matters for each person.',
    groups: [
      {
        heading: 'Changed',
        items: [
          'The overview leads with what matters for each person, without anyone arranging anything: the current health card rises to the top when someone is unwell, and the power of attorney comes forward once care has ended. Arrange the cards yourself and your own arrangement is kept exactly as you left it, so the two never fight. The overview cards also match the sidebar now, so an expected arrival or an infant is not shown Substance use.',
        ],
      },
    ],
  },
  {
    version: '0.17.1',
    date: '2026-08-05',
    summary: 'A tidier sidebar and account menu.',
    groups: [
      {
        heading: 'Changed',
        items: [
          'The foot of the sidebar now shows just the version, with What’s new appearing there only when there is something new to read rather than sitting as a permanent link. The light and dark switch, the text size control and Sign out have moved into the menu under your profile picture.',
        ],
      },
    ],
  },
  {
    version: '0.17.0',
    date: '2026-08-05',
    summary: 'Each person is shown only the sections that fit them.',
    groups: [
      {
        heading: 'Changed',
        items: [
          'Each person is shown only the sections that fit them. A pet no longer has Neurotypes or Substance use in its sidebar or on its overview, and an expected arrival or an infant is not offered Substance use. PareCare works this out from who the person is, with nothing to turn off.',
          'The command bar has been taken out. The keyboard jump-to-anything bar added recently overlapped the person switcher and the assistant without clearly helping, so it is gone. The person switcher at the top of the screen and Pare’s own button cover the same ground more simply.',
        ],
      },
    ],
  },
  {
    version: '0.16.0',
    date: '2026-08-05',
    summary: 'Find or do anything from one place, with a keystroke or a tap.',
    groups: [
      {
        heading: 'Added',
        items: [
          'Find or do anything from one place. A command bar opens from the bar at the top of any screen, or with a keystroke on a computer. Type a few letters to jump straight to a person, a section, a record, or an action like recording a dose or booking an appointment, without hunting through menus. Open it before typing and it shows what needs attention first.',
        ],
      },
      {
        heading: 'Changed',
        items: [
          'There is now one way to ask Pare, not two. The separate Ask PareCare page has folded into the assistant that sits on every screen and already knows whose profile is open, so asking is the same wherever you are.',
        ],
      },
    ],
  },
  {
    version: '0.15.0',
    date: '2026-08-05',
    summary: 'Bigger text when you need it, a match for your device comfort settings, and voice typing to Pare works again.',
    groups: [
      {
        heading: 'Added',
        items: [
          'Make the text bigger. A text size control sits next to the light and dark switch in the sidebar, with three steps starting from the size your device already uses, so PareCare can be larger than the rest of your phone when you need it.',
        ],
      },
      {
        heading: 'Changed',
        items: [
          'PareCare now follows the comfort settings on your device. When it asks for less motion, movement stops. When it asks for more contrast, edges and quiet text firm up. Nothing to turn on.',
        ],
      },
      {
        heading: 'Fixed',
        items: [
          'Voice typing works again when talking to Pare and writing messages. Dictating a note no longer cuts off part way through or sends before you have finished, so the words you speak are the words that are saved.',
        ],
      },
    ],
  },
  {
    version: '0.14.0',
    date: '2026-08-05',
    summary: 'See and change the assistant on your machine from System settings.',
    groups: [
      {
        heading: 'Added',
        items: [
          'The person running PareCare can now see which on-machine model is in use and what it is called in System settings, switch to another that is already downloaded, or fetch a new one by name or a Hugging Face link, without editing any files.',
        ],
      },
    ],
  },
  {
    version: '0.13.0',
    date: '2026-08-04',
    summary: 'Pare now runs on your own machine, privately, with nothing to set up.',
    groups: [
      {
        heading: 'Added',
        items: [
          'Pare now runs on your own machine. A private assistant is ready from the first start, with nothing to set up and nothing leaving your machine. The right assistant for your machine is chosen for you: a larger, more capable one where there is power for it, otherwise a smaller one that still reads text and images. Pare says in one line which one is in use, and that stays changeable.',
          'Pare says when it is still getting ready. On the first start the assistant can take a while to prepare itself. Instead of an error, Pare now says it is still getting ready and that everything else works in the meantime.',
        ],
      },
      {
        heading: 'Changed',
        items: [
          'Pare records what you ask it to, more reliably. The assistant can no longer garble what it is recording, so a dose or a note you ask Pare to log is saved as you meant it, even on the assistant that runs on your machine.',
          'A long reply from the assistant on your machine is no longer cut off part way through, and a request that never arrives now says so instead of waiting forever.',
        ],
      },
    ],
  },
  {
    version: '0.12.5',
    date: '2026-07-30',
    summary: 'A care plan that fails to generate now says so where you are looking.',
    groups: [
      {
        heading: 'Fixed',
        items: [
          'When generating a care plan failed, the message appeared on the screen behind the open window, so the person who had just pressed Generate saw nothing happen at all. It now appears in the window, above the button.',
        ],
      },
    ],
  },
  {
    version: '0.12.4',
    date: '2026-07-30',
    summary: 'Sorting the conditions table now works one way rather than two.',
    groups: [
      {
        heading: 'Fixed',
        items: [
          'The sort chosen from the toolbar and the sort shown on the column headings were separate, so choosing one left the other showing something else. They are now the same control, and the Resolved, Codes and Treatments columns sort as well.',
        ],
      },
    ],
  },
  {
    version: '0.12.3',
    date: '2026-07-30',
    summary: 'The calendar now goes as far ahead as the appointments in it.',
    groups: [
      {
        heading: 'Fixed',
        items: [
          'Moving the calendar to any future month was blocked, so an appointment booked for next month, or next year, could not be seen on the calendar at all. It now moves forward and back without limit.',
        ],
      },
    ],
  },
  {
    version: '0.12.2',
    date: '2026-07-30',
    summary: 'Two links under a condition led nowhere. They now open the screens they name.',
    groups: [
      {
        heading: 'Fixed',
        items: [
          'Under a condition on someone’s overview, Make an appointment and Add a treatment both led nowhere. They now open the appointments and treatments screens for that person.',
        ],
      },
    ],
  },
  {
    version: '0.12.1',
    date: '2026-07-30',
    summary: 'The contact details card now says what it is for when nothing has been recorded yet.',
    groups: [
      {
        heading: 'Fixed',
        items: [
          'When no phone number, email address or address has been recorded for someone, their contact details card used to show a heading with blank space under it. It now says what the card is for and offers one button to fill it in.',
        ],
      },
    ],
  },
  {
    version: '0.12.0',
    date: '2026-07-30',
    summary: 'PareCare downloads less before it opens, so screens arrive faster, especially on a phone.',
    groups: [
      {
        heading: 'Faster to open',
        items: [
          'Opening PareCare used to pull down every screen in it, including all the administration screens most people never see. It now fetches the screen being opened and keeps the rest until they are asked for, which cuts what has to arrive first by about a third.',
          'The parts that rarely change are now kept by your browser between releases, so an update downloads only what actually changed.',
          'While a screen is still arriving, the navigation and the headings stay put and only the part still coming says so.',
        ],
      },
    ],
  },
  {
    version: '0.11.1',
    date: '2026-07-30',
    summary: 'Each person’s overview is now arranged separately, and Pare stops rewriting a summary every time a card is opened.',
    groups: [
      {
        heading: 'Fixed',
        items: [
          'Folding cards away or moving them around on someone’s overview used to change the overview for everybody in your care at once, and two people signing in on the same computer overwrote each other. Each person’s overview is now remembered separately, for each carer. Arrangements made before this start again from the standard order once.',
          'Pare’s summary on a card no longer rewrites itself every time the card is folded away and opened again.',
        ],
      },
    ],
  },
  {
    version: '0.11.0',
    date: '2026-07-30',
    summary:
      'Copies of everything from the day you install, kept off this server if you want, and a way to prove they work. Plus a way back in when a password is forgotten.',
    groups: [
      {
        heading: 'Copies of everything, without setting anything up',
        items: [
          'A copy of every record and every uploaded document is now taken automatically, from the day you install. Nothing to set up and nothing to remember. Change how often they are taken and how long they are kept under Backups, or leave it alone and it looks after itself.',
          'Connect Google Drive or Dropbox and every copy is kept there as well as here, so the records survive this server being lost. Anyone who already has their own storage may use that instead. PareCare only ever sees the files it puts there.',
          'Connecting Google Drive or Dropbox is now a walkthrough, one step at a time, with the address they need to be given shown ready to copy.',
          'Choose any copy and put everything back as it was on that day. A copy of how things are right now is taken first, so restoring the wrong one is itself undoable.',
          'The screen says plainly when copies exist but have never left this server, rather than calling that protected. Copies also stop before they fill the server, and say so.',
        ],
      },
      {
        heading: 'Knowing the copies actually work',
        items: [
          'Test a restore makes a practice copy of everything, deletes every record and every document file in it, puts it all back, and compares what returned with what was there. Your real records are never touched at any point.',
          'The result names real records out of the copy and shows each one found, then gone, then back with every field identical, so it is something to read rather than something to take on trust. The full report saves to a file.',
          'Three levels show how protected the records are, worked out from what has actually happened rather than anything ticked: copies are being made, a copy lives somewhere else, and a restore has been proved.',
          'Backups are reached by an administrator as well as a super admin, so one person being away is never the difference between having the records and losing them.',
        ],
      },
      {
        heading: 'A way back in',
        items: [
          'Forgotten your password on the sign-in screen sends a way back in by email. The link works once and lasts an hour, and choosing a new password signs out everything else signed in as you, on every device.',
        ],
      },
      {
        heading: 'Pare does more of the work',
        items: [
          'Ask Pare for an appointment and it goes on the calendar as an appointment rather than a note.',
          'Pare also records a medication as given straight into the medication record, closes a task, records a cost, and records a reading such as a blood pressure or a blood sugar.',
        ],
      },
      {
        heading: 'Fixed',
        items: ['The app no longer becomes unreachable after the server is updated.'],
      },
    ],
  },
  {
    version: '0.10.0',
    date: '2026-07-28',
    summary: 'Wi-Fi kept with an address, a private vault for logins, and a condition that tracks itself.',
    groups: [
      {
        heading: 'Wi-Fi at an address',
        items: [
          'An address now keeps the Wi-Fi network name and the password, so anyone arriving to help gets online without hunting for the router. The network name is a sortable column in the address directory, and both are in the import and export.',
          'The password is stored encrypted and shown only when you ask to see it.',
        ],
      },
      {
        heading: 'Secrets',
        items: [
          'A new Secrets section under Documents for the logins kept for someone: social accounts, the rental, the bank. Each one records its name, kind, website, who you sign in as, the password, the account number and notes, every fact its own field.',
          'Only you, as the account owner, sees them. Carers, editors and viewers in the care circle never do, and neither do platform administrators. A power of attorney in the care circle gains access once a date of death is recorded, because settling an estate means getting into the accounts.',
          'Passwords are stored encrypted and stay masked until revealed, with a control to copy one without showing it. A date of death field now sits on a person’s details.',
        ],
      },
      {
        heading: 'Tracking a condition on its own',
        items: [
          'A condition under Current health now has its own thread, so a long-running thing is followed in one place instead of being hunted for across the care log. An ankle sprained in March that still hurts in July keeps its own log, the appointments booked for it, the documents filed against it, and the therapies being done for it.',
          'An appointment records what it is for, and the calendar marks it with that condition. A document is filed against a condition when it is uploaded. All of them still appear in Appointments, Documents and Treatments as before.',
          'Each log entry is typed as a note, a change in symptoms, a treatment, what came of an appointment, or a test or scan result. Pare can add to a condition’s log too.',
        ],
      },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-07-23',
    summary: 'A people switcher in the top bar, a consistent icon for every action across the app, and an icon on every section in a person’s record.',
    groups: [
      {
        heading: 'Switch between people faster',
        items: [
          'A people switcher now sits in the middle of the top bar. Search across everyone in your care and jump straight to a person or pet, without first going back to the All people list. The current profile is marked and listed first.',
        ],
      },
      {
        heading: 'A consistent look and feel',
        items: [
          'Edit, delete, remove, unlink, link and dismiss are now the same small icons everywhere: in the directories, all through a person’s record, on the Homeboard’s needs-attention items, in settings and on the admin screens. Each keeps a tooltip and a spoken label naming the record it acts on.',
          'Every icon means one thing: a pencil edits, a bin deletes, a cross removes or dismisses, a broken chain unlinks, a chain links. Buttons that confirm in a dialog, or act on a whole selection, keep their words so the meaning stays clear.',
          'Every left-hand section of a person’s record now has its own icon, from Overview and Care journey to the Medication record, Messages and Ask PareCare, so the navigation reads at a glance and matches the Directory.',
        ],
      },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-07-22',
    summary: 'Review uploads before filing, File with Pare everywhere, and equipment linked to the conditions it manages.',
    groups: [
      {
        heading: 'Upload and file with Pare',
        items: [
          'What Pare proposes from an upload is now shown as editable cards, so an imprecise vendor or a wrong address can be corrected, or an item dropped, before anything is saved.',
          'A paperclip in Pare\u2019s chat allows you to drop a document mid-conversation, and a File with Pare button appears on the needs-attention items where a receipt or invoice belongs.',
          'Pare checks a document\u2019s addresses against the ones already on file, so your own address is not mistaken for a vendor.',
        ],
      },
      {
        heading: 'Conditions and equipment',
        items: [
          'A device that manages a condition is now filed as a real asset: pick one from your register (its details autofill) or add a new one with the same editor, and it is linked to the condition it treats.',
          'A surgery under a condition opens the make-appointment editor to book it properly, prefilled as a procedure.',
        ],
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-07-22',
    summary: 'Upload anything and let Pare file it into the right place in the record.',
    groups: [
      {
        heading: 'Upload and file with Pare',
        items: [
          'Upload a document, an invoice, a care plan or a business card, and Pare reads it, says what it is, and proposes what to file into the person\u2019s record. Nothing is saved until you confirm.',
          'A tax invoice for a piece of equipment, like a CPAP machine, becomes an asset with its make and model, serial number, price, purchase date, supplier and warranty, linked to the person. The source file is kept in the document repository.',
        ],
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-07-22',
    summary: 'Health spend an accountant can reconcile: tax, claims, reimbursements, receipts, a financial-year view and an export.',
    groups: [
      {
        heading: 'Claims and reimbursements',
        items: [
          'Each cost can now carry the tax component split out from the total, a funding source (self, NDIS, private health, Medicare, government), an account code, how much is claimable, its claim status, and how much has come back.',
          'The Health spend card shows the net out of pocket, what has been reimbursed, and the claims still outstanding, over Last 12 months, This year, This financial year or All time.',
        ],
      },
      {
        heading: 'Receipts and export',
        items: [
          'Attach a receipt or invoice to any cost and download it later as evidence for a claim or the tax return.',
          'Export for accounting: a CSV of the confirmed costs over the chosen window, tax split out, with the claim and reimbursement columns, ready for a spreadsheet or accounting software.',
          'The Health spend report now includes tax, reimbursed, net and outstanding, and a new Health spend claims report lists what is claimable and outstanding by funding source.',
        ],
      },
      {
        heading: 'Assets',
        items: [
          'An asset can carry a useful life, and its straight line yearly write-down and current book value are worked out from the price and purchase date, shown in the register and the export.',
          'A financial year start month in System settings, used by the financial-year view and the export.',
        ],
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-07-22',
    summary: 'An equipment register in your Directory, linked to the people and pets it belongs to.',
    groups: [
      {
        heading: 'Assets',
        items: [
          'A new Assets section in your Directory for the equipment kept for someone’s care: a wheelchair, a hoist, a bed, a monitor.',
          'Each asset records its unit name, category, serial or unit number, make or model, price, purchase date, where it was bought, warranty expiry, condition and location, every fact in its own field.',
          'Assets have the same tools as the rest of the Directory: search, sort, edit, delete, bulk edit and delete, import and export, and the same link-to-profiles flow, so each piece of equipment can be tied to the person or pet it belongs to.',
        ],
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-07-22',
    summary: 'Track what you actually spend on health, recorded as it happens and reported over any date range.',
    groups: [
      {
        heading: 'Health spend',
        items: [
          'Spend is a ledger of real, dated costs, not a projection. A medication’s cost is recorded when a repeat is replenished, so the "repeat arrived" step now asks what it cost.',
          'An appointment or therapy takes an estimated cost when you book it and a confirmed actual cost afterwards. Until you confirm it, the estimate is kept apart and does not count, and the Homeboard reminds you to log what a past appointment actually cost.',
          'One-off costs, like a mobility aid or a dental bill, can be added by hand.',
          'A Health spend card on each person’s overview, for the account owner and admins only, with a Last 12 months, This year or All time view, the total split into medications, appointments and other, and every dated entry.',
        ],
      },
      {
        heading: 'Reports and settings',
        items: [
          'Two date-range reports, Health spend and Health spend itemised, so costs roll up across everyone in your care over whatever range you choose.',
          'A new Health spend group in System settings sets one currency for the whole account.',
        ],
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-22',
    summary: 'As needed medications, and health alerts that know each person’s normal.',
    groups: [
      {
        heading: 'Medications',
        items: [
          'An "as needed" checkbox on the add and edit medication form, for a medication with no set schedule, such as a painkiller or diazepam taken when required. It sits in the as needed group and a dose is logged when one is taken.',
          'A tracked reorder workflow for a medication running low: mark it ordered when you request a repeat, and replenished when it arrives, which tops the supply back up. If something ordered has not arrived after five days, it is flagged for chasing up.',
        ],
      },
      {
        heading: 'Conditions',
        items: [
          'A condition can now have a normal level on the 1 to 10 symptom scale. Everyone is different: if a chronic condition sits at a 6 or 7 every day, that is this person’s normal and does not raise an alarm.',
          'Health alerts use that normal level, so an alert is raised only when a symptom rises above it, and a condition without a normal level still follows the standard above moderate rule.',
        ],
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-07-22',
    summary: 'Suppliers, the Directory, and reordering medications when they run low.',
    groups: [
      {
        heading: 'Suppliers',
        items: [
          'Suppliers are a new shared list of the pharmacies and shops your medications are reordered from, kept separate from your care providers.',
          'Each supplier keeps a name, phone, email, a full address filled in by the same type as you go address finder used elsewhere, a reorder link, and a map link for directions.',
          'When two suppliers share a name, their suburb tells them apart, shown as Vendor then the suburb.',
        ],
      },
      {
        heading: 'Directory',
        items: [
          'Suppliers now sit in the Directory beside People, Pets, Providers and Addresses, with the same search, sort, edit, delete and link tools.',
          'Every Directory list can be exported and imported as a spreadsheet or a JSON file, with a blank template to fill in.',
          'Add person and Add pet buttons on the People and Pets lists.',
          'Each Directory item has a small icon, and every top level menu group can be arranged by name or a custom order you lock in place with a tick.',
        ],
      },
      {
        heading: 'Medications',
        items: [
          'The reorder cart now appears on a medication only when it drops under five days of supply and has a supplier reorder link, so it means reorder now rather than sitting there always.',
          'The reordered from field picks from the shared supplier list and can add a new supplier without leaving the form.',
          'Edit selected applies one change, such as the supplier, route or whether it is taken with food, to many medications at once.',
          'Row actions are now compact icons: record a dose, order, edit and remove.',
          'Sortable column headers show a faint arrow so it is clear they can be sorted, and it brightens when you hover.',
        ],
      },
      {
        heading: 'Around the app',
        items: [
          'Sign out moved to the bottom of the sidebar, next to the light and dark theme switch.',
          'A version badge in the sidebar links to the exact build it came from and to this page.',
        ],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '',
    summary: 'The first PareCare platform.',
    groups: [
      {
        heading: 'Foundations',
        items: [
          'Care profiles for the people and pets in your care, medications and the medication record, conditions, a providers and addresses directory, care plans, the assistant, reports, and account and billing.',
        ],
      },
    ],
  },
];
