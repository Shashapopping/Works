import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { permissionForPath } from '../lib/authApi';

const FALLBACK_PATHS = [
  '/', '/fleet', '/drivers', '/incidents', '/safety', '/quarry',
  '/tankers', '/cement', '/ready-mix', '/fuel/monitoring', '/trips',
  '/reports', '/aria', '/settings/general',
];

export default function RequireAuth() {
  const { user, loading, canAccessPath, hasPermission } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--cd-bg)' }}>
        <div style={{ color: 'var(--cd-text-muted)', fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (user.mustChangePassword) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccessPath(location.pathname)) {
    const fallback = FALLBACK_PATHS.find(p => {
      const perm = permissionForPath(p);
      return !perm || hasPermission(perm);
    }) || '/login';
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
}
