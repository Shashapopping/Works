/**
 * Auth HTTP handlers — works with Express and Vite connect middleware.
 */
import {
  bootstrapAdminIfNeeded,
  changePassword,
  checkRateLimit,
  createUser,
  getSessionUser,
  listRoles,
  listUsers,
  login,
  logout,
  parseCookies,
  saveRoles,
  sessionCookieHeader,
  SESSION_COOKIE,
  updateUser,
  userHasPermission,
  ACCESS_CATALOG,
} from './auth.js';
import { isEmailConfigured } from './email.js';
import {
  createAutomation,
  deleteAutomation,
  listAutomationsForUser,
  REPORT_PACKS,
  sendAutomationNow,
  updateAutomation,
} from './report-automate.js';
import {
  archiveDocument,
  listDocumentTree,
  listFolderContents,
  resolveDownload,
} from './documents.js';
import fs from 'fs';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      resolve(req.body);
      return;
    }
    let raw = '';
    req.on('data', chunk => { raw += chunk.toString(); });
    req.on('end', () => {
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

function getSessionId(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE] || null;
}

async function requireUser(req, res, permission) {
  const sessionId = getSessionId(req);
  const user = getSessionUser(sessionId);
  if (!user) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }
  if (permission && !userHasPermission(user, permission)) {
    // Documents library is available to anyone who can open Reports
    if (permission === 'documents' && userHasPermission(user, 'reports')) {
      return user;
    }
    sendJson(res, 403, { error: 'Forbidden' });
    return null;
  }
  return user;
}

/**
 * Handle /api/auth/*, /api/users*, /api/roles*
 * Returns true if handled.
 */
export async function handleAuthRequest(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  try {
    // Ensure bootstrap once on first auth hit
    if (!handleAuthRequest._bootstrapped) {
      await bootstrapAdminIfNeeded();
      handleAuthRequest._bootstrapped = true;
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const rl = checkRateLimit(clientIp(req), { limit: 15, windowMs: 15 * 60 * 1000 });
      if (!rl.ok) {
        res.setHeader('Retry-After', String(rl.retryAfterSec));
        sendJson(res, 429, { error: 'Too many login attempts. Try again later.' });
        return true;
      }
      const body = await readBody(req);
      const result = await login(body.email, body.password);
      res.setHeader('Set-Cookie', sessionCookieHeader(result.sessionId, { req }));
      sendJson(res, 200, { user: result.user });
      return true;
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      logout(getSessionId(req));
      res.setHeader('Set-Cookie', sessionCookieHeader('', { clear: true, req }));
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === '/api/auth/me' && method === 'GET') {
      const user = getSessionUser(getSessionId(req));
      if (!user) { sendJson(res, 401, { error: 'Unauthorized' }); return true; }
      sendJson(res, 200, { user, accessCatalog: ACCESS_CATALOG });
      return true;
    }

    if (path === '/api/auth/change-password' && method === 'POST') {
      const user = await requireUser(req, res);
      if (!user) return true;
      const body = await readBody(req);
      await changePassword(user.id, body.currentPassword, body.newPassword);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === '/api/roles' && method === 'GET') {
      const user = await requireUser(req, res, 'settings');
      if (!user) return true;
      sendJson(res, 200, { roles: listRoles(), accessCatalog: ACCESS_CATALOG });
      return true;
    }

    if (path === '/api/roles' && method === 'PUT') {
      const user = await requireUser(req, res, 'settings');
      if (!user) return true;
      const body = await readBody(req);
      const roles = saveRoles(body.roles || body);
      sendJson(res, 200, { roles });
      return true;
    }

    if (path === '/api/users' && method === 'GET') {
      const user = await requireUser(req, res, 'user-management');
      if (!user) return true;
      sendJson(res, 200, { users: listUsers(), roles: listRoles() });
      return true;
    }

    if (path === '/api/users' && method === 'POST') {
      const user = await requireUser(req, res, 'user-management');
      if (!user) return true;
      const rl = checkRateLimit(`create:${clientIp(req)}`, { limit: 30, windowMs: 60 * 60 * 1000 });
      if (!rl.ok) {
        sendJson(res, 429, { error: 'Too many user create attempts.' });
        return true;
      }
      const body = await readBody(req);
      const created = await createUser({
        email: body.email,
        name: body.name,
        password: body.password,
        roleId: body.roleId,
        actorId: user.id,
      });
      sendJson(res, 201, { user: created });
      return true;
    }

    const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && method === 'PATCH') {
      const actor = await requireUser(req, res, 'user-management');
      if (!actor) return true;
      const body = await readBody(req);
      const updated = await updateUser(decodeURIComponent(userMatch[1]), body, actor.id);
      sendJson(res, 200, { user: updated });
      return true;
    }

    // ── Report Automate (tied to signed-in account) ─────────────────────────
    if (path === '/api/reports/automate' && method === 'GET') {
      const user = await requireUser(req, res, 'reports');
      if (!user) return true;
      sendJson(res, 200, {
        automations: listAutomationsForUser(user.id),
        packs: REPORT_PACKS,
        emailConfigured: isEmailConfigured(),
        defaultRecipient: user.email,
      });
      return true;
    }

    if (path === '/api/reports/automate' && method === 'POST') {
      const user = await requireUser(req, res, 'reports');
      if (!user) return true;
      const body = await readBody(req);
      const automation = createAutomation(user.id, body, user.email);
      sendJson(res, 201, { automation });
      return true;
    }

    const autoMatch = path.match(/^\/api\/reports\/automate\/([^/]+)$/);
    if (autoMatch && method === 'PATCH') {
      const user = await requireUser(req, res, 'reports');
      if (!user) return true;
      const body = await readBody(req);
      const automation = updateAutomation(decodeURIComponent(autoMatch[1]), user.id, body, user.email);
      sendJson(res, 200, { automation });
      return true;
    }

    if (autoMatch && method === 'DELETE') {
      const user = await requireUser(req, res, 'reports');
      if (!user) return true;
      deleteAutomation(decodeURIComponent(autoMatch[1]), user.id);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const autoSendMatch = path.match(/^\/api\/reports\/automate\/([^/]+)\/send$/);
    if (autoSendMatch && method === 'POST') {
      const user = await requireUser(req, res, 'reports');
      if (!user) return true;
      const body = await readBody(req);
      const result = await sendAutomationNow(
        decodeURIComponent(autoSendMatch[1]),
        user.id,
        { test: !!body.test },
      );
      sendJson(res, result.sent ? 200 : 502, result);
      return true;
    }

    // ── Documents library (Windows-style report archive) ────────────────────
    if (path === '/api/documents/tree' && method === 'GET') {
      const user = await requireUser(req, res, 'documents');
      if (!user) return true;
      sendJson(res, 200, { tree: listDocumentTree() });
      return true;
    }

    if (path === '/api/documents' && method === 'GET') {
      const user = await requireUser(req, res, 'documents');
      if (!user) return true;
      const folderId = url.searchParams.get('folderId') || null;
      sendJson(res, 200, listFolderContents(folderId));
      return true;
    }

    if (path === '/api/documents/archive' && method === 'POST') {
      const user = await requireUser(req, res, 'documents');
      if (!user) return true;
      const body = await readBody(req);
      const contentBase64 = body.contentBase64 || body.content || '';
      if (!contentBase64 || typeof contentBase64 !== 'string') {
        sendJson(res, 400, { error: 'contentBase64 required' });
        return true;
      }
      let buffer;
      try {
        buffer = Buffer.from(contentBase64, 'base64');
      } catch {
        sendJson(res, 400, { error: 'Invalid base64 content' });
        return true;
      }
      const archived = archiveDocument({
        filename: body.filename || body.name || `report-${Date.now()}.bin`,
        mime: body.mime || 'application/octet-stream',
        buffer,
        type: body.type || 'Events',
        source: body.source || 'reports-download',
        meta: body.meta || null,
        createdBy: user.id,
        when: body.when ? new Date(body.when) : new Date(),
      });
      sendJson(res, 201, archived);
      return true;
    }

    const docDownload = path.match(/^\/api\/documents\/([^/]+)\/download$/);
    if (docDownload && method === 'GET') {
      const user = await requireUser(req, res, 'documents');
      if (!user) return true;
      const { file, absolutePath } = resolveDownload(decodeURIComponent(docDownload[1]));
      const data = fs.readFileSync(absolutePath);
      res.statusCode = 200;
      res.setHeader('Content-Type', file.mime || 'application/octet-stream');
      res.setHeader('Content-Length', String(data.length));
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${String(file.name).replace(/"/g, '')}"`,
      );
      res.end(data);
      return true;
    }

    return false;
  } catch (e) {
    const status = e?.status || 500;
    sendJson(res, status, { error: e?.message || 'Server error' });
    return true;
  }
}

handleAuthRequest._bootstrapped = false;

/** Express middleware wrapper */
export function authExpressMiddleware() {
  return async (req, res, next) => {
    const path = req.path || req.url?.split('?')[0];
    if (
      path?.startsWith('/api/auth') ||
      path === '/api/roles' ||
      path?.startsWith('/api/users') ||
      path?.startsWith('/api/reports/automate') ||
      path?.startsWith('/api/documents')
    ) {
      // Normalize url for handleAuthRequest
      req.url = path + (req.url?.includes('?') ? '?' + req.url.split('?')[1] : '');
      const handled = await handleAuthRequest(req, res);
      if (handled) return;
    }
    next();
  };
}

/** Vite connect middleware */
export function authViteMiddleware() {
  return async (req, res, next) => {
    const urlPath = (req.url || '').split('?')[0];
    if (
      urlPath.startsWith('/api/auth') ||
      urlPath === '/api/roles' ||
      urlPath.startsWith('/api/users') ||
      urlPath.startsWith('/api/reports/automate') ||
      urlPath.startsWith('/api/documents')
    ) {
      const handled = await handleAuthRequest(req, res);
      if (handled) return;
    }
    next();
  };
}
