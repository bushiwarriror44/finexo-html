import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <section className="why_section layout_padding dashboard_page">
        <div className="container dashboard-shell">
          <p className="dash-muted">Loading your account...</p>
        </div>
      </section>
    );
  }
  if (!user) {
    const next = encodeURIComponent(location.pathname);
    return <Navigate to={`/?auth=login&next=${next}`} replace />;
  }
  return children;
}
