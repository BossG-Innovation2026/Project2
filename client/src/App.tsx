import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Spinner } from "./components/ui";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Requests from "./pages/Requests";
import Relief from "./pages/Relief";
import Schedules from "./pages/Schedules";
import Generator from "./pages/Generator";
import Settings from "./pages/Settings";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="calendar" element={<Navigate to="/?tab=calendar" replace />} />
          <Route path="requests" element={<AdminOnly><Requests /></AdminOnly>} />
          <Route path="relief" element={<AdminOnly><Relief /></AdminOnly>} />
          <Route path="schedules" element={<AdminOnly><Schedules /></AdminOnly>} />
          <Route path="generator" element={<AdminOnly><Generator /></AdminOnly>} />
          <Route path="reports" element={<Navigate to="/?tab=reports" replace />} />
          <Route path="file-leave" element={<Navigate to="/?panel=leave" replace />} />
          <Route path="history" element={<Navigate to="/?tab=history" replace />} />
          <Route path="notifications" element={<Navigate to="/?tab=notifications" replace />} />
          <Route path="settings" element={<AdminOnly><Settings /></AdminOnly>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}