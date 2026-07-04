import { useEffect, useState } from 'react';
import { api } from '../../api/client';

/**
 * Circular avatar for an account. Fetches the image as an authenticated blob
 * (an <img> tag can't send the auth header) when the account has one, and
 * falls back to initials otherwise.
 */
export function Avatar({
  accountId,
  name,
  avatarUrl,
  size = 32,
}: {
  accountId: string;
  name: string;
  avatarUrl?: string | null;
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
      .blob(`/auth/avatar/${accountId}`)
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
  }, [accountId, avatarUrl]);

  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-primary-50 text-primary font-semibold overflow-hidden shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden={!src}
    >
      {src ? <img src={src} alt={name} className="w-full h-full object-cover" /> : initials || '?'}
    </span>
  );
}
