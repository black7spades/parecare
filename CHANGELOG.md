# Changelog

All notable changes to PareCare are recorded here. The running app links to
this file from the sidebar ("What's new"), and its version badge links to the
exact commit each build came from, so the record of updates stays traceable to
source. Versions follow [semantic versioning](https://semver.org).

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
