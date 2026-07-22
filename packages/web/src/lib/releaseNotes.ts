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
    version: '0.8.0',
    date: '2026-07-22',
    summary: 'Review uploads before filing, File with Pare everywhere, and equipment linked to the conditions it manages.',
    groups: [
      {
        heading: 'Upload and file with Pare',
        items: [
          'What Pare proposes from an upload is now shown as editable cards, so you can fix an imprecise vendor or a wrong address, or drop an item, before anything is saved.',
          'A paperclip in Pare\u2019s chat lets you drop a document mid-conversation, and a File with Pare button appears on the needs-attention items where a receipt or invoice belongs.',
          'Pare checks a document\u2019s addresses against the ones already on file, so your own address is not mistaken for a vendor.',
        ],
      },
      {
        heading: 'Conditions and equipment',
        items: [
          'A device that manages a condition is now filed as a real asset: pick one from your register (its details autofill) or add a new one with the same editor, and it is linked to the condition it treats.',
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
