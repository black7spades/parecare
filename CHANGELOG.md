# Changelog

All notable changes to PareCare are recorded here. Whoever runs the system
reads this record on the release notes screen, opened from the version number
in the sidebar, which links on to the exact commit each build came from, so the
record of updates stays traceable to source. Versions follow
[semantic versioning](https://semver.org).

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
