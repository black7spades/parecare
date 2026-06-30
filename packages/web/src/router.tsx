import { Navigate, createBrowserRouter } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import { Shell } from './components/layout/Shell';
import { Login } from './pages/auth/Login';
import { Register } from './pages/auth/Register';
import { Dashboard } from './pages/app/Dashboard';
import { SubscriptionPage } from './pages/account/Subscription';
import { AccountSettings } from './pages/account/Settings';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
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
    ],
  },
]);
