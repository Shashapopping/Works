/**
 * Custom enterprise auth — users, sessions, roles, RBAC.
 * Opaque session IDs in httpOnly cookies; permissions enforced server-side.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { getDb } from './db.js';

export const SESSION_COOKIE = 'bpl_session';
export const SESSION_DAYS = 7;
const BCRYPT_ROUNDS = 10;

/** Permission catalog — keep in sync with src/lib/roleConfig.ts ACCESS_CATALOG */
export const ACCESS_CATALOG = [
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

const ALL_PERMISSIONS = ACCESS_CATALOG.map(a => a.id);
const VALID_PERMISSIONS = new Set(ALL_PERMISSIONS);

const DEFAULT_ROLES = [
  {
    id: 'admin',
    name: 'Admin',
    description: 'Full platform access, user management, and settings',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    id: 'hse-officer',
    name: 'HSE Officer',
    description: 'Safety, BPL Analyst, Driver Management, Incident Intelligence',
    permissions: ['safety', 'aria', 'drivers', 'incidents', 'reports', 'dashboard'],
  },
  {
    id: 'operations-manager',
    name: 'Operations Manager',
    description: 'Dashboard, Fleet, Operations, limited Safety access',
    permissions: ['dashboard', 'fleet', 'assets', 'utilization', 'trips', 'fuel-monitoring', 'fuel-consumption', 'drivers', 'incidents', 'quarry', 'tankers', 'cement', 'ready-mix'],
  },
  {
    id: 'view-only',
    name: 'View Only',
    description: 'Read-only access to Dashboard and Reports',
    permissions: ['dashboard', 'reports'],
  },
  {
    id: 'transporter',
    name: 'Transporter',
    description: 'Scoped to one or more transporter organizations — no fleet segment pages',
    permissions: [
      'dashboard', 'fleet', 'assets', 'drivers', 'incidents', 'safety', 'reports',
      'trips', 'fuel-monitoring', 'fuel-consumption', 'maintenance', 'utilization',
    ],
  },
];

/** Simple in-memory IP rate limiter for auth routes */
const rateBuckets = new Map();

export function checkRateLimit(ip, { limit = 20, windowMs = 15 * 60 * 1000 } = {}) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true };
}

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

export function publicUser(row, permissions) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roleId: row.role_id,
    roleName: row.role_name || null,
    status: row.status,
    mustChangePassword: !!row.must_change_password,
    isOrganisational: !!row.is_organisational,
    transporters: parseTransporterList(row.transporter),
    fleetName: row.fleet_name ? String(row.fleet_name).trim() || null : null,
    permissions: permissions || [],
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at,
  };
}

export const CLIENT_SEAT_LIMIT = Math.max(
  1,
  parseInt(process.env.CLIENT_SEAT_LIMIT || '3', 10) || 3,
);

export function isOrganisationalUser(userOrRow) {
  if (!userOrRow) return false;
  if (typeof userOrRow.isOrganisational === 'boolean') return userOrRow.isOrganisational;
  return !!userOrRow.is_organisational;
}

export function countClientSeats() {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS c FROM users
    WHERE status = 'active' AND COALESCE(is_organisational, 0) = 0
  `).get();
  return row?.c || 0;
}

export function getSeatInfo() {
  const used = countClientSeats();
  return { used, limit: CLIENT_SEAT_LIMIT, remaining: Math.max(0, CLIENT_SEAT_LIMIT - used) };
}

export function seedRolesIfNeeded() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS c FROM roles').get().c;
  if (count > 0) {
    ensureTransporterRole();
    ensureNewCatalogPermissions();
    return;
  }

  const insertRole = db.prepare(
    'INSERT INTO roles (id, name, description, created_at) VALUES (?, ?, ?, ?)',
  );
  const insertPerm = db.prepare(
    'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
  );
  const tx = db.transaction(() => {
    const ts = nowIso();
    for (const role of DEFAULT_ROLES) {
      insertRole.run(role.id, role.name, role.description, ts);
      for (const pid of role.permissions) {
        if (VALID_PERMISSIONS.has(pid)) insertPerm.run(role.id, pid);
      }
    }
  });
  tx();
  console.log('🔐 Seeded default roles');
}

/**
 * Add transporter role on existing installs if missing.
 * Only seeds default permissions when the role is newly created — never re-grants
 * the full default set on every bootstrap (that was overwriting admin customizations
 * like removing fuel-consumption).
 */
export function ensureTransporterRole() {
  const role = DEFAULT_ROLES.find(r => r.id === 'transporter');
  if (!role) return;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM roles WHERE id = ?').get(role.id);
  if (existing) return;

  const insertPerm = db.prepare(
    'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
  );
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO roles (id, name, description, created_at) VALUES (?, ?, ?, ?)')
      .run(role.id, role.name, role.description, nowIso());
    for (const pid of role.permissions) {
      if (VALID_PERMISSIONS.has(pid)) insertPerm.run(role.id, pid);
    }
  });
  tx();
}

/**
 * One-time backfill for existing installs: the Assets and Utilization sidebar pages
 * used to be reachable by any signed-in user (no permission gated them). Now that they
 * do have permission ids, grant them to the default roles that already implied access
 * so this fix doesn't newly lock anyone out. Additive only (INSERT OR IGNORE) — never
 * touches a role an admin has already customized away from these defaults.
 */
function ensureNewCatalogPermissions() {
  const db = getDb();
  const insertPerm = db.prepare(
    'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
  );
  const grants = {
    'operations-manager': ['assets', 'utilization'],
  };
  for (const [roleId, permissionIds] of Object.entries(grants)) {
    if (!db.prepare('SELECT id FROM roles WHERE id = ?').get(roleId)) continue;
    for (const pid of permissionIds) insertPerm.run(roleId, pid);
  }
}

export function listTransporters() {
  const dataPath = path.join(process.cwd(), 'public', 'data.json');
  try {
    const raw = fs.readFileSync(dataPath, 'utf8');
    const vehicles = JSON.parse(raw);
    if (!Array.isArray(vehicles)) return [];
    const names = new Set();
    for (const v of vehicles) {
      const site = (v.site || '').trim();
      const transporter = (v.transporter || '').trim();
      if (site) names.add(site);
      if (transporter) names.add(transporter);
    }
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function normalizeTransporterName(value) {
  return String(value || '').trim();
}

/** Normalize a list of org names into a deduped, trimmed array (order preserved). */
function normalizeTransporterList(value) {
  const raw = Array.isArray(value) ? value : (value == null ? [] : [value]);
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const name = normalizeTransporterName(v);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Serialize a list of org names for the `transporter` TEXT column. Empty list → null ("HBM — Entire fleet"). */
function serializeTransporterList(list) {
  const names = normalizeTransporterList(list);
  return names.length ? JSON.stringify(names) : null;
}

/**
 * Parse the `transporter` column back into a list. Understands the current JSON-array
 * format as well as the legacy plain-string format (a single org name, pre multi-select).
 */
function parseTransporterList(raw) {
  if (!raw) return [];
  const str = String(raw).trim();
  if (!str) return [];
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return normalizeTransporterList(parsed);
    } catch {
      /* fall through to legacy handling */
    }
  }
  return normalizeTransporterList([str]);
}

export async function bootstrapAdminIfNeeded() {
  seedRolesIfNeeded();
  const db = getDb();
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (users > 0) return;

  const email = (process.env.AUTH_BOOTSTRAP_EMAIL || 'admin@hbm.local').trim().toLowerCase();
  const password = process.env.AUTH_BOOTSTRAP_PASSWORD || 'ChangeMeNow!26';
  const name = process.env.AUTH_BOOTSTRAP_NAME || 'Platform Admin';

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role_id, status, must_change_password, created_at)
    VALUES (?, ?, ?, ?, 'admin', 'active', 1, ?)
  `).run(newId(), email, name, hash, nowIso());

  console.log(`🔐 Bootstrap admin created: ${email} (change password on first login)`);
}

export function getRolePermissions(roleId) {
  const rows = getDb()
    .prepare('SELECT permission_id FROM role_permissions WHERE role_id = ?')
    .all(roleId);
  return rows.map(r => r.permission_id);
}

export function listRoles() {
  const db = getDb();
  const roles = db.prepare('SELECT id, name, description, created_at FROM roles ORDER BY name').all();
  return roles.map(r => ({
    id: r.id,
    name: r.name,
    desc: r.description,
    permissions: getRolePermissions(r.id),
    createdAt: r.created_at,
  }));
}

export function saveRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw Object.assign(new Error('At least one role is required'), { status: 400 });
  }

  const db = getDb();
  const usedByUsers = new Set(
    db.prepare('SELECT DISTINCT role_id FROM users').all().map(r => r.role_id),
  );

  const normalized = roles.map((r, i) => {
    const id = String(r.id || '').trim() || `role-${i}-${Date.now().toString(36)}`;
    const name = String(r.name || '').trim();
    if (!name) throw Object.assign(new Error('Role name is required'), { status: 400 });
    let permissions = Array.isArray(r.permissions)
      ? [...new Set(r.permissions.filter(p => VALID_PERMISSIONS.has(p)))]
      : [];
    // Hard floor: Admin role always keeps Settings + User Management (prevents sole-admin lockout)
    if (id === 'admin') {
      const required = ['settings', 'user-management'];
      for (const pid of required) {
        if (!permissions.includes(pid)) permissions = [...permissions, pid];
      }
    }
    return {
      id,
      name,
      description: typeof r.desc === 'string' ? r.desc : (r.description || ''),
      permissions,
    };
  });

  const adminCapable = normalized.some(r =>
    r.permissions.includes('user-management') && r.permissions.includes('settings'),
  );
  if (!adminCapable) {
    throw Object.assign(
      new Error('At least one role must keep Settings and User Management'),
      { status: 400 },
    );
  }

  const nextIds = new Set(normalized.map(r => r.id));
  for (const roleId of usedByUsers) {
    if (!nextIds.has(roleId)) {
      throw Object.assign(
        new Error(`Cannot remove role "${roleId}" — users are still assigned to it`),
        { status: 400 },
      );
    }
  }

  // Upsert roles — never DELETE roles that users still reference (FK on users.role_id).
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM role_permissions').run();

    const existingIds = new Set(
      db.prepare('SELECT id FROM roles').all().map(r => r.id),
    );
    const updateRole = db.prepare(
      'UPDATE roles SET name = ?, description = ? WHERE id = ?',
    );
    const insertRole = db.prepare(
      'INSERT INTO roles (id, name, description, created_at) VALUES (?, ?, ?, ?)',
    );
    const insertPerm = db.prepare(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
    );
    const deleteRole = db.prepare('DELETE FROM roles WHERE id = ?');
    const ts = nowIso();

    for (const role of normalized) {
      if (existingIds.has(role.id)) {
        updateRole.run(role.name, role.description, role.id);
      } else {
        insertRole.run(role.id, role.name, role.description, ts);
      }
      for (const pid of role.permissions) insertPerm.run(role.id, pid);
    }

    for (const id of existingIds) {
      if (!nextIds.has(id)) deleteRole.run(id);
    }
  });
  tx();
  return listRoles();
}

export function listUsers({ scope = 'client' } = {}) {
  const rows = getDb().prepare(`
    SELECT u.*, r.name AS role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    ORDER BY u.created_at DESC
  `).all();
  const mapped = rows.map(r => publicUser(r, getRolePermissions(r.role_id)));
  if (scope === 'all') return mapped;
  return mapped.filter(u => !u.isOrganisational);
}

export async function createUser({
  email,
  name,
  password,
  roleId,
  actorId,
  isOrganisational = false,
  sendInviteEmail = true,
  transporters = [],
  fleetName = null,
}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const displayName = String(name || '').trim();
  const role = String(roleId || '').trim();
  const pwd = String(password || '');
  const orgFlag = !!isOrganisational;
  const transporterList = normalizeTransporterList(transporters);
  const transporterColumn = serializeTransporterList(transporterList);
  const fleetDisplayName = role === 'transporter' ? (String(fleetName || '').trim() || null) : null;

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw Object.assign(new Error('Valid email is required'), { status: 400 });
  }
  if (!displayName) throw Object.assign(new Error('Name is required'), { status: 400 });
  if (pwd.length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  // transporterName may be null for a transporter-role account — that signifies the
  // "HBM — Entire fleet" option (full-fleet HBM staff), not a scoping gap.

  const db = getDb();
  const roleExists = db.prepare('SELECT id FROM roles WHERE id = ?').get(role);
  if (!roleExists) throw Object.assign(new Error('Invalid role'), { status: 400 });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) throw Object.assign(new Error('A user with that email already exists'), { status: 409 });

  if (!orgFlag) {
    const seats = getSeatInfo();
    if (seats.used >= seats.limit) {
      throw Object.assign(
        new Error(`License limit reached — this package includes ${seats.limit} user seats`),
        { status: 402, code: 'seat_limit', limit: seats.limit, used: seats.used, upgrade: true },
      );
    }
  }

  const id = newId();
  const hash = await bcrypt.hash(pwd, BCRYPT_ROUNDS);
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role_id, status, must_change_password, is_organisational, transporter, fleet_name, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)
  `).run(id, normalizedEmail, displayName, hash, role, orgFlag ? 1 : 0, transporterColumn, fleetDisplayName, nowIso());

  writeAudit(actorId, 'user.create', id, { email: normalizedEmail, roleId: role, isOrganisational: orgFlag, transporters: transporterList, fleetName: fleetDisplayName });
  const row = db.prepare(`
    SELECT u.*, r.name AS role_name FROM users u
    LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?
  `).get(id);
  const created = publicUser(row, getRolePermissions(role));

  let emailResult = { sent: false };
  if (sendInviteEmail) {
    try {
      const { sendAccountInviteEmail } = await import('./email.js');
      emailResult = await sendAccountInviteEmail({
        to: normalizedEmail,
        name: displayName,
        password: pwd,
        roleName: created.roleName,
      });
      if (emailResult.sent) {
        writeAudit(actorId, 'user.invite_email', id, { email: normalizedEmail, resendId: emailResult.id });
      }
    } catch (e) {
      emailResult = { sent: false, error: e?.message || 'Email send failed' };
    }
  }

  return { ...created, emailSent: !!emailResult.sent, emailError: emailResult.error || null };
}

export async function updateUser(userId, { name, roleId, status, password, isOrganisational, transporters, fleetName }, actorId) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  const nextName = name !== undefined ? String(name).trim() : user.name;
  const nextRole = roleId !== undefined ? String(roleId).trim() : user.role_id;
  const nextStatus = status !== undefined ? String(status).trim() : user.status;
  const nextOrg = isOrganisational !== undefined ? (!!isOrganisational ? 1 : 0) : (user.is_organisational || 0);
  let nextTransporterList = transporters !== undefined
    ? normalizeTransporterList(transporters)
    : parseTransporterList(user.transporter);
  let nextFleetName = fleetName !== undefined
    ? (String(fleetName || '').trim() || null)
    : (user.fleet_name ? String(user.fleet_name).trim() || null : null);

  if (!nextName) throw Object.assign(new Error('Name is required'), { status: 400 });
  if (!['active', 'disabled'].includes(nextStatus)) {
    throw Object.assign(new Error('Status must be active or disabled'), { status: 400 });
  }
  if (!db.prepare('SELECT id FROM roles WHERE id = ?').get(nextRole)) {
    throw Object.assign(new Error('Invalid role'), { status: 400 });
  }
  if (nextRole !== 'transporter') {
    nextTransporterList = [];
    nextFleetName = null;
  }

  // Don't allow disabling or demoting the last active admin with user-management
  if (user.status === 'active') {
    const losingAdmin =
      (nextStatus === 'disabled' && user.status === 'active')
      || (nextRole !== user.role_id && roleHasUserManagement(user.role_id) && !roleHasUserManagement(nextRole));
    if (losingAdmin) assertNotLastAdmin(userId);
  }

  // Becoming a client seat (org → non-org, or enabling a non-org user) must respect seat limit
  const wasClientSeat = user.status === 'active' && !user.is_organisational;
  const willBeClientSeat = nextStatus === 'active' && !nextOrg;
  if (willBeClientSeat && !wasClientSeat) {
    const seats = getSeatInfo();
    if (seats.used >= seats.limit) {
      throw Object.assign(
        new Error(`License limit reached — this package includes ${seats.limit} user seats`),
        { status: 402, code: 'seat_limit', limit: seats.limit, used: seats.used, upgrade: true },
      );
    }
  }

  let hash = user.password_hash;
  let mustChange = user.must_change_password;
  if (password !== undefined && password !== null && String(password).length > 0) {
    if (String(password).length < 8) {
      throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
    }
    hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    mustChange = 1;
  }

  db.prepare(`
    UPDATE users SET name = ?, role_id = ?, status = ?, password_hash = ?, must_change_password = ?, is_organisational = ?, transporter = ?, fleet_name = ?
    WHERE id = ?
  `).run(nextName, nextRole, nextStatus, hash, mustChange, nextOrg, serializeTransporterList(nextTransporterList), nextFleetName, userId);

  writeAudit(actorId, 'user.update', userId, { roleId: nextRole, status: nextStatus, isOrganisational: !!nextOrg, transporters: nextTransporterList, fleetName: nextFleetName });
  const row = db.prepare(`
    SELECT u.*, r.name AS role_name FROM users u
    LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?
  `).get(userId);
  return publicUser(row, getRolePermissions(nextRole));
}

function roleHasUserManagement(roleId) {
  return getRolePermissions(roleId).includes('user-management');
}

function assertNotLastAdmin(userId) {
  const admins = getDb().prepare(`
    SELECT u.id FROM users u
    JOIN role_permissions rp ON rp.role_id = u.role_id
    WHERE rp.permission_id = 'user-management' AND u.status = 'active'
  `).all();
  if (admins.length <= 1 && admins.some(a => a.id === userId)) {
    throw Object.assign(new Error('Cannot remove the last admin (disable or change role)'), { status: 400 });
  }
}

export async function changePassword(userId, currentPassword, newPassword) {
  if (String(newPassword || '').length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  const ok = await bcrypt.compare(String(currentPassword || ''), user.password_hash);
  if (!ok) throw Object.assign(new Error('Current password is incorrect'), { status: 401 });

  const wasForcedChange = !!user.must_change_password;
  const hash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hash, userId);
  writeAudit(userId, 'user.password_change', userId, null);

  // First sign-in flow: temp password → change while signed in → confirm by email once.
  if (wasForcedChange) {
    try {
      const { sendPasswordChangedConfirmationEmail } = await import('./email.js');
      const emailResult = await sendPasswordChangedConfirmationEmail({
        to: user.email,
        name: user.name,
      });
      if (emailResult.sent) {
        writeAudit(userId, 'user.password_change_confirm_email', userId, {
          email: user.email,
          resendId: emailResult.id,
        });
      } else if (emailResult.error) {
        writeAudit(userId, 'user.password_change_confirm_email_failed', userId, {
          email: user.email,
          error: emailResult.error,
        });
      }
    } catch (e) {
      writeAudit(userId, 'user.password_change_confirm_email_failed', userId, {
        email: user.email,
        error: e?.message || 'Email send failed',
      });
    }
  }

  return { ok: true };
}

export async function login(email, password, { createSession = true, viaTransporterPortal = false } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const db = getDb();
  const user = db.prepare(`
    SELECT u.*, r.name AS role_name FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.email = ?
  `).get(normalizedEmail);

  // Constant-ish fail path
  if (!user || user.status !== 'active') {
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  }

  // Each transporter account's fleet scope is fixed by its stored `transporter` value
  // (or full-fleet HBM access when that value is null) — the portal only gates which
  // login form the account uses, not a site selection.
  const isTransporterAccount = user.role_id === 'transporter';

  if (viaTransporterPortal && !isTransporterAccount) {
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  }
  if (!viaTransporterPortal && isTransporterAccount) {
    throw Object.assign(
      new Error('Use the Transporter login for this account'),
      { status: 403, code: 'transporter_portal_required' },
    );
  }

  const ok = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) throw Object.assign(new Error('Invalid email or password'), { status: 401 });

  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
  writeAudit(user.id, 'auth.login', user.id, null);

  const permissions = getRolePermissions(user.role_id);
  const publicUserRow = publicUser({ ...user, last_login_at: nowIso() }, permissions);

  if (!createSession) {
    return { user: publicUserRow };
  }

  const sessionId = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, user.id, expires, nowIso());

  return {
    sessionId,
    expiresAt: expires,
    user: publicUserRow,
  };
}

/** OAuth sign-in — user must already exist in SQLite (admin-provisioned). */
export async function loginWithEmail(email, { displayName = null, provider = 'oauth' } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const db = getDb();
  const user = db.prepare(`
    SELECT u.*, r.name AS role_name FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.email = ?
  `).get(normalizedEmail);

  if (!user || user.status !== 'active') {
    throw Object.assign(new Error('No active account for this email'), { status: 403 });
  }

  if (user.role_id === 'transporter') {
    throw Object.assign(
      new Error('Use the Transporter login for this account'),
      { status: 403, code: 'transporter_portal_required' },
    );
  }

  if (displayName && displayName !== user.name) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(displayName, user.id);
    user.name = displayName;
  }

  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
  writeAudit(user.id, 'auth.oauth_login', user.id, JSON.stringify({ provider }));

  const permissions = getRolePermissions(user.role_id);
  const publicUserRow = publicUser({ ...user, last_login_at: nowIso() }, permissions);

  const sessionId = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, user.id, expires, nowIso());

  return {
    sessionId,
    expiresAt: expires,
    user: publicUserRow,
  };
}

export function logout(sessionId) {
  if (!sessionId) return;
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function getSessionUser(sessionId) {
  if (!sessionId) return null;
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  const user = db.prepare(`
    SELECT u.*, r.name AS role_name FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(session.user_id);
  if (!user || user.status !== 'active') return null;
  return publicUser(user, getRolePermissions(user.role_id));
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

/** Prefer Secure cookies on HTTPS (nginx TLS) so browsers keep the session. */
export function shouldUseSecureCookie(req) {
  if (process.env.AUTH_COOKIE_SECURE === '1') return true;
  if (process.env.AUTH_COOKIE_SECURE === '0') return false;
  if (process.env.NODE_ENV === 'production') return true;
  const proto = req?.headers?.['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') return true;
  return false;
}

export function sessionCookieHeader(sessionId, { clear = false, req = null } = {}) {
  const secure = shouldUseSecureCookie(req);
  if (clear) {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
  }
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function writeAudit(actorId, action, targetId, meta) {
  try {
    getDb().prepare(`
      INSERT INTO auth_audit (id, actor_id, action, target_id, meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      newId(),
      actorId || null,
      action,
      targetId || null,
      meta ? JSON.stringify(meta) : null,
      nowIso(),
    );
  } catch (e) {
    console.warn('auth audit write failed:', e?.message || e);
  }
}

export function userHasPermission(user, permissionId) {
  return !!user?.permissions?.includes(permissionId);
}

/** Route path → required permission (first match wins for nested) */
export const ROUTE_PERMISSIONS = {
  '/': 'dashboard',
  '/fleet': 'fleet',
  '/drivers': 'drivers',
  '/incidents': 'incidents',
  '/tankers': 'tankers',
  '/quarry': 'quarry',
  '/cement': 'cement',
  '/ready-mix': 'ready-mix',
  '/safety': 'safety',
  '/fuel/monitoring': 'fuel-monitoring',
  '/fuel/consumption': 'fuel-consumption',
  '/trips': 'trips',
  '/reports': 'reports',
  '/maintenance': 'maintenance',
  '/aria': 'aria',
  '/settings': 'settings',
  '/settings/general': 'settings',
  '/settings/thresholds': 'settings',
  '/settings/roles': 'settings',
  '/settings/users': 'user-management',
  '/settings/dev': 'settings',
};
