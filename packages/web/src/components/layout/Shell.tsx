import { useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore, type AccountRole } from '../../stores/auth';
import { useSubscriptionStore } from '../../stores/subscription';
import { UpgradePrompt } from '../UpgradePrompt';
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

export function Shell() {
  const { account, clearAuth, updateAccount } = useAuthStore();
  const navigate = useNavigate();
  const isAdmin = account?.role === 'admin' || account?.role === 'super_admin';

  // Refresh account info so role/tier changes apply without re-login
  useEffect(() => {
    api
      .get<{ role: AccountRole; subscription_tier: 'free' | 'family' | 'professional'; subscription_status: string | null }>('/auth/me')
      .then((me) => updateAccount({ role: me.role, subscription_tier: me.subscription_tier, subscription_status: me.subscription_status }))
      .catch(() => {
        // 401 already clears auth via the api client
      });
  }, [updateAccount]);

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex">
      <nav className="w-56 shrink-0 bg-white border-r border-border flex flex-col py-6 px-4">
        <div className="mb-8">
          <span className="text-lg font-semibold text-primary">PareCare</span>
        </div>

        <div className="flex-1 space-y-1">
          <NavLink to="/app" end className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? 'bg-primary-50 text-primary font-medium' : 'text-muted hover:text-ink hover:bg-surface-2'}`}>
            Dashboard
          </NavLink>
          <NavLink to="/account/subscription" className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? 'bg-primary-50 text-primary font-medium' : 'text-muted hover:text-ink hover:bg-surface-2'}`}>
            Subscription
          </NavLink>
          <NavLink to="/account/settings" className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? 'bg-primary-50 text-primary font-medium' : 'text-muted hover:text-ink hover:bg-surface-2'}`}>
            Settings
          </NavLink>
          {isAdmin ? (
            <NavLink to="/admin" className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? 'bg-primary-50 text-primary font-medium' : 'text-muted hover:text-ink hover:bg-surface-2'}`}>
              Admin
            </NavLink>
          ) : null}
        </div>

        <div className="mt-auto space-y-2">
          <TierBadge />
          <div className="text-xs text-muted truncate">{account?.email}</div>
          <button onClick={handleLogout} className="text-xs text-muted hover:text-ink transition-colors">
            Sign out
          </button>
        </div>
      </nav>

      <main className="flex-1 overflow-auto bg-surface">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>

      <UpgradePrompt />
    </div>
  );
}
