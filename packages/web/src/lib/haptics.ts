/**
 * A short confirmation buzz when something is saved, so a capture is felt as
 * well as seen. Silent under reduced motion, and never allowed to break a save
 * on a device without a vibrator.
 */
export function buzz(pattern: number | number[] = 15): void {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate?.(pattern);
  } catch {
    /* vibration is a nicety, never a requirement */
  }
}
