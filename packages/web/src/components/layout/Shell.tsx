import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation, useMatch } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore, type AccountRole } from '../../stores/auth';
import { useSubscriptionStore } from '../../stores/subscription';
import { UpgradePrompt } from '../UpgradePrompt';
import { AssistantWidget } from '../assistant/AssistantWidget';
import { ThemeToggle } from '../ThemeToggle';
import { NotificationsBell } from './NotificationsBell';
import { AvatarMenu } from './AvatarMenu';
import { Clock } from './Clock';
import { Avatar } from '../ui/Avatar';
import { PROFILE_NAV, profileNavItem, type ProfileNavItem } from '../../pages/app/profile/tabs';
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

const navHeadingClass = 'pt-4 pb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-muted';

/**
 * One row of the profile nav: the section link plus a pin toggle that keeps
 * the section at the top of this carer's navigation. The pin is an
 * icon-only control (sanctioned by the style guide) shown on hover, focus,
 * or when already pinned.
 */
function ProfileNavRow({
  profileId,
  item,
  pinned,
  onTogglePin,
}: {
  profileId: string;
  item: ProfileNavItem;
  pinned: boolean;
  onTogglePin: (key: string) => void;
}) {
  return (
    <div className="group relative">
      <NavLink
        to={`/app/${profileId}${item.to ? `/${item.to}` : ''}`}
        end={item.end}
        className={navLinkClass}
      >
        <span className="truncate pr-5">{item.label}</span>
      </NavLink>
      <button
        type="button"
        aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label} to the top`}
        aria-pressed={pinned}
        onClick={() => onTogglePin(item.key)}
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-sm leading-none transition-opacity ${
          pinned
            ? 'text-primary opacity-100'
            : 'text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-primary'
        }`}
      >
        {pinned ? '★' : '☆'}
      </button>
    </div>
  );
}

/**
 * The left nav for an open care profile: this carer's pinned sections
 * first, then the grouped sections (Care profile, Conditions, Management,
 * Communications) with Overview, Logs and Ask PareCare at the top and
 * bottom.
 */
function ProfileSidebarNav({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['nav-pins', profileId],
    queryFn: () => api.get<{ pins: Array<{ item_key: string }> }>(`/care-profiles/${profileId}/nav-pins`),
  });
  const pinnedKeys = (data?.pins ?? []).map((p) => p.item_key);

  const savePins = useMutation({
    mutationFn: (item_keys: string[]) => api.put(`/care-profiles/${profileId}/nav-pins`, { item_keys }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['nav-pins', profileId] }),
  });

  const togglePin = (key: string) => {
    const next = pinnedKeys.includes(key) ? pinnedKeys.filter((k) => k !== key) : [...pinnedKeys, key];
    savePins.mutate(next);
  };

  const pinnedItems = pinnedKeys
    .map((key) => profileNavItem(key))
    .filter((i): i is ProfileNavItem => !!i);

  return (
    <>
      <NavLink to="/app" className={navLinkClass}>
        <span aria-hidden>←</span> All people
      </NavLink>
      {pinnedItems.length > 0 ? (
        <>
          <div className={navHeadingClass}>Pinned</div>
          {pinnedItems.map((item) => (
            <ProfileNavRow key={`pin-${item.key}`} profileId={profileId} item={item} pinned onTogglePin={togglePin} />
          ))}
        </>
      ) : null}
      {PROFILE_NAV.map((group) => (
        <div key={group.key}>
          {group.label ? <div className={navHeadingClass}>{group.label}</div> : <div className="my-2 border-t border-border" />}
          {group.items
            .filter((item) => !pinnedKeys.includes(item.key))
            .map((item) => (
              <ProfileNavRow
                key={item.key}
                profileId={profileId}
                item={item}
                pinned={false}
                onTogglePin={togglePin}
              />
            ))}
        </div>
      ))}
    </>
  );
}

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
    profileMatch?.params.profileId && profileMatch.params.profileId !== 'profiles' && profileMatch.params.profileId !== 'directory'
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
        can_create_care_profiles: boolean;
      }>('/auth/me')
      .then((me) =>
        updateAccount({
          role: me.role,
          avatar_url: me.avatar_url,
          avatar_color: me.avatar_color,
          subscription_tier: me.subscription_tier,
          subscription_status: me.subscription_status,
          can_create_care_profiles: me.can_create_care_profiles,
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
    <ProfileSidebarNav profileId={profileId} />
  ) : (
    <>
      <NavLink to="/app" end className={navLinkClass}>
        Homeboard
      </NavLink>
      <div className={navHeadingClass}>Directory</div>
      <NavLink to="/app/directory/people" className={navLinkClass}>
        People
      </NavLink>
      <NavLink to="/app/directory/pets" className={navLinkClass}>
        Pets
      </NavLink>
      <NavLink to="/app/directory/providers" className={navLinkClass}>
        Providers
      </NavLink>
      <div className={navHeadingClass}>Tools</div>
      <NavLink to="/app/reports" className={navLinkClass}>
        Reports
      </NavLink>
      {pinned.length > 0 ? (
        <>
          <div className={navHeadingClass}>Pinned</div>
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
          <Clock />
          <NotificationsBell />
          <AvatarMenu />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar */}
        <nav className="hidden lg:flex w-56 shrink-0 bg-card border-r border-border flex-col py-5 px-4 overflow-y-auto">
          <div className="flex-1 space-y-1">{sidebarNav}</div>
          <div className="pt-4 mt-4 border-t border-border px-3">
            <ThemeToggle />
          </div>
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
              <div className="pt-4 mt-4 border-t border-border px-3">
                <ThemeToggle />
              </div>
            </nav>
          </div>
        ) : null}

        <main className="flex-1 min-w-0 overflow-auto bg-surface">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            <Outlet />
          </div>
        </main>
      </div>

      <AssistantWidget />
      <UpgradePrompt />
    </div>
  );
}
