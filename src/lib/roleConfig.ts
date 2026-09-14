/**
 * Role-based access configuration — catalog + types for Settings → Roles.
 * Persistence is server-side (SQLite) via /api/roles.
 */

export const ROLES_CONFIG_KEY = 'bpl_roles_config';
export const ROLES_CONFIG_EVENT = 'bpl-roles-config';

export interface AccessItem {
  id: string;
  label: string;
  group: string;
}

export interface RoleDefinition {
  id: string;
  name: string;
  desc: string;
  permissions: string[];
}

export interface RolesConfig {
  roles: RoleDefinition[];
}

export const ACCESS_CATALOG: AccessItem[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Core' },
  { id: 'fleet', label: 'Fleet', group: 'Core' },
  { id: 'assets', label: 'Assets', group: 'Core' },
  { id: 'drivers', label: 'Driver Management', group: 'Core' },
  { id: 'incidents', label: 'Incident Intelligence', group: 'Core' },
  { id: 'tankers', label: 'Bulk Tankers', group: 'Fleet segments' },
  { id: 'quarry', label: 'Quarry', group: 'Fleet segments' },
  { id: 'cement', label: 'Cement', group: 'Fleet segments' },
  { id: 'ready-mix', label: 'Ready Mix', group: 'Fleet segments' },
  { id: 'safety', label: 'Safety', group: 'Safety' },
  { id: 'fuel-monitoring', label: 'Fuel Monitoring', group: 'Operations' },
  { id: 'fuel-consumption', label: 'Fuel Consumption', group: 'Operations' },
  { id: 'utilization', label: 'Utilization', group: 'Operations' },
  { id: 'trips', label: 'Journey Management', group: 'Operations' },
  { id: 'maintenance', label: 'Maintenance', group: 'Operations' },
  { id: 'reports', label: 'Reports', group: 'Reporting' },
  { id: 'documents', label: 'Documents', group: 'Reporting' },
  { id: 'aria', label: 'AI Insights', group: 'AI Intelligence' },
  { id: 'settings', label: 'Settings', group: 'Administration' },
  { id: 'user-management', label: 'User Management', group: 'Administration' },
  { id: 'reset-data', label: 'Reset Data', group: 'Administration' },
];

const ALL_ACCESS_IDS = ACCESS_CATALOG.map(a => a.id);

export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    id: 'admin',
    name: 'Admin',
    desc: 'Full platform access, user management, and settings',
    permissions: [...ALL_ACCESS_IDS],
  },
  {
    id: 'hse-officer',
    name: 'HSE Officer',
    desc: 'Safety, BPL Analyst Intelligence, Driver Management, Incident Intelligence',
    permissions: ['safety', 'aria', 'drivers', 'incidents', 'reports', 'dashboard'],
  },
  {
    id: 'operations-manager',
    name: 'Operations Manager',
    desc: 'Dashboard, Fleet view, Operations, limited Safety access',
    permissions: ['dashboard', 'fleet', 'assets', 'utilization', 'trips', 'fuel-monitoring', 'fuel-consumption', 'drivers', 'incidents', 'quarry', 'tankers', 'cement', 'ready-mix'],
  },
  {
    id: 'view-only',
    name: 'View Only',
    desc: 'Read-only access to Dashboard and Reports',
    permissions: ['dashboard', 'reports'],
  },
  {
    id: 'transporter',
    name: 'Transporter',
    desc: 'Scoped to one or more transporter organizations — no fleet segment pages',
    permissions: [
      'dashboard', 'fleet', 'assets', 'drivers', 'incidents', 'reports',
      'trips', 'fuel-monitoring', 'fuel-consumption', 'maintenance',
    ],
  },
];

export function accessLabel(id: string): string {
  return ACCESS_CATALOG.find(a => a.id === id)?.label ?? id;
}

function normalizeRole(raw: unknown): RoleDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<RoleDefinition>;
  if (!o.id || !o.name) return null;
  const validIds = new Set(ALL_ACCESS_IDS);
  const permissions = Array.isArray(o.permissions)
    ? o.permissions.filter((p): p is string => typeof p === 'string' && validIds.has(p))
    : [];
  return {
    id: String(o.id),
    name: String(o.name).trim() || 'Untitled role',
    desc: typeof o.desc === 'string' ? o.desc : '',
    permissions,
  };
}

export function normalizeRolesConfig(raw: unknown): RolesConfig {
  if (!raw || typeof raw !== 'object') return { roles: DEFAULT_ROLES.map(r => ({ ...r, permissions: [...r.permissions] })) };
  const o = raw as Partial<RolesConfig>;
  if (!Array.isArray(o.roles) || o.roles.length === 0) {
    return { roles: DEFAULT_ROLES.map(r => ({ ...r, permissions: [...r.permissions] })) };
  }
  const roles = o.roles.map(normalizeRole).filter((r): r is RoleDefinition => r !== null);
  return roles.length > 0
    ? { roles }
    : { roles: DEFAULT_ROLES.map(r => ({ ...r, permissions: [...r.permissions] })) };
}

export function loadRolesConfig(): RolesConfig {
  try {
    const raw = localStorage.getItem(ROLES_CONFIG_KEY);
    if (!raw) return normalizeRolesConfig(null);
    return normalizeRolesConfig(JSON.parse(raw));
  } catch {
    return normalizeRolesConfig(null);
  }
}

export function saveRolesConfig(config: RolesConfig): RolesConfig {
  const next = normalizeRolesConfig(config);
  localStorage.setItem(ROLES_CONFIG_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(ROLES_CONFIG_EVENT, { detail: next }));
  return next;
}

export function createRoleId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'role';
  return `${base}-${Date.now().toString(36)}`;
}
