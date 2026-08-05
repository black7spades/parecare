import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { Avatar } from '../ui/Avatar';
import { ThemeToggle } from '../ThemeToggle';
import { TextSizeToggle } from '../TextSizeToggle';
import { SignOutIcon } from '../ui/icons';

/** Top-right account menu: profile, settings and system tools, the theme and
 * text size controls, and Sign out at the very bottom. */
export function AvatarMenu() {
  const { account } = useAuthStore();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isAdmin = account?.role === 'admin' || account?.role === 'super_admin';

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!account) return null;

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const item = 'w-full text-left px-4 py-2 text-sm text-ink hover:bg-surface-2 transition-colors';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full p-0.5 hover:ring-2 hover:ring-border transition"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar accountId={account.id} name={account.display_name} avatarUrl={account.avatar_url} color={account.avatar_color} size={34} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-card shadow-xl py-1 z-50"
        >
          <div className="px-4 py-2 border-b border-border">
            <div className="text-sm font-medium text-ink truncate">{account.display_name}</div>
            <div className="text-xs text-muted truncate">{account.email}</div>
          </div>
          <button type="button" role="menuitem" className={item} onClick={() => go('/account/profile')}>
            Profile
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => go('/account/settings')}>
            Settings
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => go('/account/notifications')}>
            Notifications
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => go('/account/subscription')}>
            Subscription
          </button>
          {isAdmin ? (
            <button type="button" role="menuitem" className={item} onClick={() => go('/system')}>
              System
            </button>
          ) : null}
          {/* Theme and text size sit here, near the profile picture. Clicking a
              toggle changes it in place without closing the menu. */}
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-border px-4 py-2 pt-2.5">
            <ThemeToggle />
            <TextSizeToggle />
          </div>
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              role="menuitem"
              className={`${item} flex items-center gap-2`}
              onClick={() => { setOpen(false); clearAuth(); navigate('/login'); }}
            >
              <SignOutIcon size={14} />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
