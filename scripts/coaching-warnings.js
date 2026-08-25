/**
 * Written warnings — server-side record, user notifications, Resend email.
 */
import { getDb } from './db.js';
import { sendDriverWarningEmail } from './email.js';

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function listActiveUsersForTagging() {
  const rows = getDb().prepare(`
    SELECT id, email, name, role_id
    FROM users
    WHERE status = 'active'
      AND COALESCE(is_organisational, 0) = 0
    ORDER BY name COLLATE NOCASE ASC
  `).all();
  return rows.map(r => ({ id: r.id, email: r.email, name: r.name }));
}

export function listNotificationsForUser(userId, { limit = 50 } = {}) {
  return getDb().prepare(`
    SELECT id, type, title, body, link, warning_id AS warningId, read_at AS readAt, created_at AS createdAt
    FROM user_notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

export function listDriverWarnings({ driverKeys = [] } = {}) {
  const db = getDb();
  const keys = [...new Set((driverKeys || []).map(k => String(k || '').trim()).filter(Boolean))];
  const where = keys.length
    ? `WHERE driver_key IN (${keys.map(() => '?').join(',')})`
    : '';
  return db.prepare(`
    SELECT
      id,
      driver_key AS driverKey,
      driver_name AS driverName,
      comment,
      discipline_band AS disciplineBand,
      issued_by_user_id AS issuedByUserId,
      issued_by_name AS issuedByName,
      created_at AS createdAt
    FROM driver_warnings
    ${where}
    ORDER BY created_at DESC
  `).all(...keys);
}

export function markNotificationRead(userId, notificationId) {
  const row = getDb().prepare(`
    SELECT id FROM user_notifications WHERE id = ? AND user_id = ?
  `).get(notificationId, userId);
  if (!row) return null;
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE user_notifications SET read_at = ? WHERE id = ? AND user_id = ?
  `).run(now, notificationId, userId);
  return { id: notificationId, readAt: now };
}

export function markAllNotificationsRead(userId) {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE user_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL
  `).run(now, userId);
  return now;
}

export async function issueDriverWarning({
  driverKey,
  driverName,
  comment,
  disciplineBand,
  issuedBy,
  taggedUserIds = [],
}) {
  const db = getDb();
  const warningId = newId();
  const createdAt = new Date().toISOString();
  const requested = [...new Set((taggedUserIds || []).filter(Boolean))];
  const allowed = new Set(listActiveUsersForTagging().map(u => u.id));
  const recipients = requested.filter(id => allowed.has(id));

  const insertWarning = db.prepare(`
    INSERT INTO driver_warnings (id, driver_key, driver_name, comment, discipline_band, issued_by_user_id, issued_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNotif = db.prepare(`
    INSERT INTO user_notifications (id, user_id, type, title, body, link, warning_id, created_at)
    VALUES (?, ?, 'driver_warning', ?, ?, ?, ?, ?)
  `);
  const insertRecipient = db.prepare(`
    INSERT INTO warning_recipients (warning_id, user_id, email_sent) VALUES (?, ?, ?)
  `);

  const link = `/#/drivers/coaching?q=${encodeURIComponent(driverName)}`;
  const title = `Written warning · ${driverName}`;
  const bodyPreview = String(comment || '').trim().slice(0, 240);

  const tx = db.transaction(() => {
    insertWarning.run(
      warningId,
      driverKey,
      driverName,
      comment,
      disciplineBand || null,
      issuedBy.id,
      issuedBy.name || issuedBy.email,
      createdAt,
    );
    for (const uid of recipients) {
      insertNotif.run(newId(), uid, title, bodyPreview, link, warningId, createdAt);
      insertRecipient.run(warningId, uid, 0);
    }
  });
  tx();

  const emailResults = [];
  if (recipients.length) {
    const users = db.prepare(`
      SELECT id, email, name FROM users WHERE id IN (${recipients.map(() => '?').join(',')})
    `).all(...recipients);

    for (const u of users) {
      const result = await sendDriverWarningEmail({
        to: u.email,
        recipientName: u.name,
        driverName,
        comment,
        disciplineBand,
        issuedByName: issuedBy.name || issuedBy.email,
        link,
      });
      emailResults.push({ userId: u.id, email: u.email, ...result });
      if (result.sent) {
        db.prepare(`
          UPDATE warning_recipients SET email_sent = 1 WHERE warning_id = ? AND user_id = ?
        `).run(warningId, u.id);
      }
    }
  }

  return {
    id: warningId,
    driverKey,
    driverName,
    comment,
    disciplineBand,
    createdAt,
    taggedUserIds: recipients,
    emailResults,
  };
}
