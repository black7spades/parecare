import { useEffect, useState } from 'react';

/**
 * Whether the floating Pare button should step out of the way. It floats over
 * the bottom corner of the screen, which is exactly where a window's Save
 * sits, so it goes while anything is open on top of the page (a window, the
 * record panel, the phone menu), and on a phone while someone is typing,
 * when the keyboard is up and the button only covers the form. It comes back
 * the moment either ends.
 */

const PHONE_QUERY = '(max-width: 767px)';

/**
 * Anything open over the page that the button would sit on top of. Only one
 * actually showing counts: the phone menu left open stays in the page but is
 * hidden on a wider screen, and must not keep the button away there.
 */
const overlayOpen = (): boolean =>
  Array.from(document.querySelectorAll('[aria-modal="true"]')).some((el) => el.getClientRects().length > 0);

/** Whether an element takes typing, so the phone keyboard is up for it. */
function takesTyping(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

export function usePareButtonAway(): boolean {
  const [overlay, setOverlay] = useState(false);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    // Windows open and close by being added to and taken out of the page, so
    // watching the page for them catches every one, wherever it comes from.
    const check = () => setOverlay(overlayOpen());
    check();
    const watcher = new MutationObserver(check);
    watcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    // Turning a tablet or widening a window can hide one without changing the page.
    window.addEventListener('resize', check);
    return () => {
      watcher.disconnect();
      window.removeEventListener('resize', check);
    };
  }, []);

  useEffect(() => {
    const phone = window.matchMedia(PHONE_QUERY);
    const update = () => setTyping(phone.matches && takesTyping(document.activeElement));
    // Focus leaving one box for the next fires out then in; reading the
    // focused element a moment later keeps the button from flickering back.
    const later = () => window.setTimeout(update, 0);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', later);
    phone.addEventListener('change', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', later);
      phone.removeEventListener('change', update);
    };
  }, []);

  return overlay || typing;
}
