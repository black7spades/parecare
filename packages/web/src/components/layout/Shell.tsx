import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation, useMatch } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore, type AccountRole } from '../../stores/auth';
import { useSubscriptionStore } from '../../stores/subscription';
import { UpgradePrompt } from '../UpgradePrompt';
import { AssistantWidget } from '../assistant/AssistantWidget';
import { ThemeToggle } from '../ThemeToggle';
import { AvatarMenu } from './AvatarMenu';
import { Avatar } from '../ui/Avatar';
import { PROFILE_TABS } from '../../pages/app/profile/tabs';
import { api } from '../../api/client';

interface PinnedProfile {
  id: string;
  full_name: string;
  preferred_name: string | null;
  photo_url: string | null;
  photo_color: string | null;
}

function TierBadge() {
  const tier = useSubscriptionStore((s) => s.tier);
  const navigate = useNavigate();
  if (!tier || tier === 'free') return null;

  return (
    <button
      onClick={() => navigate('/account/subscription')}
      className="badge bg-primary-50 text-primary capitalize cursor-pointer hover:bg-primary-100 transition-colors hidden sm:inline-flex"
    >
      {tier}
    </button>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
    isActive ? 'bg-primary-50 text-primary font-medium' : 'text-muted hover:text-ink hover:bg-surface-2'
  }`;

export function Shell() {
  const updateAccount = useAuthStore((s) => s.updateAccount);
  const role = useAuthStore((s) => s.account?.role);
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The logo returns the viewer to the highest-level dashboard they can reach:
  // the system overview for admins and super admins, otherwise the care home.
  const homeDest = role === 'admin' || role === 'super_admin' ? '/system' : '/app';

  // Detect whether a care profile is open, so the left nav can switch to that
  // profile's sections. Exclude the "profiles/new" route.
  const profileMatch = useMatch('/app/:profileId/*');
  const profileId =
    profileMatch?.params.profileId && profileMatch.params.profileId !== 'profiles'
      ? profileMatch.params.profileId
      : null;

  // Refresh account info so role/tier/avatar changes apply without re-login
  useEffect(() => {
    api
      .get<{
        role: AccountRole;
        avatar_url: string | null;
        avatar_color: string | null;
        subscription_tier: 'free' | 'family' | 'professional';
        subscription_status: string | null;
      }>('/auth/me')
      .then((me) =>
        updateAccount({
          role: me.role,
          avatar_url: me.avatar_url,
          avatar_color: me.avatar_color,
          subscription_tier: me.subscription_tier,
          subscription_status: me.subscription_status,
        })
      )
      .catch(() => {
        // 401 already clears auth via the api client
      });
  }, [updateAccount]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const { data: pinnedData } = useQuery({
    queryKey: ['pinned-profiles'],
    queryFn: () => api.get<{ profiles: PinnedProfile[] }>('/care-profiles/pinned'),
  });
  const pinned = pinnedData?.profiles ?? [];

  const sidebarNav = profileId ? (
    <>
      <NavLink to="/app" className={navLinkClass}>
        <span aria-hidden>←</span> All people
      </NavLink>
      <div className="my-2 border-t border-border" />
      {PROFILE_TABS.map((tab) => (
        <NavLink
          key={tab.label}
          to={`/app/${profileId}${tab.to ? `/${tab.to}` : ''}`}
          end={tab.end}
          className={navLinkClass}
        >
          {tab.label}
        </NavLink>
      ))}
    </>
  ) : (
    <>
      <NavLink to="/app" end className={navLinkClass}>
        Dashboard
      </NavLink>
      {pinned.length > 0 ? (
        <>
          <div className="pt-4 pb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-muted">Pinned</div>
          {pinned.map((p) => (
            <NavLink key={p.id} to={`/app/${p.id}`} className={navLinkClass}>
              <Avatar accountId={p.id} name={p.full_name} avatarUrl={p.photo_url} color={p.photo_color} fetchPath={`/care-profiles/${p.id}/photo`} size={22} />
              <span className="truncate">{p.preferred_name || p.full_name}</span>
            </NavLink>
          ))}
        </>
      ) : null}
    </>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 flex items-center justify-between bg-card border-b border-border px-3 sm:px-4 h-14 z-30">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="lg:hidden -ml-1 p-2 rounded-md text-muted hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <NavLink to={homeDest} aria-label="PareCare home" className="text-lg font-semibold text-primary hover:opacity-80 transition-opacity">
            PareCare
          </NavLink>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <TierBadge />
          <ThemeToggle />
          <AvatarMenu />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar */}
        <nav className="hidden lg:flex w-56 shrink-0 bg-card border-r border-border flex-col py-5 px-4 overflow-y-auto">
          <div className="flex-1 space-y-1">{sidebarNav}</div>
        </nav>

        {/* Mobile slide-in drawer */}
        {drawerOpen ? (
          <div className="lg:hidden fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} aria-hidden />
            <nav className="absolute inset-y-0 left-0 w-64 max-w-[80%] bg-card border-r border-border flex flex-col py-5 px-4 shadow-xl overflow-y-auto">
              <div className="mb-4 flex items-center justify-between">
                <NavLink to={homeDest} onClick={() => setDrawerOpen(false)} aria-label="PareCare home" className="text-lg font-semibold text-primary hover:opacity-80 transition-opacity">
                  PareCare
                </NavLink>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close menu"
                  className="p-1 rounded-md text-muted hover:text-ink hover:bg-surface-2 transition-colors"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 space-y-1">{sidebarNav}</div>
            </nav>
          </div>
        ) : null}

        <main className="flex-1 min-w-0 overflow-auto bg-surface">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            <Outlet />
          </div>
        </main>
      </div>

      <AssistantWidget profileId={profileId} />
      <UpgradePrompt />
    </div>
  );
}
