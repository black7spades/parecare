# Changelog

All notable changes to PareCare are recorded here. The running app links to
this file from the sidebar ("What's new"), and its version badge links to the
exact commit each build came from, so the record of updates stays traceable to
source. Versions follow [semantic versioning](https://semver.org).

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
  build's commit, with a link to this changelog.

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
- **Sign out** moved from the top-right account menu to the sidebar footer,
  beside the theme picker.

## [0.1.0]

- Initial PareCare platform: care profiles, medications and the medication
  record, conditions, providers and addresses directories, care plans, the
  assistant, reports, and account and subscription management.
