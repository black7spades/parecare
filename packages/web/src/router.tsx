import { Navigate, createBrowserRouter } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import { Shell } from './components/layout/Shell';
import { Login } from './pages/auth/Login';
import { Register } from './pages/auth/Register';
import { Dashboard } from './pages/app/Dashboard';
import { NewCareProfile } from './pages/app/NewCareProfile';
import { CareProfilePage } from './pages/app/CareProfilePage';
import { SubscriptionPage } from './pages/account/Subscription';
import { AccountSettings } from './pages/account/Settings';
import { AdminUsers } from './pages/admin/AdminUsers';

function NotFound() {
  return (
    <div className="card text-center py-12 max-w-md mx-auto mt-12">
      <h1 className="text-lg font-semibold text-ink mb-2">Page not found</h1>
      <p className="text-sm text-muted mb-4">That page doesn't exist (or hasn't been built yet).</p>
      <a href="/app" className="text-primary text-sm hover:underline">
        Back to dashboard
      </a>
    </div>
  );
}

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
      { path: 'app/profiles/new', element: <NewCareProfile /> },
      { path: 'app/:profileId/dashboard', element: <CareProfilePage /> },
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
      { path: '*', element: <NotFound /> },
    ],
  },
]);
