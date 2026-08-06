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
