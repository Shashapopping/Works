import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  authChangePassword,
  authLogin,
  authLogout,
  authMe,
  fetchAuthMode,
  permissionForPath,
  type AuthUser,
} from '../lib/authApi';
import { resetApiWarmState, warmHomeApisOnce } from '../lib/apiWarm';
import { clearHomeSnapshot } from '../lib/homeSnapshot';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string, viaTransporterPortal?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  refresh: () => Promise<void>;
  hasPermission: (id: string) => boolean;
  canAccessPath: (pathname: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_USER_CACHE_KEY = 'hbm_auth_user_cache';

function readCachedUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(AUTH_USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: AuthUser | null) {
  try {
    if (user) sessionStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(AUTH_USER_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readCachedUser());
  const [loading, setLoading] = useState(() => !readCachedUser());

  const refresh = async () => {
    const me = await authMe();
    const nextUser = me?.user ?? null;
    setUser(nextUser);
    writeCachedUser(nextUser);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        void fetchAuthMode().catch(() => null);
        const me = await authMe();
        if (!cancelled) {
          const nextUser = me?.user ?? null;
          setUser(nextUser);
          writeCachedUser(nextUser);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          writeCachedUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (user) warmHomeApisOnce();
  }, [user]);

  const login = async (email: string, password: string, viaTransporterPortal?: boolean) => {
    const u = await authLogin(email, password, viaTransporterPortal);
    setUser(u);
    writeCachedUser(u);
  };

  const logout = async () => {
    resetApiWarmState();
    clearHomeSnapshot();
    await authLogout();
    setUser(null);
    writeCachedUser(null);
  };

  const changePassword = async (current: string, next: string) => {
    await authChangePassword(current, next);
    await refresh();
  };

  const hasPermission = (id: string) => !!user?.permissions?.includes(id);

  const canAccessPath = (pathname: string) => {
    if (!user) return false;
    if (pathname.startsWith('/settings/users')) return hasPermission('user-management');
    if (pathname.startsWith('/settings')) return hasPermission('settings');
    const perm = permissionForPath(pathname);
    if (!perm) return true;
    return hasPermission(perm);
  };

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout, changePassword, refresh, hasPermission, canAccessPath,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
