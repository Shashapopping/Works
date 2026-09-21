import { cachedFetchJson, cachePeek, CACHE_TTL } from './apiCache';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string | null;
  status: string;
  mustChangePassword: boolean;
  isOrganisational?: boolean;
  transporters?: string[];
  /** Custom display name for a transporter account — shown as the sidebar title instead of the default client name. */
  fleetName?: string | null;
  permissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SeatInfo {
  used: number;
  limit: number;
  remaining: number;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  limit?: number;
  used?: number;
  upgrade?: boolean;

  constructor(message: string, opts: { status: number; code?: string; limit?: number; used?: number; upgrade?: boolean }) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.limit = opts.limit;
    this.used = opts.used;
    this.upgrade = opts.upgrade;
  }
}

const JWT_STORAGE_KEY = 'bpl_jwt_token';
const SESSION_EXPIRED_EVENT = 'hbm:session-expired';
const LOGOUT_FETCH_TIMEOUT_MS = 1500;

let authMode: 'jwt' | 'session' | null = null;
let sessionExpiredNotified = false;

/** Soft signal that the cookie/JWT session is gone — AuthContext clears local user. */
export function notifySessionExpired() {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;
  setStoredToken(null);
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  } catch {
    /* ignore */
  }
}

export function clearSessionExpiredFlag() {
  sessionExpiredNotified = false;
}

export function onSessionExpired(handler: () => void) {
  const listener = () => handler();
  window.addEventListener(SESSION_EXPIRED_EVENT, listener);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(JWT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(JWT_STORAGE_KEY, token);
    else localStorage.removeItem(JWT_STORAGE_KEY);
  } catch {
    /* private browsing */
  }
}

export function getAuthMode(): 'jwt' | 'session' | null {
  return authMode;
}

export function authFetchInit(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  const token = getStoredToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return { ...init, credentials: 'include', headers };
}

async function parseJson(res: Response, opts?: { treat401AsSessionExpired?: boolean }) {
  const data = await res.json().catch(() => ({})) as {
    error?: string;
    code?: string;
    limit?: number;
    used?: number;
    upgrade?: boolean;
  };
  if (!res.ok) {
    if (res.status === 401 && opts?.treat401AsSessionExpired) {
      notifySessionExpired();
      throw new ApiError('Session expired. Please sign in again.', {
        status: 401,
        code: data.code || 'session_expired',
      });
    }
    throw new ApiError(data.error || res.statusText || 'Request failed', {
      status: res.status,
      code: data.code,
      limit: data.limit,
      used: data.used,
      upgrade: data.upgrade,
    });
  }
  return data;
}

export async function fetchAuthMode(): Promise<'jwt' | 'session'> {
  const res = await fetch('/api/auth/mode');
  const data = await parseJson(res) as { mode: 'jwt' | 'session' };
  authMode = data.mode;
  return data.mode;
}

export async function fetchOAuthProviders(): Promise<{
  google: boolean;
  microsoft: boolean;
  publicUrl: string | null;
}> {
  const res = await fetch('/api/auth/oauth/providers');
  return parseJson(res) as Promise<{ google: boolean; microsoft: boolean; publicUrl: string | null }>;
}

export function startGoogleOAuth() {
  window.location.href = '/api/auth/oauth/google';
}

/** Decode JWT payload (no signature check — display only). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export async function authMe(): Promise<{ user: AuthUser; authMode?: string } | null> {
  const res = await fetch('/api/auth/me', authFetchInit());
  if (res.status === 401) {
    setStoredToken(null);
    notifySessionExpired();
    return null;
  }
  const data = await parseJson(res) as { user: AuthUser; authMode?: 'jwt' | 'session' };
  if (data.authMode) authMode = data.authMode;
  clearSessionExpiredFlag();
  return data;
}

export async function fetchTransporters(): Promise<string[]> {
  const res = await fetch('/api/transporters');
  const data = await parseJson(res) as { transporters: string[] };
  return Array.isArray(data.transporters) ? data.transporters : [];
}

export async function authLogin(
  email: string,
  password: string,
  viaTransporterPortal?: boolean,
): Promise<AuthUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      ...(viaTransporterPortal ? { portal: 'transporter' } : {}),
    }),
  });
  const data = await parseJson(res) as {
    user: AuthUser;
    token?: string;
    authMode?: 'jwt' | 'session';
  };
  if (data.authMode) authMode = data.authMode;
  if (data.token) setStoredToken(data.token);
  else setStoredToken(null);
  clearSessionExpiredFlag();
  return data.user;
}

/** Clear server session — bounded so a busy Node process cannot stall the UI. */
export async function authLogout(): Promise<void> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), LOGOUT_FETCH_TIMEOUT_MS);
  try {
    await fetch('/api/auth/logout', authFetchInit({ method: 'POST', signal: controller.signal }));
  } catch {
    /* timeout / offline — local logout already applied */
  } finally {
    window.clearTimeout(timer);
    setStoredToken(null);
  }
}

export async function authChangePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/auth/change-password', authFetchInit({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  }));
  await parseJson(res);
}

export async function fetchRoles() {
  const res = await fetch('/api/roles', authFetchInit());
  return parseJson(res, { treat401AsSessionExpired: true }) as Promise<{ roles: Array<{ id: string; name: string; desc: string; permissions: string[] }> }>;
}

export async function putRoles(roles: Array<{ id: string; name: string; desc: string; permissions: string[] }>) {
  const res = await fetch('/api/roles', authFetchInit({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles }),
  }));
  return parseJson(res, { treat401AsSessionExpired: true }) as Promise<{ roles: Array<{ id: string; name: string; desc: string; permissions: string[] }> }>;
}

export async function fetchUsers(scope: 'client' | 'all' = 'client') {
  const qs = scope === 'all' ? '?scope=all' : '';
  const res = await fetch(`/api/users${qs}`, authFetchInit());
  return parseJson(res, { treat401AsSessionExpired: true }) as Promise<{
    users: AuthUser[];
    roles: Array<{ id: string; name: string; desc: string }>;
    seats: SeatInfo;
  }>;
}

export async function createUserApi(body: {
  email: string;
  name: string;
  password: string;
  roleId: string;
  isOrganisational?: boolean;
  transporters?: string[];
  fleetName?: string;
}) {
  const res = await fetch('/api/users', authFetchInit({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return parseJson(res, { treat401AsSessionExpired: true }) as Promise<{
    user: AuthUser & { emailSent?: boolean; emailError?: string | null };
    seats?: SeatInfo;
  }>;
}

export async function patchUserApi(id: string, body: {
  name?: string;
  roleId?: string;
  status?: string;
  password?: string;
  isOrganisational?: boolean;
  transporters?: string[];
  fleetName?: string;
}) {
  const res = await fetch(`/api/users/${encodeURIComponent(id)}`, authFetchInit({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return parseJson(res, { treat401AsSessionExpired: true }) as Promise<{ user: AuthUser; seats?: SeatInfo }>;
}

/** Map app paths to permission ids */
export function permissionForPath(pathname: string): string | null {
  const map: Array<[string, string]> = [
    ['/settings/users', 'user-management'],
    ['/consequence-management', 'settings'],
    ['/settings', 'settings'],
    ['/fuel/consumption', 'fuel-consumption'],
    ['/fuel/monitoring', 'fuel-monitoring'],
    ['/fuel', 'fuel-monitoring'],
    ['/reports', 'reports'],
    ['/incidents', 'incidents'],
    ['/trends', 'incidents'],
    ['/drivers', 'drivers'],
    ['/tankers', 'tankers'],
    ['/quarry', 'quarry'],
    ['/cement', 'cement'],
    ['/ready-mix', 'ready-mix'],
    ['/safety', 'safety'],
    ['/trips', 'trips'],
    ['/maintenance', 'maintenance'],
    ['/aria', 'aria'],
    ['/assets', 'assets'],
    ['/operations/utilization', 'utilization'],
    ['/fleet', 'fleet'],
    ['/', 'dashboard'],
  ];
  for (const [prefix, perm] of map) {
    if (prefix === '/') {
      if (pathname === '/') return perm;
      continue;
    }
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return perm;
  }
  return null;
}

export function peekAuthJson<T>(url: string): T | null {
  return cachePeek<T>(url);
}

export async function fetchAuthJsonCached<T>(
  url: string,
  opts?: { force?: boolean },
): Promise<T | null> {
  return cachedFetchJson<T>(
    url,
    CACHE_TTL.admin,
    async () => {
      const res = await fetch(url, authFetchInit());
      if (res.status === 401) {
        notifySessionExpired();
        return null;
      }
      if (!res.ok) return null;
      return parseJson(res) as T;
    },
    opts,
  );
}
