/**
 * Microsoft Entra ID OAuth — same link-to-existing-user path as Google.
 * Register BOTH redirect URIs on the Entra app (Web platform):
 *   http://localhost:5173/api/auth/oauth/microsoft/callback
 *   https://hbm.bestpracticesltd.com.ng/api/auth/oauth/microsoft/callback
 *
 * Env: OAUTH_MICROSOFT_CLIENT_ID, OAUTH_MICROSOFT_CLIENT_SECRET,
 *      OAUTH_MICROSOFT_TENANT_ID (default: common)
 */
import crypto from 'crypto';
import {
  loginWithEmail,
  findActiveUserByEmail,
  sessionCookieHeader,
  shouldUseSecureCookie,
} from './auth.js';
import { getAppPublicUrl } from './oauth-google.js';

const OAUTH_STATE_COOKIE = 'bpl_oauth_ms_state';
const OAUTH_PORTAL_COOKIE = 'bpl_oauth_portal';

export function isMicrosoftOAuthConfigured() {
  return !!(process.env.OAUTH_MICROSOFT_CLIENT_ID && process.env.OAUTH_MICROSOFT_CLIENT_SECRET);
}

function microsoftTenant() {
  const t = String(process.env.OAUTH_MICROSOFT_TENANT_ID || 'common').trim();
  return t || 'common';
}

function microsoftAuthorizeUrl() {
  return `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/authorize`;
}

function microsoftTokenUrl() {
  return `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/token`;
}

function microsoftRedirectUri(baseUrl) {
  return `${baseUrl}/api/auth/oauth/microsoft/callback`;
}

function cookieSecureFlag(req) {
  return shouldUseSecureCookie(req) ? '; Secure' : '';
}

function oauthStateCookieHeader(state, { clear = false, req = null } = {}) {
  if (clear) {
    return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureFlag(req)}`;
  }
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${cookieSecureFlag(req)}`;
}

function oauthPortalCookieHeader(portal, { clear = false, req = null } = {}) {
  if (clear) {
    return `${OAUTH_PORTAL_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureFlag(req)}`;
  }
  const value = portal === 'transporter' ? 'transporter' : 'admin';
  return `${OAUTH_PORTAL_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${cookieSecureFlag(req)}`;
}

function parseOAuthPortal(req) {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    return url.searchParams.get('portal') === 'transporter' ? 'transporter' : 'admin';
  } catch {
    return 'admin';
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function allowedEmailDomains() {
  const raw = String(process.env.OAUTH_ALLOWED_DOMAINS || '').trim();
  if (!raw) return null;
  return new Set(raw.split(',').map(d => d.trim().toLowerCase()).filter(Boolean));
}

function emailDomainAllowed(email) {
  const domains = allowedEmailDomains();
  if (!domains || domains.size === 0) return true;
  const domain = String(email || '').split('@')[1]?.toLowerCase();
  return !!domain && domains.has(domain);
}

/** Existing HBM users may always link Microsoft; allowlist only blocks unknown emails. */
function oauthEmailPermitted(email) {
  const existing = findActiveUserByEmail(email);
  if (existing && existing.status === 'active') return true;
  return emailDomainAllowed(email);
}

function loginErrorRedirect(baseUrl, code, message) {
  const qs = new URLSearchParams({ oauth: code, msg: message });
  return `${baseUrl}/#/login?${qs.toString()}`;
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return {};
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function startMicrosoftOAuth(req, res) {
  if (!isMicrosoftOAuthConfigured()) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Microsoft sign-in is not configured' }));
    return;
  }

  const baseUrl = getAppPublicUrl(req);
  const portal = parseOAuthPortal(req);
  const state = crypto.randomBytes(24).toString('hex');
  const params = new URLSearchParams({
    client_id: process.env.OAUTH_MICROSOFT_CLIENT_ID,
    redirect_uri: microsoftRedirectUri(baseUrl),
    response_type: 'code',
    scope: 'openid profile email',
    state,
    response_mode: 'query',
    prompt: 'select_account',
  });

  res.statusCode = 302;
  res.setHeader('Set-Cookie', [
    oauthStateCookieHeader(state, { req }),
    oauthPortalCookieHeader(portal, { req }),
  ]);
  res.setHeader('Location', `${microsoftAuthorizeUrl()}?${params.toString()}`);
  res.end();
}

async function exchangeMicrosoftCode(code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.OAUTH_MICROSOFT_CLIENT_ID,
    client_secret: process.env.OAUTH_MICROSOFT_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: 'openid profile email',
  });

  const tokenRes = await fetch(microsoftTokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    throw Object.assign(
      new Error(tokenData.error_description || tokenData.error || 'Microsoft token exchange failed'),
      { status: 502 },
    );
  }
  return tokenData;
}

export async function handleMicrosoftOAuthCallback(req, res) {
  const baseUrl = getAppPublicUrl(req);
  const url = new URL(req.url || '/', `${baseUrl}/`);
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const clearCookies = [
    oauthStateCookieHeader('', { clear: true, req }),
    oauthPortalCookieHeader('', { clear: true, req }),
  ];
  const cookies = parseCookies(req.headers?.cookie);
  const expectedState = cookies[OAUTH_STATE_COOKIE];
  const viaTransporterPortal = cookies[OAUTH_PORTAL_COOKIE] === 'transporter';

  if (error) {
    res.statusCode = 302;
    res.setHeader('Set-Cookie', clearCookies);
    res.setHeader(
      'Location',
      loginErrorRedirect(baseUrl, 'denied', errorDesc || 'Microsoft sign-in was cancelled'),
    );
    res.end();
    return;
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    res.statusCode = 302;
    res.setHeader('Set-Cookie', clearCookies);
    res.setHeader('Location', loginErrorRedirect(baseUrl, 'invalid', 'Invalid OAuth state — try again'));
    res.end();
    return;
  }

  try {
    const redirectUri = microsoftRedirectUri(baseUrl);
    const tokens = await exchangeMicrosoftCode(code, redirectUri);
    const claims = decodeJwtPayload(tokens.id_token);
    const email = String(
      claims.email || claims.preferred_username || claims.upn || '',
    ).trim().toLowerCase();
    const providerSubject = String(claims.oid || claims.sub || '').trim();
    const displayName = String(claims.name || claims.given_name || email).trim();

    if (!email || !email.includes('@')) {
      res.statusCode = 302;
      res.setHeader('Set-Cookie', clearCookies);
      res.setHeader(
        'Location',
        loginErrorRedirect(baseUrl, 'email', 'Microsoft did not return an email — ensure the email claim is enabled'),
      );
      res.end();
      return;
    }

    if (!providerSubject) {
      res.statusCode = 302;
      res.setHeader('Set-Cookie', clearCookies);
      res.setHeader('Location', loginErrorRedirect(baseUrl, 'email', 'Microsoft did not return a stable account id'));
      res.end();
      return;
    }

    if (!oauthEmailPermitted(email)) {
      res.statusCode = 302;
      res.setHeader('Set-Cookie', clearCookies);
      res.setHeader('Location', loginErrorRedirect(baseUrl, 'domain', 'This email domain is not allowed for HBM'));
      res.end();
      return;
    }

    const result = await loginWithEmail(email, {
      displayName,
      provider: 'microsoft',
      providerSubject,
      viaTransporterPortal,
    });

    res.statusCode = 302;
    res.setHeader('Set-Cookie', clearCookies);
    res.appendHeader('Set-Cookie', sessionCookieHeader(result.sessionId, { req }));
    res.setHeader('Location', `${baseUrl}/#/`);
    res.end();
  } catch (e) {
    let msg = e?.message || 'Microsoft sign-in failed';
    if (e?.status === 403) {
      if (e.code === 'transporter_portal_required') {
        msg = 'Use the Transporter login for this account';
      } else if (e.code === 'admin_portal_required') {
        msg = 'Use the HBM Admin login for this account';
      } else {
        msg = 'No HBM account for this Microsoft email — ask an admin to invite you first, then use Microsoft to link it';
      }
    } else if (e?.status === 409) {
      msg = e.message || 'This Microsoft account is already linked elsewhere';
    }
    res.statusCode = 302;
    res.setHeader('Set-Cookie', clearCookies);
    res.setHeader('Location', loginErrorRedirect(baseUrl, 'failed', msg));
    res.end();
  }
}
