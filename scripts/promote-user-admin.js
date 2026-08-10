/**
 * Promote an existing user to Admin (keeps password unchanged).
 * Usage: node scripts/promote-user-admin.js <email> [name]
 */
import { getDb } from './db.js';
import { ACCESS_CATALOG, getRolePermissions } from './auth.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
const nameArg = process.argv[3] ? String(process.argv[3]).trim() : null;

if (!email) {
  console.error('Usage: node scripts/promote-user-admin.js <email> [name]');
  process.exit(1);
}

const db = getDb();
const ALL = ACCESS_CATALOG.map(a => a.id);
const now = new Date().toISOString();

db.transaction(() => {
  const admin = db.prepare(`SELECT id FROM roles WHERE id = 'admin'`).get();
  if (!admin) {
    db.prepare(`INSERT INTO roles (id, name, description, created_at) VALUES ('admin', 'Admin', 'Full platform access', ?)`)
      .run(now);
  }
  db.prepare(`DELETE FROM role_permissions WHERE role_id = 'admin'`).run();
  const ins = db.prepare(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('admin', ?)`);
  for (const pid of ALL) ins.run(pid);

  const existing = db.prepare(`SELECT id, role_id FROM users WHERE email = ?`).get(email);
  if (!existing) {
    throw new Error(`User not found: ${email}`);
  }

  db.prepare(`
    UPDATE users
    SET role_id = 'admin', status = 'active', must_change_password = 0,
        name = COALESCE(?, name)
    WHERE email = ?
  `).run(nameArg, email);

  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(existing.id);
})();

const row = db.prepare(`
  SELECT email, name, role_id, status FROM users WHERE email = ?
`).get(email);
const perms = getRolePermissions(row.role_id);
console.log(JSON.stringify({
  ok: true,
  email: row.email,
  name: row.name,
  role_id: row.role_id,
  status: row.status,
  settings: perms.includes('settings'),
  userManagement: perms.includes('user-management'),
  permCount: perms.length,
}, null, 2));
