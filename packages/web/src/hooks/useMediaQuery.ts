import { useEffect, useState } from 'react';

/**
 * Track a CSS media query in React, so a component can branch on the viewport
 * or a device preference (reduced motion, a narrow phone) and stay in step as
 * it changes. The first and only such branch in the app was a hand-rolled
 * matchMedia inside the assistant widget; this is the shared primitive.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
