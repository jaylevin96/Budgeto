import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/Layout";
import { Login } from "@/pages/Login";
import { ResetPassword } from "@/pages/ResetPassword";
import { MonthEntry } from "@/pages/MonthEntry";
import { YearGrid } from "@/pages/YearGrid";
import { Settings } from "@/pages/Settings";

// Charts (recharts) and the spreadsheet parser (xlsx) are heavy; load them on demand
const Dashboard = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Import = lazy(() => import("@/pages/Import").then((m) => ({ default: m.Import })));
const CardImport = lazy(() => import("@/pages/CardImport").then((m) => ({ default: m.CardImport })));

function FullPageLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-[var(--color-background)]">
      <p className="text-[var(--color-muted-foreground)]">Loading…</p>
    </div>
  );
}

function ProtectedRoute() {
  const { session, loading } = useAuth();
  if (loading) return <FullPageLoading />;
  if (!session) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Suspense fallback={<p className="text-[var(--color-muted-foreground)]">Loading…</p>}>
        <Outlet />
      </Suspense>
    </Layout>
  );
}

function PublicRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const isResetPassword = location.pathname === "/reset-password";

  if (loading) return <FullPageLoading />;

  // Allow /reset-password when session exists (user landed from email link)
  if (session && !isResetPassword) return <Navigate to="/" replace />;

  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/month" element={<MonthEntry />} />
        <Route path="/month/:month" element={<MonthEntry />} />
        <Route path="/year" element={<YearGrid />} />
        <Route path="/year/:year" element={<YearGrid />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/import" element={<Import />} />
        <Route path="/import/card" element={<CardImport />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
