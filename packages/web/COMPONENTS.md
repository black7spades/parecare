# Components

The shared primitives, each with one job. Reach for one of these before
hand-rolling its equivalent beside it; extend the set here rather than growing
a one-off in a page. Read `STYLE_GUIDE.md` alongside this: the style guide says
how a thing should look and behave, this says which thing to use.

## Actions and inputs

- **Button** (`ui/Button`) — the only way to render an action. Never a
  hand-rolled `<button>` styled as a link; links navigate, buttons act. Variant
  and size rules live in the style guide.
- **Input, Textarea** (`ui/Input`) — a labelled text field with hint and error
  slots. Pass no `label` when a surrounding control already names the field.
- **Modal** (`ui/Modal`) — a centred dialog that closes on Escape and on a
  backdrop click. `wide` for editors and pickers.
- **CatalogueCombo** (`CatalogueCombo`) — a dropdown backed by a shared
  catalogue endpoint: type to filter, pick anything not yet listed and it joins
  the catalogue on save. Use wherever a value should come from a source
  database rather than a free-text box.
- **RelationshipSelect**, **ContactDetails**, **ResidenceFields**,
  **AddressFields**, **AddressAutocomplete** — the shared building blocks for
  who someone is, how to reach them, and where they live. One field per data
  point, so a form never asks for two facts in one box.

## Data views

The standing pattern for any table or grid listing records. Use all three
together; never ship a fixed, unsortable table.

- **useDataView** (`data/useDataView`) — client-side sort, filter, paginate and
  multi-select for any list. The page supplies how to identify a row, its
  searchable text, the sorts and the filters; the hook owns the state and
  returns the processed view plus a selection set for bulk actions.
- **SortableTh** (`data/SortableTh`) — a column header wired to a useDataView:
  click to sort, click again to flip direction. Carries `aria-sort`.
- **DataToolbar** (`data/DataToolbar`) — the search, filter and view controls
  that sit above the list, bound to the same useDataView instance.

## Cards

The overview composes itself from cards; the layout never knows what a card
contains.

- **CardLayout** (`cards/CardLayout`) — draws a set of cards in the saved order,
  owning only the chrome: position, folding, and the rearrange arrows.
- **CardShell** (`cards/CardShell`) — the box one card sits in: its heading,
  fold control and move arrows. A card with nothing to say draws nothing.
- **registry** (`cards/registry`) — the declarative set of cards and each
  card's `shows(ctx)` predicate, so which cards appear is worked out from the
  record.

## Identity and media

- **Avatar** (`ui/Avatar`) — a person or pet's photo, falling back to initials
  on a stable colour.
- **AvatarEditor** (`ui/AvatarEditor`) — crop and upload a photo, or choose a
  colour instead.
- **icons** (`ui/icons`) — the shared icon set. Add here rather than inlining a
  one-off SVG in a page.

## Capture and assistant

- **CaptureSheet** (`CaptureSheet`) — the thumb-reach capture control on a
  phone: write a note (the device microphone dictates into it) or take a photo.
- **IngestModal** (`IngestModal`) — upload or photograph a document and review
  Pare's proposed records field by field before any is written.
- **AttentionPanel** (`AttentionPanel`) — the "what needs attention" summary
  shown across a person or the whole homeboard.
- **ToneBlockNotice** (`ToneBlockNotice`) — the gentle notice shown when a
  message is held for tone.

## Chrome and preferences

- **InstallPrompt** (`InstallPrompt`) — a quiet offer to install to the home
  screen, only once the browser can and until it is acted on.
- **ThemeToggle**, **TextSizeToggle** — light/dark and text size, near the
  avatar.
- **PagePurpose** (`PagePurpose`) — the badge that marks a page as a place facts
  are entered or a place they are assembled, so the boundary stays visible.
- **UpgradePrompt**, **PricingPlans** — the SaaS upgrade surfaces, inert when
  self-hosted.

## Cross-cutting helpers

- **announce** (`lib/announce`) — speak a save, a queued note or a failure to a
  screen reader through the app's one polite live region. There is nowhere else
  to say these things.
- **buzz** (`lib/haptics`) — a short confirmation vibration on a save, silent
  under reduced motion.
- **captureQueue** (`lib/captureQueue`) — hold a note written offline and send
  it on reconnect, exactly once.

## Machine legibility

The app is meant to be as legible to an assistant driving it as to the person
using it. Two conventions carry that:

- **`data-record` / `data-field`** on record renderers. A card or table row
  carries `data-record` (the record id) and `data-record-kind`; a cell carries
  `data-field` (the field key). A screen reader and an assistant then read the
  same structure a person sees. Apply these when building a new renderer.
- **The action contract.** `GET /api/v1/actions` publishes the exact schema of
  every action Pare can take; `POST /api/v1/care-profiles/:id/actions` carries
  them out with the caller's own permissions, and its response returns an undo
  token for the changes that can be reversed. The published schema is the same
  one that constrains Pare's own output, so the documentation and the behaviour
  cannot drift apart.
