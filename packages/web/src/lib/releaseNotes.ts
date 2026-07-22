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
