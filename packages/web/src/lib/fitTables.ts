import { useEffect } from 'react';

/**
 * Tables never scroll sideways.
 *
 * Every table sits in a wrapper with the `fit-table` class. While all its
 * columns fit the width it has, it shows as an ordinary table with every
 * column. When they would not fit, on a phone or a narrow window, each row
 * becomes a card instead: every value on its own line under its column's
 * name, and the column headings become a row of sort buttons above.
 *
 * One watcher at the root does this for every table, so a new table only
 * needs the class on its wrapper.
 */
const STACKED = 'fit-stacked';
/** The step before cards: cells wrap their words and sit closer together. */
const TIGHT = 'fit-tight';

/** A heading's words, leaving out the sort arrow and anything else only drawn. */
function headingText(th: Element): string {
  const copy = th.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Name each cell after its column, so a stacked card can say what each value is. */
function label(table: HTMLTableElement) {
  const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!headRow) return;
  const names: string[] = [];
  for (const th of Array.from(headRow.cells)) {
    const name = headingText(th);
    for (let i = 0; i < th.colSpan; i++) names.push(name);
  }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        const name = cell.colSpan === 1 ? names[col] ?? '' : '';
        if ((cell.getAttribute('data-label') ?? '') !== name) {
          if (name) cell.setAttribute('data-label', name);
          else cell.removeAttribute('data-label');
        }
        col += cell.colSpan;
      }
    }
  }
}

function fit(wrapper: HTMLElement) {
  const table = wrapper.querySelector('table');
  if (!table) return;
  label(table);
  // Measure as a table, then as a tighter table, then decide. All of it
  // happens before the next paint, so nothing flickers.
  const pageWidth = document.documentElement.clientWidth;
  const over = () => table.scrollWidth > wrapper.clientWidth + 1 || wrapper.getBoundingClientRect().right > pageWidth + 1;
  wrapper.classList.remove(STACKED, TIGHT);
  if (!over()) return;
  wrapper.classList.add(TIGHT);
  if (!over()) return;
  wrapper.classList.remove(TIGHT);
  wrapper.classList.add(STACKED);
}

function fitAll(watch: (el: HTMLElement) => void) {
  document.querySelectorAll<HTMLElement>('.fit-table').forEach((el) => {
    watch(el);
    fit(el);
  });
}

/** Mount once at the root. */
export function useFitTables() {
  useEffect(() => {
    let frame = 0;
    // A table's room changes when the sidebar folds or a side panel opens,
    // not only when the window does. Height changes are ignored, so turning
    // rows into cards never sets off another round.
    const widths = new WeakMap<Element, number>();
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const w = Math.round(e.contentRect.width);
        if (widths.get(e.target) !== w) {
          widths.set(e.target, w);
          changed = true;
        }
      }
      if (changed) schedule();
    });
    const watched = new WeakSet<Element>();
    const watch = (el: HTMLElement) => {
      if (watched.has(el)) return;
      watched.add(el);
      widths.set(el, Math.round(el.getBoundingClientRect().width));
      ro.observe(el);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; fitAll(watch); });
    };
    // Only content changes count; the classes and labels set here do not.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
