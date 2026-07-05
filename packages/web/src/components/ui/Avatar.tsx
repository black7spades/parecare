import { useEffect, useState } from 'react';
import { api } from '../../api/client';

/** Classic Commodore 64 palette (colodore), for avatar backgrounds. */
export const C64_PALETTE = [
  '#000000', '#FFFFFF', '#813338', '#75CEC8',
  '#8E3C97', '#56AC4D', '#2E2C9B', '#EDF171',
  '#8E5029', '#553800', '#C46C71', '#4A4A4A',
  '#7B7B7B', '#A9FF9F', '#706DEB', '#B2B2B2',
];

/** Pick black or white text for legibility on a given hex background. */
export function contrastText(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111111' : '#FFFFFF';
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Circular avatar. Shows the image (fetched as an authenticated blob, since an
 * <img> can't send the auth header) when one is set; otherwise a chosen
 * background colour with initials; otherwise the default tint with initials.
 */
export function Avatar({
  accountId,
  name,
  avatarUrl,
  color,
  fetchPath,
  size = 32,
}: {
  accountId: string;
  name: string;
  avatarUrl?: string | null;
  color?: string | null;
  fetchPath?: string;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!avatarUrl) {
      setSrc(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    void api
      .blob(fetchPath ?? `/auth/avatar/${accountId}`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, avatarUrl, fetchPath]);

  const initials = initialsOf(name) || '?';
  const bg = !src && color ? { backgroundColor: color, color: contrastText(color) } : undefined;

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 font-semibold ${
        bg ? '' : 'bg-primary-50 text-primary'
      }`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ...bg }}
      aria-hidden={!src}
    >
      {src ? <img src={src} alt={name} className="w-full h-full object-cover" /> : initials}
    </span>
  );
}
