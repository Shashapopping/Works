/**
 * Optional JWT auth for local experimentation (AUTH_MODE=jwt).
 * Production keeps opaque httpOnly session cookies (AUTH_MODE=session).
 */
import crypto from 'crypto';
import {
  getSessionUser,
  parseCookies,
  SESSION_COOKIE,
  getRolePermissions,
  publicUser,
} from './auth.js';
import { getDb } from './db.js';

const JWT_TTL_SEC = 7 * 24 * 60 * 60;

export function isJwtAuthMode() {
  return process.env.AUTH_MODE === 'jwt';
}

export function authModeLabel() {
  return isJwtAuthMode() ? 'jwt' : 'session';
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required when AUTH_MODE=jwt in production');
  }
  return 'local-dev-jwt-secret-change-me';
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function parseBearer(header) {
  if (!header || typeof header !== 'string') return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function signAccessToken(user) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    roleId: user.roleId,
    iat: now,
    exp: now + JWT_TTL_SEC,
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const sig = crypto.createHmac('sha256', jwtSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyAccessToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;
  const expected = crypto.createHmac('sha256', jwtSecret()).update(data).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.sub || !payload?.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function userFromId(userId) {
  const db = getDb();
  const user = db.prepare(`
    SELECT u.*, r.name AS role_name FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(userId);
  if (!user || user.status !== 'active') return null;
  return publicUser(user, getRolePermissions(user.role_id));
}

export function getUserFromAccessToken(token) {
  const payload = verifyAccessToken(token);
  if (!payload) return null;
  return userFromId(payload.sub);
}

/** Resolve authenticated user from Bearer JWT or session cookie (OAuth uses cookies). */
export function getRequestUser(req) {
  const bearer = parseBearer(req.headers?.authorization);
  if (bearer) {
    const jwtUser = getUserFromAccessToken(bearer);
    if (jwtUser) return jwtUser;
  }

  const cookies = parseCookies(req.headers?.cookie);
  return getSessionUser(cookies[SESSION_COOKIE] || null);
}
