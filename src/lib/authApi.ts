export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string | null;
  status: string;
  mustChangePassword: boolean;
  permissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || res.statusText || 'Request failed');
  }
  return data;
}

export async function authMe(): Promise<{ user: AuthUser } | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  return parseJson(res) as Promise<{ user: AuthUser }>;
}

export async function authLogin(email: string, password: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJson(res) as { user: AuthUser };
  return data.user;
}

export async function authLogout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function authChangePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  await parseJson(res);
}

export async function fetchRoles() {
  const res = await fetch('/api/roles', { credentials: 'include' });
  return parseJson(res) as Promise<{ roles: Array<{ id: string; name: string; desc: string; permissions: string[] }> }>;
}

export async function putRoles(roles: Array<{ id: string; name: string; desc: string; permissions: string[] }>) {
  const res = await fetch('/api/roles', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles }),
  });
  return parseJson(res) as Promise<{ roles: Array<{ id: string; name: string; desc: string; permissions: string[] }> }>;
}

export async function fetchUsers() {
  const res = await fetch('/api/users', { credentials: 'include' });
  return parseJson(res) as Promise<{ users: AuthUser[]; roles: Array<{ id: string; name: string; desc: string }> }>;
}

export async function createUserApi(body: {
  email: string;
  name: string;
  password: string;
  roleId: string;
}) {
  const res = await fetch('/api/users', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJson(res) as Promise<{
    user: AuthUser & { emailSent?: boolean; emailError?: string | null };
  }>;
}

export async function patchUserApi(id: string, body: {
  name?: string;
  roleId?: string;
  status?: string;
  password?: string;
}) {
  const res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJson(res) as Promise<{ user: AuthUser }>;
}

/** Map app paths to permission ids */
export function permissionForPath(pathname: string): string | null {
  const map: Array<[string, string]> = [
    ['/settings/users', 'user-management'],
    ['/settings', 'settings'],
    ['/fuel/consumption', 'fuel-consumption'],
    ['/fuel/monitoring', 'fuel-monitoring'],
    ['/fuel', 'fuel-monitoring'],
    ['/reports/documents', 'documents'],
    ['/reports', 'reports'],
    ['/incidents', 'incidents'],
    ['/drivers', 'drivers'],
    ['/tankers', 'tankers'],
    ['/quarry', 'quarry'],
    ['/cement', 'cement'],
    ['/ready-mix', 'ready-mix'],
    ['/safety', 'safety'],
    ['/trips', 'trips'],
    ['/maintenance', 'maintenance'],
    ['/aria', 'aria'],
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
