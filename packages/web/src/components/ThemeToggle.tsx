import { useState } from 'react';
import { getTheme, setTheme, type Theme } from '../lib/theme';

const ORDER: Theme[] = ['light', 'dark', 'system'];
const LABELS: Record<Theme, string> = { light: '☀ Light', dark: '☾ Dark', system: '◑ Auto' };

/** Cycles light → dark → follow-the-device. */
export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(getTheme);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    setLocal(next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      title="Switch between light, dark, and device theme"
      className="text-xs text-muted hover:text-ink transition-colors"
    >
      {LABELS[theme]}
    </button>
  );
}
