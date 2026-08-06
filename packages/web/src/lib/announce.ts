/**
 * One polite live region for the whole app, so a save, a queued note or a
 * failure is spoken to a screen reader as well as shown. The app had nowhere to
 * say these things; this is that place. Kept off-screen and reused for every
 * announcement.
 */
let node: HTMLElement | null = null;

function region(): HTMLElement {
  if (node && document.body.contains(node)) return node;
  node = document.createElement('div');
  node.setAttribute('aria-live', 'polite');
  node.setAttribute('aria-atomic', 'true');
  node.className = 'sr-only';
  document.body.appendChild(node);
  return node;
}

export function announce(message: string): void {
  const el = region();
  // Clearing first makes an identical repeat announce again.
  el.textContent = '';
  window.setTimeout(() => {
    el.textContent = message;
  }, 40);
}
