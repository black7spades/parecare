import { Navigate, createBrowserRouter } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import { Shell } from './components/layout/Shell';
import { Login } from './pages/auth/Login';
import { Register } from './pages/auth/Register';
import { Dashboard } from './pages/app/Dashboard';
import { SubscriptionPage } from './pages/account/Subscription';
import { AccountSettings } from './pages/account/Settings';
import { AdminUsers } from './pages/admin/AdminUsers';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.account?.role);
  if (role !== 'admin' && role !== 'super_admin') return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    path: '/',
    element: (
      <AuthGuard>
        <Shell />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Navigate to="/app" replace /> },
      { path: 'app', element: <Dashboard /> },
      { path: 'account/subscription', element: <SubscriptionPage /> },
      { path: 'account/settings', element: <AccountSettings /> },
      {
        path: 'admin',
        element: (
          <AdminGuard>
            <AdminUsers />
          </AdminGuard>
        ),
      },
    ],
  },
]);
