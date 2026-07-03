import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore, type AccountRole } from '../../stores/auth';
import { useSubscriptionStore } from '../../stores/subscription';
import { UpgradePrompt } from '../UpgradePrompt';
import { ThemeToggle } from '../ThemeToggle';
import { api } from '../../api/client';

function TierBadge() {
  const tier = useSubscriptionStore((s) => s.tier);
  const navigate = useNavigate();
  if (!tier || tier === 'free') return null;

  return (
    <button
      onClick={() => navigate('/account/subscription')}
      className="badge bg-primary-50 text-primary capitalize cursor-pointer hover:bg-primary-100 transition-colors"
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
  const { account, clearAuth, updateAccount } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = account?.role === 'admin' || account?.role === 'super_admin';
  const isSuperAdmin = account?.role === 'super_admin';
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Refresh account info so role/tier changes apply without re-login
  useEffect(() => {
    api
      .get<{ role: AccountRole; subscription_tier: 'free' | 'family' | 'professional'; subscription_status: string | null }>('/auth/me')
      .then((me) => updateAccount({ role: me.role, subscription_tier: me.subscription_tier, subscription_status: me.subscription_status }))
      .catch(() => {
        // 401 already clears auth via the api client
      });
  }, [updateAccount]);

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  const navLinks = (
    <>
      <NavLink to="/app" end className={navLinkClass}>
        Dashboard
      </NavLink>
      <NavLink to="/account/subscription" className={navLinkClass}>
        Subscription
      </NavLink>
      <NavLink to="/account/settings" className={navLinkClass}>
        Settings
      </NavLink>
      {isAdmin ? (
        <NavLink to="/admin" className={navLinkClass}>
          Admin
        </NavLink>
      ) : null}
      {isSuperAdmin ? (
        <NavLink to="/admin/settings" className={navLinkClass}>
          System settings
        </NavLink>
      ) : null}
    </>
  );

  const sidebarFooter = (
    <div className="mt-auto space-y-2">
      <TierBadge />
      <ThemeToggle />
      <div className="text-xs text-muted truncate">{account?.email}</div>
      <button onClick={handleLogout} className="text-xs text-muted hover:text-ink transition-colors">
        Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between bg-card border-b border-border px-4 h-14">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="-ml-1 p-2 rounded-md text-muted hover:text-ink hover:bg-surface-2 transition-colors"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="text-lg font-semibold text-primary">PareCare</span>
        <div className="w-9" aria-hidden />
      </header>

      {/* Desktop sidebar */}
      <nav className="hidden lg:flex w-56 shrink-0 bg-card border-r border-border flex-col py-6 px-4">
        <div className="mb-8">
          <span className="text-lg font-semibold text-primary">PareCare</span>
        </div>
        <div className="flex-1 space-y-1">{navLinks}</div>
        {sidebarFooter}
      </nav>

      {/* Mobile slide-in drawer */}
      {drawerOpen ? (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <nav className="absolute inset-y-0 left-0 w-64 max-w-[80%] bg-card border-r border-border flex flex-col py-6 px-4 shadow-xl">
            <div className="mb-8 flex items-center justify-between">
              <span className="text-lg font-semibold text-primary">PareCare</span>
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
            <div className="flex-1 space-y-1">{navLinks}</div>
            {sidebarFooter}
          </nav>
        </div>
      ) : null}

      <main className="flex-1 min-w-0 overflow-auto bg-surface">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <Outlet />
        </div>
      </main>

      <UpgradePrompt />
    </div>
  );
}
