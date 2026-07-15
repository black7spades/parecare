import { Navigate, createBrowserRouter } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import { Shell } from './components/layout/Shell';
import { Login } from './pages/auth/Login';
import { Register } from './pages/auth/Register';
import { OAuthCallback } from './pages/auth/OAuthCallback';
import { Dashboard } from './pages/app/Dashboard';
import { NewCareProfile } from './pages/app/NewCareProfile';
import { ProfileLayout } from './pages/app/profile/ProfileLayout';
import { OverviewPage } from './pages/app/profile/OverviewPage';
import { JourneyPage } from './pages/app/profile/JourneyPage';
import { CirclePage } from './pages/app/profile/CirclePage';
import { PlanPage } from './pages/app/profile/PlanPage';
import { MedicationsPage } from './pages/app/profile/MedicationsPage';
import { TasksPage } from './pages/app/profile/TasksPage';
import { CalendarPage } from './pages/app/profile/CalendarPage';
import { MessagesPage } from './pages/app/profile/MessagesPage';
import { AchievementsPage, MemoryBookPage } from './pages/app/profile/MemoryBookPage';
import { ConditionsPage } from './pages/app/profile/ConditionsPage';
import { AppointmentsPage } from './pages/app/profile/AppointmentsPage';
import { MarPage } from './pages/app/profile/MarPage';
import { EmergencySheetPage } from './pages/app/profile/EmergencySheetPage';
import { DocumentsPage } from './pages/app/profile/DocumentsPage';
import { QuestionsPage } from './pages/app/profile/QuestionsPage';
import { ProvidersPage } from './pages/app/profile/ProvidersPage';
import { ActivityPage } from './pages/app/profile/ActivityPage';
import { AiPage } from './pages/app/profile/AiPage';
import { HealthStatusPage } from './pages/app/profile/HealthStatusPage';
import { DirectoryProvidersPage } from './pages/app/DirectoryProvidersPage';
import { DirectoryPeoplePage, DirectoryPetsPage } from './pages/app/DirectoryProfilesPage';
import { InvitePage } from './pages/InvitePage';
import { SubscriptionPage } from './pages/account/Subscription';
import { AccountSettings } from './pages/account/Settings';
import { NotificationSettings } from './pages/account/NotificationSettings';
import { Profile } from './pages/account/Profile';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminJourneys } from './pages/admin/AdminJourneys';
import { AdminChats } from './pages/admin/AdminChats';
import { AdminSettings } from './pages/admin/AdminSettings';
import { ReportsPage } from './pages/admin/ReportsPage';
import { ReportGeneratorPage } from './pages/app/ReportGeneratorPage';
import { SystemLayout } from './pages/admin/SystemLayout';

function NotFound() {
  return (
    <div className="card text-center py-12 max-w-md mx-auto mt-12">
      <h1 className="text-lg font-semibold text-ink mb-2">Page not found</h1>
      <p className="text-sm text-muted mb-4">That page doesn't exist (or hasn't been built yet).</p>
      <a href="/app" className="text-primary text-sm hover:underline">
        Back to homeboard
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

function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.account?.role);
  if (role !== 'super_admin') return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/auth/callback', element: <OAuthCallback /> },
  { path: '/invite/:token', element: <InvitePage /> },
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
      { path: 'app/directory/people', element: <DirectoryPeoplePage /> },
      { path: 'app/directory/pets', element: <DirectoryPetsPage /> },
      { path: 'app/directory/providers', element: <DirectoryProvidersPage /> },
      { path: 'app/reports', element: <ReportGeneratorPage /> },
      {
        path: 'app/:profileId',
        element: <ProfileLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          // Legacy path from before the tabbed layout
          { path: 'dashboard', element: <OverviewPage /> },
          { path: 'journey', element: <JourneyPage /> },
          { path: 'achievements', element: <AchievementsPage /> },
          { path: 'circle', element: <CirclePage /> },
          { path: 'plan', element: <PlanPage /> },
          { path: 'conditions', element: <ConditionsPage /> },
          { path: 'medications', element: <MedicationsPage /> },
          // The section is named Treatments; both paths land on the same page
          { path: 'treatments', element: <MedicationsPage /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'health-status', element: <HealthStatusPage /> },
          { path: 'appointments', element: <AppointmentsPage /> },
          { path: 'calendar', element: <CalendarPage /> },
          { path: 'mar', element: <MarPage /> },
          { path: 'messages', element: <MessagesPage /> },
          { path: 'memory-book', element: <MemoryBookPage /> },
          { path: 'emergency', element: <EmergencySheetPage /> },
          { path: 'documents', element: <DocumentsPage /> },
          { path: 'questions', element: <QuestionsPage /> },
          { path: 'providers', element: <ProvidersPage /> },
          { path: 'logs', element: <ActivityPage /> },
          // Legacy path from before Logs replaced Activity in the nav
          { path: 'activity', element: <ActivityPage /> },
          { path: 'ai', element: <AiPage /> },
        ],
      },
      { path: 'account/subscription', element: <SubscriptionPage /> },
      { path: 'account/settings', element: <AccountSettings /> },
      { path: 'account/notifications', element: <NotificationSettings /> },
      { path: 'account/profile', element: <Profile /> },
      {
        path: 'system',
        element: (
          <AdminGuard>
            <SystemLayout />
          </AdminGuard>
        ),
        children: [
          { index: true, element: <Navigate to="/system/users" replace /> },
          { path: 'users', element: <AdminUsers /> },
          { path: 'journeys', element: <AdminJourneys /> },
          { path: 'chats', element: <AdminChats /> },
          { path: 'reports', element: <ReportsPage /> },
          {
            path: 'settings',
            element: (
              <SuperAdminGuard>
                <AdminSettings />
              </SuperAdminGuard>
            ),
          },
        ],
      },
      // Legacy redirects from the old separate admin routes
      { path: 'admin', element: <Navigate to="/system/users" replace /> },
      { path: 'admin/settings', element: <Navigate to="/system/settings" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
