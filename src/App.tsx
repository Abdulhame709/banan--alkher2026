import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Emblem } from './components/Logo';
import { Button, EmptyState } from './components/ui';
import { LoginPage } from './pages/Login';
import { DiagnosticsPage } from './pages/Diagnostics';
import { DashboardPage } from './pages/Dashboard';
import { MembersPage } from './pages/Members';
import { SubscriptionsPage } from './pages/Subscriptions';
import { ReceiptsPage } from './pages/Receipts';
import { ExpensesPage } from './pages/Expenses';
import { ReportsPage } from './pages/Reports';
import { UsersPage } from './pages/Users';
import { SettingsPage } from './pages/Settings';
import { AuditPage } from './pages/Audit';
import { VerifyPage } from './pages/Verify';
import type { Capabilities } from './types';

function Splash() {
  return (
    <div className="splash-screen">
      <Emblem size={72} />
      <strong>صندوق بنان الخير للبنيان</strong>
      <span>الغدير – مقبنة – تعز</span>
      <div className="splash-loader" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function GoHomeButton() {
  const navigate = useNavigate();
  return <Button onClick={() => navigate('/')}>العودة للوحة التحكم</Button>;
}

function HomeRoute() {
  const { user, capabilities } = useAuth();
  if (!user || !capabilities) return null;
  if (user.role === 'member' || capabilities.viewDashboard) return <DashboardPage />;
  const firstAllowed = [
    capabilities.viewMembers && '/members',
    capabilities.viewSubscriptions && '/subscriptions',
    capabilities.viewReceipts && '/receipts',
    capabilities.viewExpenses && '/expenses',
    capabilities.viewReports && '/reports',
    capabilities.manageUsers && '/users',
    capabilities.manageSettings && '/settings',
    capabilities.viewAudit && '/audit',
  ].find(Boolean);
  if (firstAllowed) return <Navigate to={firstAllowed} replace />;
  return (
    <div className="page-stack">
      <div className="card card-pad">
        <EmptyState
          title="لا توجد صلاحيات مفعّلة"
          description="حسابك نشط لكن لم تُمنح أي صلاحية بعد. راجع مدير النظام لتحديد الصلاحيات المناسبة."
          icon={<ShieldAlert size={30} />}
        />
      </div>
    </div>
  );
}

function Guard({
  children,
  allow,
}: {
  children: ReactNode;
  allow: (capabilities: Capabilities, role: string) => boolean;
}) {
  const { capabilities, user } = useAuth();
  if (!capabilities || !user) return null;
  if (!allow(capabilities, user.role)) {
    return (
      <div className="page-stack">
        <div className="card card-pad">
          <EmptyState
            title="لا تملك صلاحية الوصول"
            description="هذه الصفحة متاحة لأدوار محددة فقط. يمكنك العودة إلى لوحة التحكم أو التواصل مع مدير النظام."
            icon={<ShieldAlert size={30} />}
            action={<GoHomeButton />}
          />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return <Splash />;

  return (
    <Routes>
      <Route path="/verify/:type/:token" element={<VerifyPage />} />
      <Route path="/diagnostics" element={<DiagnosticsPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route
          path="members"
          element={
            <Guard allow={(capabilities) => capabilities.viewMembers}>
              <MembersPage />
            </Guard>
          }
        />
        <Route
          path="subscriptions"
          element={
            <Guard allow={(capabilities) => capabilities.viewSubscriptions}>
              <SubscriptionsPage />
            </Guard>
          }
        />
        <Route
          path="receipts"
          element={
            <Guard allow={(capabilities) => capabilities.viewReceipts}>
              <ReceiptsPage />
            </Guard>
          }
        />
        <Route
          path="expenses"
          element={
            <Guard allow={(capabilities) => capabilities.viewExpenses}>
              <ExpensesPage />
            </Guard>
          }
        />
        <Route
          path="reports"
          element={
            <Guard allow={(capabilities) => capabilities.viewReports}>
              <ReportsPage />
            </Guard>
          }
        />
        <Route
          path="users"
          element={
            <Guard allow={(capabilities) => capabilities.manageUsers}>
              <UsersPage />
            </Guard>
          }
        />
        <Route
          path="settings"
          element={
            <Guard allow={(capabilities) => capabilities.manageSettings}>
              <SettingsPage />
            </Guard>
          }
        />
        <Route
          path="audit"
          element={
            <Guard allow={(capabilities) => capabilities.viewAudit}>
              <AuditPage />
            </Guard>
          }
        />
        <Route
          path="*"
          element={
            <div className="card card-pad">
              <EmptyState
                title="الصفحة غير موجودة"
                description="الرابط المطلوب غير متوفر في النظام."
                action={<GoHomeButton />}
              />
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
