export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'parecare-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function resolve(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', resolve(theme) === 'dark');
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

/** Apply on startup and track OS changes while in "system" mode. */
export function initTheme(): void {
  applyTheme(getTheme());
  media.addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system');
  });
}
