/**
 * Force temp password + must_change_password=1 for first-login reset.
 * Usage: node scripts/force-must-change-password.js <email> <tempPassword>
 */
import bcrypt from 'bcryptjs';
import { getDb } from './db.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
const password = String(process.argv[3] || '');

if (!email || password.length < 8) {
  console.error('Usage: node scripts/force-must-change-password.js <email> <tempPassword>=8chars');
  process.exit(1);
}

const db = getDb();
const user = db.prepare('SELECT id, email, name, role_id, status, must_change_password FROM users WHERE email = ?').get(email);
if (!user) {
  console.error(JSON.stringify({ ok: false, error: 'user_not_found', email }));
  process.exit(2);
}

const hash = bcrypt.hashSync(password, 10);
db.prepare(`
  UPDATE users
  SET password_hash = ?, must_change_password = 1, status = 'active'
  WHERE id = ?
`).run(hash, user.id);

db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

const row = db.prepare(`
  SELECT id, email, name, role_id, status, must_change_password FROM users WHERE id = ?
`).get(user.id);

console.log(JSON.stringify({
  ok: true,
  email: row.email,
  name: row.name,
  role_id: row.role_id,
  status: row.status,
  mustChange: !!row.must_change_password,
  sessionsCleared: true,
}, null, 2));
