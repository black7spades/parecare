import { NavLink, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';

/** Shared shell for the admin/system tools: Users (admin+) and Settings (super admin). */
export function SystemLayout() {
  const role = useAuthStore((s) => s.account?.role);
  const isSuperAdmin = role === 'super_admin';

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
      isActive ? 'border-primary text-primary font-medium' : 'border-transparent text-muted hover:text-ink'
    }`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">System</h1>
        <p className="text-sm text-muted">Administer accounts and server configuration.</p>
      </div>
      <nav className="flex gap-1 border-b border-border">
        <NavLink to="/system/users" className={tabClass}>
          Users
        </NavLink>
        <NavLink to="/system/journeys" className={tabClass}>
          Care journeys
        </NavLink>
        <NavLink to="/system/chats" className={tabClass}>
          Pare chats
        </NavLink>
        <NavLink to="/system/reports" className={tabClass}>
          Reports
        </NavLink>
        {isSuperAdmin ? (
          <NavLink to="/system/settings" className={tabClass}>
            Settings
          </NavLink>
        ) : null}
      </nav>
      <Outlet />
    </div>
  );
}
