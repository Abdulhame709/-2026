import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Spin, Typography } from 'antd';
import { useAuth } from './AuthContext';
import { AppLayout } from './layout/AppLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { SessionsPage } from '@/features/sessions/SessionsPage';
import { NewSessionWizardPage } from '@/features/statements/import/NewSessionWizardPage';
import { MatchingWorkspacePage } from '@/features/matching/MatchingWorkspacePage';
import { PartnersPage } from '@/features/partners/PartnersPage';
import { DiscrepanciesPage } from '@/features/discrepancies/DiscrepanciesPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

/** حارس المصادقة: ينتظر جواب من-أنا قبل الحكم — غير المسجل يُحوَّل لشاشة الدخول مع حفظ الوجهة. */
function RequireAuth() {
  const { user, booting } = useAuth();
  const location = useLocation();
  if (booting) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} aria-busy="true">
        <div style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
          <Spin size="large" />
          <Typography.Text type="secondary">جارٍ استعادة الجلسة…</Typography.Text>
        </div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route
            path="/sessions/new"
            element={<NewSessionWizardPage />}
          />
          <Route path="/sessions/:id" element={<MatchingWorkspacePage />} />
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/partners/:id" element={<PartnersPage />} />
          <Route path="/discrepancies" element={<DiscrepanciesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
