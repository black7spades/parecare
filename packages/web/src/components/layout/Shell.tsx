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
import { browserTimeZone } from '../../lib/datetime';
import { NavSortControl, type SortOption } from './NavSortControl';
import { SortableNavGroup, type NavItemDef } from './SortableNavGroup';
import { navHeadingClass, navLinkClass } from './navStyles';
import { VersionBadge } from './VersionBadge';
import { ProfileSwitcher } from './ProfileSwitcher';
import { AssetIcon, CheckIcon, ChartIcon, MapPinIcon, PawIcon, SignOutIcon, StethoscopeIcon, StoreIcon, UsersIcon } from '../ui/icons';

interface PinnedProfile {
  id: string;
  full_name: string;
  preferred_name: string | null;
  photo_url: string | null;
  photo_color: string | null;
  sort_order: number;
  last_activity: string | null;
}

// The Directory and Tools nav groups, each item with a small icon. Arranged
// from a per-group sort dropdown (default, A-Z, Z-A, or a locked custom order).
const DIRECTORY_NAV: NavItemDef[] = [
  { key: 'people', label: 'People', to: '/app/directory/people', icon: <UsersIcon size={16} /> },
  { key: 'pets', label: 'Pets', to: '/app/directory/pets', icon: <PawIcon size={16} /> },
  { key: 'providers', label: 'Providers', to: '/app/directory/providers', icon: <StethoscopeIcon size={16} /> },
  { key: 'suppliers', label: 'Suppliers', to: '/app/directory/suppliers', icon: <StoreIcon size={16} /> },
  { key: 'assets', label: 'Assets', to: '/app/directory/assets', icon: <AssetIcon size={16} /> },
  { key: 'addresses', label: 'Addresses', to: '/app/directory/addresses', icon: <MapPinIcon size={16} /> },
];

const TOOLS_NAV: NavItemDef[] = [
  { key: 'reports', label: 'Reports', to: '/app/reports', icon: <ChartIcon size={16} /> },
];

// First-segment names under /app that are top-level sections, not a care
// profile id. On these the sidebar keeps the main nav instead of switching to
// a profile's sub-nav.
const RESERVED_APP_SECTIONS = new Set(['profiles', 'directory', 'reports']);

type PinArrangement = 'recent' | 'az' | 'za' | 'custom';

const PIN_ARRANGE_KEY = 'parecare-pin-arrangement';
const PIN_EDITING_KEY = 'parecare-pin-editing';
const PIN_ARRANGE_OPTIONS: SortOption<PinArrangement>[] = [
  { value: 'recent', label: 'Recent activity' },
  { value: 'az', label: 'A to Z' },
  { value: 'za', label: 'Z to A' },
  { value: 'custom', label: 'Custom order' },
];

function readPinArrangement(): PinArrangement {
  const v = localStorage.getItem(PIN_ARRANGE_KEY);
  return v === 'az' || v === 'za' || v === 'custom' || v === 'recent' ? v : 'recent';
}
function readPinEditing(): boolean {
  return localStorage.getItem(PIN_EDITING_KEY) === '1';
}

const pinName = (p: PinnedProfile) => p.preferred_name || p.full_name;

function arrangePins(pins: PinnedProfile[], arrangement: PinArrangement): PinnedProfile[] {
  const list = [...pins];
  switch (arrangement) {
    case 'az':
      return list.sort((a, b) => pinName(a).localeCompare(pinName(b)));
    case 'za':
      return list.sort((a, b) => pinName(b).localeCompare(pinName(a)));
    case 'recent':
      return list.sort((a, b) => (b.last_activity ?? '').localeCompare(a.last_activity ?? ''));
    case 'custom':
    default:
      // The server already orders by sort_order; keep it as-is.
      return list;
  }
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
  showPip,
}: {
  profileId: string;
  item: ProfileNavItem;
  pinned: boolean;
  onTogglePin: (key: string) => void;
  /** A small dot signalling something new to see in this section. */
  showPip?: boolean;
}) {
  const Icon = item.icon;
  return (
    <div className="group relative">
      <NavLink
        to={`/app/${profileId}${item.to ? `/${item.to}` : ''}`}
        end={item.end}
        className={navLinkClass}
      >
        <span className="flex items-center gap-1.5 truncate pr-5">
          <span aria-hidden className="shrink-0 text-muted">
            <Icon size={16} />
          </span>
          <span className="truncate">{item.label}</span>
          {showPip ? (
            <span aria-hidden title="Ready to review" className="h-2 w-2 shrink-0 rounded-full bg-primary" />
          ) : null}
        </span>
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

const COLLAPSED_GROUPS_KEY = 'profile-nav-collapsed-groups';

function readCollapsedGroups(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/** A small chevron that points right when closed and down when open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

/**
 * The left nav for an open care profile: this carer's pinned sections
 * first, then the grouped sections (Care profile, Conditions, Management,
 * Communications) with Overview, Logs and Ask PareCare at the top and
 * bottom. Group headings expand and collapse on click, remembered across
 * visits, with an expand-all and collapse-all control at the top.
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

  // Share the bell's feed (same query key) to light a pip on a section when
  // there is something new to see there. Right now that is a freshly generated
  // care plan waiting on the Care plan page.
  const tz = browserTimeZone();
  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{ items: Array<{ kind: string; profile_id: string; read: boolean }> }>(
        `/notifications${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`
      ),
    refetchInterval: 60_000,
  });
  const planReady = (notifData?.items ?? []).some(
    (i) => i.kind === 'care_plan_ready' && i.profile_id === profileId && !i.read
  );
  const pipFor = (key: string): boolean => key === 'plan' && planReady;

  const togglePin = (key: string) => {
    const next = pinnedKeys.includes(key) ? pinnedKeys.filter((k) => k !== key) : [...pinnedKeys, key];
    savePins.mutate(next);
  };

  const pinnedItems = pinnedKeys
    .map((key) => profileNavItem(key))
    .filter((i): i is ProfileNavItem => !!i);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups);
  const persistCollapsed = (next: Set<string>) => {
    setCollapsedGroups(next);
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...next]));
  };
  const toggleGroup = (key: string) => {
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persistCollapsed(next);
  };
  const collapsibleKeys = PROFILE_NAV.filter((g) => g.label).map((g) => g.key);
  const anyCollapsed = collapsibleKeys.some((k) => collapsedGroups.has(k));

  return (
    <>
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0">
          <NavLink to="/app" className={navLinkClass}>
            <span aria-hidden>←</span> All people
          </NavLink>
        </div>
        <button
          type="button"
          aria-label={anyCollapsed ? 'Expand all groups' : 'Collapse all groups'}
          title={anyCollapsed ? 'Expand all groups' : 'Collapse all groups'}
          onClick={() => persistCollapsed(anyCollapsed ? new Set() : new Set(collapsibleKeys))}
          className="shrink-0 p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface-2 transition-colors"
        >
          {anyCollapsed ? (
            /* Expand all: chevrons pointing apart */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="7 9 12 4 17 9" />
              <polyline points="7 15 12 20 17 15" />
            </svg>
          ) : (
            /* Collapse all: chevrons pointing together */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="7 4 12 9 17 4" />
              <polyline points="7 20 12 15 17 20" />
            </svg>
          )}
        </button>
      </div>
      {pinnedItems.length > 0 ? (
        <>
          <div className={navHeadingClass}>Pinned</div>
          {pinnedItems.map((item) => (
            <ProfileNavRow key={`pin-${item.key}`} profileId={profileId} item={item} pinned onTogglePin={togglePin} showPip={pipFor(item.key)} />
          ))}
        </>
      ) : null}
      {PROFILE_NAV.map((group) => {
        const isCollapsed = group.label ? collapsedGroups.has(group.key) : false;
        return (
          <div key={group.key}>
            {group.label ? (
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() => toggleGroup(group.key)}
                className={`${navHeadingClass} w-full flex items-center justify-between gap-1 hover:text-ink transition-colors`}
              >
                {group.label}
                <Chevron open={!isCollapsed} />
              </button>
            ) : (
              <div className="my-2 border-t border-border" />
            )}
            {!isCollapsed
              ? group.items
                  .filter((item) => !pinnedKeys.includes(item.key))
                  .map((item) => (
                    <ProfileNavRow
                      key={item.key}
                      profileId={profileId}
                      item={item}
                      pinned={false}
                      onTogglePin={togglePin}
                      showPip={pipFor(item.key)}
                    />
                  ))
              : null}
          </div>
        );
      })}
    </>
  );
}

/**
 * The top-level "Pinned" list in the main nav: this carer's pinned care
 * profiles, arranged by most recent activity, name, or a manually fixed
 * custom order. In custom order each row gains up and down controls to move
 * it and a control to unpin it; the order is saved for this carer.
 */
function PinnedProfilesNav({ pinned }: { pinned: PinnedProfile[] }) {
  const queryClient = useQueryClient();
  const [arrangement, setArrangement] = useState<PinArrangement>(readPinArrangement);
  const [editing, setEditing] = useState<boolean>(readPinEditing);

  const setPinEditing = (v: boolean) => {
    setEditing(v);
    localStorage.setItem(PIN_EDITING_KEY, v ? '1' : '0');
  };
  const setArrange = (next: PinArrangement) => {
    setArrangement(next);
    localStorage.setItem(PIN_ARRANGE_KEY, next);
    // Entering custom order opens the reorder controls; any other order hides
    // them. The tick locks the custom order back in place.
    setPinEditing(next === 'custom');
  };

  const saveOrder = useMutation({
    mutationFn: (ids: string[]) => api.put('/care-profiles/pins/order', { ids }),
    onMutate: async (ids: string[]) => {
      await queryClient.cancelQueries({ queryKey: ['pinned-profiles'] });
      const prev = queryClient.getQueryData<{ profiles: PinnedProfile[] }>(['pinned-profiles']);
      if (prev) {
        const byId = new Map(prev.profiles.map((p) => [p.id, p]));
        const reordered = ids
          .map((id, i) => {
            const p = byId.get(id);
            return p ? { ...p, sort_order: i } : null;
          })
          .filter((p): p is PinnedProfile => !!p);
        queryClient.setQueryData(['pinned-profiles'], { profiles: reordered });
      }
      return { prev };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['pinned-profiles'], ctx.prev);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['pinned-profiles'] }),
  });

  const unpin = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${id}/pin`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pinned-profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
    },
  });

  if (pinned.length === 0) return null;

  const ordered = arrangePins(pinned, arrangement);
  const isEditing = arrangement === 'custom' && editing;

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const ids = ordered.map((p) => p.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved);
    saveOrder.mutate(ids);
  };

  return (
    <>
      <div className={`${navHeadingClass} flex items-center justify-between gap-1`}>
        <span>Pinned</span>
        <div className="flex items-center gap-0.5">
          {isEditing ? (
            <button
              type="button"
              aria-label="Lock pinned order"
              title="Lock the order"
              onClick={() => setPinEditing(false)}
              className="p-1 rounded text-primary hover:bg-surface-2 transition-colors"
            >
              <CheckIcon />
            </button>
          ) : null}
          <NavSortControl
            value={arrangement}
            options={PIN_ARRANGE_OPTIONS}
            onChange={setArrange}
            ariaLabel="Arrange pinned people"
          />
        </div>
      </div>
      {ordered.map((p, i) => (
        <div key={p.id} className="flex items-center gap-1">
          <NavLink
            to={`/app/${p.id}`}
            className={({ isActive }) => `${navLinkClass({ isActive })} flex-1 min-w-0`}
          >
            <Avatar accountId={p.id} name={p.full_name} avatarUrl={p.photo_url} color={p.photo_color} fetchPath={`/care-profiles/${p.id}/photo`} size={22} />
            <span className="truncate">{pinName(p)}</span>
          </NavLink>
          {isEditing ? (
            <div className="flex items-center shrink-0">
              <button
                type="button"
                aria-label={`Move ${pinName(p)} up`}
                title="Move up"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="p-1 rounded text-muted hover:text-ink hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="6 15 12 9 18 15" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={`Move ${pinName(p)} down`}
                title="Move down"
                disabled={i === ordered.length - 1}
                onClick={() => move(i, 1)}
                className="p-1 rounded text-muted hover:text-ink hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={`Unpin ${pinName(p)}`}
                title="Unpin"
                onClick={() => unpin.mutate(p.id)}
                className="p-1 rounded text-muted hover:text-red-700 dark:hover:text-red-300 hover:bg-surface-2 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}

/**
 * The bottom of the sidebar: the theme picker and Sign out side by side, with
 * the version badge beneath. Sign out lives here (not the top-right avatar
 * menu) so the two account-wide controls sit together.
 */
function SidebarFooter() {
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();
  return (
    <div className="pt-4 mt-4 border-t border-border px-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <ThemeToggle />
        <button
          type="button"
          onClick={() => { clearAuth(); navigate('/login'); }}
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors"
          title="Sign out of PareCare"
        >
          <SignOutIcon size={13} />
          Sign out
        </button>
      </div>
      <VersionBadge />
    </div>
  );
}

export function Shell() {
  const updateAccount = useAuthStore((s) => s.updateAccount);
  const role = useAuthStore((s) => s.account?.role);
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The whole left nav can be put away on desktop, remembered across visits.
  const [sidebarHidden, setSidebarHidden] = useState(() => localStorage.getItem('sidebar-hidden') === '1');
  const toggleSidebar = () => {
    const next = !sidebarHidden;
    setSidebarHidden(next);
    localStorage.setItem('sidebar-hidden', next ? '1' : '0');
  };

  // The logo returns the viewer to the highest-level dashboard they can reach:
  // the system overview for admins and super admins, otherwise the care home.
  const homeDest = role === 'admin' || role === 'super_admin' ? '/system' : '/app';

  // Detect whether a care profile is open, so the left nav can switch to that
  // profile's sections. The first segment after /app is a profile id only when
  // it is not one of the reserved top-level sections (Directory, Tools/Reports,
  // and the profiles/new route); otherwise the main nav stays put.
  const profileMatch = useMatch('/app/:profileId/*');
  const matchedFirst = profileMatch?.params.profileId;
  const profileId = matchedFirst && !RESERVED_APP_SECTIONS.has(matchedFirst) ? matchedFirst : null;

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
      <SortableNavGroup groupKey="directory" heading="Directory" items={DIRECTORY_NAV} />
      <SortableNavGroup groupKey="tools" heading="Tools" items={TOOLS_NAV} />
      <PinnedProfilesNav pinned={pinned} />
    </>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="relative shrink-0 flex items-center justify-between bg-card border-b border-border px-3 sm:px-4 h-14 z-30">
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
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarHidden ? 'Show navigation' : 'Hide navigation'}
            aria-expanded={!sidebarHidden}
            title={sidebarHidden ? 'Show navigation' : 'Hide navigation'}
            className="hidden lg:inline-flex -ml-1 p-2 rounded-md text-muted hover:text-ink hover:bg-surface-2 transition-colors"
          >
            {/* A panel icon: the left pane filled when the nav is open */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="9" y1="4" x2="9" y2="20" />
              {sidebarHidden ? null : <rect x="4" y="5" width="4" height="14" fill="currentColor" stroke="none" rx="1" />}
            </svg>
          </button>
          <NavLink to={homeDest} aria-label="PareCare home" className="text-lg font-semibold text-primary hover:opacity-80 transition-opacity">
            PareCare
          </NavLink>
        </div>
        <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 w-full max-w-xs px-4 justify-center">
          <ProfileSwitcher activeProfileId={profileId} />
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <TierBadge />
          <Clock />
          <NotificationsBell />
          <AvatarMenu />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar, hideable from the header toggle */}
        {!sidebarHidden ? (
          <nav className="hidden lg:flex w-56 shrink-0 bg-card border-r border-border flex-col py-5 px-4 overflow-y-auto">
            <div className="flex-1 space-y-1">{sidebarNav}</div>
            <SidebarFooter />
          </nav>
        ) : null}

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
              <SidebarFooter />
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
