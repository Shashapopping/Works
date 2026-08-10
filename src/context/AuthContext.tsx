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

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  refresh: () => Promise<void>;
  hasPermission: (id: string) => boolean;
  canAccessPath: (pathname: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const me = await authMe();
    setUser(me?.user ?? null);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetchAuthMode();
        const me = await authMe();
        if (!cancelled) setUser(me?.user ?? null);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = async (email: string, password: string) => {
    const u = await authLogin(email, password);
    setUser(u);
  };

  const logout = async () => {
    await authLogout();
    setUser(null);
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
