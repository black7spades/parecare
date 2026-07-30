/**
 * What sits in the content area while a page that loads on demand arrives.
 *
 * Deliberately one quiet line rather than a spinner or a skeleton. It is
 * usually on screen for a fraction of a second, and a shape that pretends to
 * be the page is worse than a sentence when it turns out to be wrong.
 *
 * Each layout wraps its own outlet in this, so the navigation and the header
 * stay put and only the part that is actually still coming is replaced.
 */
export function RouteFallback() {
  return (
    <p className="text-sm text-muted" role="status" aria-live="polite">
      Loading.
    </p>
  );
}
