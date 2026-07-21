# PareCare UI style guide

Every new or changed piece of UI must comply with this guide before it
ships. When reviewing a change, walk the checklist at the bottom. When a
rule here conflicts with an older pattern in the codebase, this guide
wins; fix the old pattern rather than copying it.

## Controls

**Links navigate, buttons act.** This is the single most important rule.

- Anything that changes state, opens a modal or panel, toggles, expands,
  dismisses, saves, deletes or talks to the assistant is an **action**
  and must be rendered with the `Button` component
  (`src/components/ui/Button.tsx`). Never hand-roll a `<button>` with
  link or text styling.
- Anything that takes the user to another page is **navigation** and is
  rendered as a `Link` or `<a>` styled `text-primary hover:underline`.
- One exception: an entity name in a table or list that opens that
  record's viewer may be styled as a link even when implemented as a
  button, because to the user it is navigation.
- Icon-only controls are allowed only for the remove cross on a chip,
  reorder arrows in an editable list, sort indicators in table column
  headers, card collapse chevrons, pin toggles, navigation collapse
  controls (group chevrons, expand all and collapse all, and the
  sidebar show and hide toggle), and the per-row action set in a dense
  data table (Record dose, Order, Edit, Delete and the like), always
  with both an `aria-label` and a matching `title` tooltip so the icon's
  meaning is never in doubt. Muted colour at rest; destructive ones turn
  red on hover.
- Segmented view switches, such as a cards and table toggle, are a
  distinct control: a pill group where the active option has
  `bg-card text-ink font-medium shadow-sm` and inactive options are
  `text-muted hover:text-ink`.

### Button variants and when to use them

| Variant | Use for | Rule |
| --- | --- | --- |
| `primary` | The single main action of a page, card or modal | At most one visible per surface |
| `secondary` | Supporting standalone actions | Toolbars, card headers, per-row featured action |
| `ghost` | Low-emphasis actions | Cancel, Hide and Show toggles, Select all, row actions like Edit |
| `ghost-danger` | Destructive actions inside rows and lists | Delete, Remove, Revoke, Unlink at row level |
| `danger` | Destructive confirmation and bulk destructive actions | The confirm button in a delete modal, "Delete selected" in a toolbar |

### Button sizes and when to use them

| Size | Use for |
| --- | --- |
| `md` | Standalone actions: forms, modals, page headers |
| `sm` | Toolbars, card headers, filter bars |
| `xs` | Inside table rows and dense list items |

## Typography scale

Four sizes, four jobs. Do not invent intermediate ones.

| Style | Use for |
| --- | --- |
| `text-2xl font-bold text-ink` | Page title, one per page |
| `text-sm font-semibold text-ink` | Card and panel headings |
| `text-sm text-ink` | Body text, table cells, form labels |
| `text-xs text-muted` | Metadata: counts, timestamps, captions, helper text |

## Action vocabulary

One word per concept, one concept per word. Never use two of these
interchangeably, and never invent a chatty synonym.

| Word | Meaning |
| --- | --- |
| Hide / Show | Collapse or expand a panel. Purely visual, nothing is lost |
| Dismiss | Take an item out of a list until its underlying state changes |
| Delete | Permanently destroy data |
| Remove | Take something out of a set without destroying it |
| Unlink | Break a connection between two records |
| Cancel | Abandon the current edit or dialog without saving |
| Edit | Open the record for changing |
| Ask Pare | Open the assistant, primed with the relevant context |

Labels are verbs that say what will happen. "Dismiss", "Edit",
"Ask Pare". Never vague or chatty labels like "Let's do it", "Go",
"Sort it" that force the user to guess the outcome.

## Emphasis and layout

- At most one `primary` button per surface. If everything is important,
  nothing is.
- In a group of row actions, order weakest to strongest left to right,
  destructive actions last.
- Confirmation modals only for destructive or irreversible actions.
  Reversible actions act immediately.
- Urgent or warning states use the red scale
  (`bg-red-50 text-red-700 dark:bg-red-900/10 dark:text-red-300`) with a
  left border accent, plus a small uppercase badge if a label is needed.

## Data tables

Any table that lists records (people, pets, providers, addresses,
medications, substances, doses, and so on) is a data table and follows one
pattern, by default and without being asked:

- **Every column header is sortable**, ascending then descending on repeat
  clicks, using the shared `SortableTh` wired to a `useDataView` instance.
  There is no such thing as a data table with some sortable columns and some
  fixed ones; every visible column gets a comparator. This is the default for
  every new table and every table you touch, not an enhancement to request.
- Search, filters, pagination and any bulk actions use the shared
  `DataToolbar` and `useDataView`, so behaviour is identical everywhere.
- One column per data point (see the copy rules); each column sorts and
  filters independently.

If you add or edit a table and it is not sortable this way, the change is not
finished.

## Copy rules

These repeat the non-negotiables from CLAUDE.md:

- Never use parentheses in headings.
- No jargon without a plain-language equivalent, tooltip or legend.
- Never use em dashes in UI copy.
- Never combine two data points into one field, cell or input.

## Review checklist

Before shipping any UI change, confirm:

1. Every action uses the `Button` component with the correct variant and
   size from the tables above. No hand-rolled `<button>` styling.
2. Link styling appears only on navigation.
3. At most one `primary` button is visible per surface.
4. Every action label is a verb from the vocabulary table, or a new verb
   that says exactly what happens.
5. Font sizes come from the typography scale.
6. Destructive actions are `ghost-danger` or `danger` and irreversible
   ones have a confirmation step.
7. Copy rules pass: no parentheses in headings, no unexplained jargon,
   no em dashes, no combined data points.
8. Every data table has sortable headers (ascending/descending) on all
   columns via `SortableTh` and `useDataView`. No table ships with fixed,
   unsortable headers.
