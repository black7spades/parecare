# Changelog

All notable changes to PareCare are recorded here. The running app links to
this file from the sidebar ("What's new"), and its version badge links to the
exact commit each build came from, so the record of updates stays traceable to
source. Versions follow [semantic versioning](https://semver.org).

## [0.2.0] - 2026-07-21

### Added

- **Suppliers**, a shared account-level directory of the pharmacies and shops
  medications are reordered from, kept separate from care providers. Vendor
  name and branch suburb are distinct fields, so two branches of one vendor are
  told apart as "Vendor (Suburb)".
- Suppliers surfaced in the **Directory** alongside People, Pets, Providers and
  Addresses, with the same search, sort, edit and delete tools, showing how
  many medications use each supplier and which people they are for.
- The **Add/Edit medication** editor now picks its supplier from the shared
  list, autofilling the reorder link, and can create a new supplier inline.
- A **sort dropdown on every top-level nav group** (Directory, Tools, Pinned):
  default, A to Z, Z to A, or a custom manual order. The dropdown is theme
  aware, following light, dark or device mode. Custom order shows move controls
  and a tick to lock the order in place.
- **Small icons** for each Directory nav item.
- A **versioning system**: the sidebar shows the app version linked to the
  build's commit, with a link to this changelog.

### Changed

- Medication row actions (Record dose, Order, Edit, Delete) are now compact
  icons with tooltips. The Order action appears whenever a reorder link exists.
- **Sign out** moved from the top-right account menu to the sidebar footer,
  beside the theme picker.

## [0.1.0]

- Initial PareCare platform: care profiles, medications and the medication
  record, conditions, providers and addresses directories, care plans, the
  assistant, reports, and account and subscription management.
