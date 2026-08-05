/**
 * Situational comfort. Two kinds of thing live here.
 *
 * Text size is the one comfort we let a person choose, because nothing in the
 * record tells us they need PareCare larger than the rest of their phone, and
 * guessing wrong makes it unusable. Three steps, defaulting to the device.
 *
 * Everything else that helps (reduced motion, higher contrast, one-handed
 * reach) is inferred from what the device already tells us and never asked
 * for, so it is handled in CSS and layout, not here.
 *
 * The mechanism copies theme.ts exactly: a value in localStorage, applied as an
 * attribute on the root element, and set before paint by the inline script in
 * index.html so there is no flash of the wrong size.
 */

export type TextSize = 'default' | 'large' | 'larger';

const STORAGE_KEY = 'parecare-text-size';

export function getTextSize(): TextSize {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'large' || stored === 'larger' ? stored : 'default';
}

export function applyTextSize(size: TextSize): void {
  const root = document.documentElement;
  if (size === 'default') root.removeAttribute('data-text-size');
  else root.setAttribute('data-text-size', size);
}

export function setTextSize(size: TextSize): void {
  localStorage.setItem(STORAGE_KEY, size);
  applyTextSize(size);
}

/** Apply the saved text size on startup. */
export function initComfort(): void {
  applyTextSize(getTextSize());
}
