/**
 * One-shot: set tayoojo@bestpracticesltd.com to Admin with a new bcrypt password.
 * Usage: node scripts/recover-user-password.js <email> <password> [name]
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from './db.js';
import { ACCESS_CATALOG, getRolePermissions } from './auth.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
const password = String(process.argv[3] || '');
const nameArg = process.argv[4] ? String(process.argv[4]).trim() : null;

if (!email || password.length < 12) {
  console.error('Usage: node scripts/recover-user-password.js <email> <password>=12chars [name]');
  process.exit(1);
}

const db = getDb();
const ALL = ACCESS_CATALOG.map(a => a.id);
const now = new Date().toISOString();

db.transaction(() => {
  // Ensure admin role + full permissions
  const admin = db.prepare(`SELECT id FROM roles WHERE id = 'admin'`).get();
  if (!admin) {
    db.prepare(`INSERT INTO roles (id, name, description, created_at) VALUES ('admin', 'Admin', 'Full platform access', ?)`)
      .run(now);
  }
  db.prepare(`DELETE FROM role_permissions WHERE role_id = 'admin'`).run();
  const ins = db.prepare(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('admin', ?)`);
  for (const pid of ALL) ins.run(pid);

  const hash = bcrypt.hashSync(password, 10);
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, role_id = 'admin', status = 'active', must_change_password = 0,
          name = COALESCE(?, name)
      WHERE email = ?
    `).run(hash, nameArg, email);
  } else {
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role_id, status, must_change_password, created_at)
      VALUES (?, ?, ?, ?, 'admin', 'active', 0, ?)
    `).run(
      crypto.randomUUID(),
      email,
      nameArg || email.split('@')[0],
      hash,
      now,
    );
  }

  // Drop this user's sessions so the new password/role takes effect cleanly
  const user = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (user) {
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);
  }
})();

const row = db.prepare(`
  SELECT email, name, role_id, status, must_change_password FROM users WHERE email = ?
`).get(email);
const perms = getRolePermissions(row.role_id);
console.log(JSON.stringify({
  ok: true,
  email: row.email,
  name: row.name,
  role_id: row.role_id,
  status: row.status,
  mustChange: !!row.must_change_password,
  settings: perms.includes('settings'),
  userManagement: perms.includes('user-management'),
  permCount: perms.length,
}, null, 2));
