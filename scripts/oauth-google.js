/**
 * Google OAuth (Sign in with Google) — works on local and production via APP_PUBLIC_URL.
 * Register BOTH redirect URIs on the same Google OAuth client:
 *   http://localhost:5173/api/auth/oauth/google/callback
 *   https://hbm.bestpracticesltd.com.ng/api/auth/oauth/google/callback
 *
 * Existing password users can link Google on first successful Google sign-in
 * (same email). Domain allowlist is skipped for emails that already have an HBM account.
 */
import crypto from 'crypto';
import {
  loginWithEmail,
  findActiveUserByEmail,
  sessionCookieHeader,
  shouldUseSecureCookie,
} from './auth.js';

const OAUTH_STATE_COOKIE = 'bpl_oauth_state';
const OAUTH_PORTAL_COOKIE = 'bpl_oauth_portal';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function isGoogleOAuthConfigured() {
  return !!(process.env.OAUTH_GOOGLE_CLIENT_ID && process.env.OAUTH_GOOGLE_CLIENT_SECRET);
}

/** Canonical app origin — set APP_PUBLIC_URL per environment (.env local vs droplet). */
export function getAppPublicUrl(req) {
  const configured = String(process.env.APP_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const host = req?.headers?.host || 'localhost:5173';
  const secure = shouldUseSecureCookie(req);
  const xfProto = req?.headers?.['x-forwarded-proto'];
  const proto = typeof xfProto === 'string' && xfProto.split(',')[0].trim() === 'https'
    ? 'https'
    : (secure ? 'https' : 'http');
  return `${proto}://${host}`;
}

function googleRedirectUri(baseUrl) {
  return `${baseUrl}/api/auth/oauth/google/callback`;
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

/**
 * Domain allowlist applies to unknown emails only.
 * Existing HBM users (incl. @gmail.com password accounts) may always link / sign in with Google.
 */
function oauthEmailPermitted(email) {
  const existing = findActiveUserByEmail(email);
  if (existing && existing.status === 'active') return true;
  return emailDomainAllowed(email);
}

function loginErrorRedirect(baseUrl, code, message) {
  const qs = new URLSearchParams({ oauth: code, msg: message });
  return `${baseUrl}/#/login?${qs.toString()}`;
}

export function startGoogleOAuth(req, res) {
  if (!isGoogleOAuthConfigured()) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Google sign-in is not configured' }));
    return;
  }

  const baseUrl = getAppPublicUrl(req);
  const portal = parseOAuthPortal(req);
  const state = crypto.randomBytes(24).toString('hex');
  const params = new URLSearchParams({
    client_id: process.env.OAUTH_GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(baseUrl),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });

  res.statusCode = 302;
  res.setHeader('Set-Cookie', [
    oauthStateCookieHeader(state, { req }),
    oauthPortalCookieHeader(portal, { req }),
  ]);
  res.setHeader('Location', `${GOOGLE_AUTH_URL}?${params.toString()}`);
  res.end();
}

async function exchangeGoogleCode(code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.OAUTH_GOOGLE_CLIENT_ID,
    client_secret: process.env.OAUTH_GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    throw Object.assign(
      new Error(tokenData.error_description || tokenData.error || 'Google token exchange failed'),
      { status: 502 },
    );
  }
  return tokenData;
}

async function fetchGoogleProfile(accessToken) {
  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await profileRes.json().catch(() => ({}));
  if (!profileRes.ok) {
    throw Object.assign(new Error('Could not load Google profile'), { status: 502 });
  }
  return profile;
}

export async function handleGoogleOAuthCallback(req, res) {
  const baseUrl = getAppPublicUrl(req);
  const url = new URL(req.url || '/', `${baseUrl}/`);
  const error = url.searchParams.get('error');
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
    res.setHeader('Location', loginErrorRedirect(baseUrl, 'denied', 'Google sign-in was cancelled'));
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
    const redirectUri = googleRedirectUri(baseUrl);
    const tokens = await exchangeGoogleCode(code, redirectUri);
    const profile = await fetchGoogleProfile(tokens.access_token);
    const email = String(profile.email || '').trim().toLowerCase();
    const emailVerified = profile.email_verified !== false;
    const providerSubject = String(profile.sub || '').trim();

    if (!email || !emailVerified) {
      res.statusCode = 302;
      res.setHeader('Set-Cookie', clearCookies);
      res.setHeader('Location', loginErrorRedirect(baseUrl, 'email', 'Google did not return a verified email'));
      res.end();
      return;
    }

    if (!providerSubject) {
      res.statusCode = 302;
      res.setHeader('Set-Cookie', clearCookies);
      res.setHeader('Location', loginErrorRedirect(baseUrl, 'email', 'Google did not return a stable account id'));
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
      displayName: profile.name || profile.given_name || email,
      provider: 'google',
      providerSubject,
      viaTransporterPortal,
    });

    res.statusCode = 302;
    res.setHeader('Set-Cookie', clearCookies);
    res.appendHeader('Set-Cookie', sessionCookieHeader(result.sessionId, { req }));
    res.setHeader('Location', `${baseUrl}/#/`);
    res.end();
  } catch (e) {
    let msg = e?.message || 'Google sign-in failed';
    if (e?.status === 403) {
      if (e.code === 'transporter_portal_required') {
        msg = 'Use the Transporter login for this account';
      } else if (e.code === 'admin_portal_required') {
        msg = 'Use the HBM Admin login for this account';
      } else {
        msg = 'No HBM account for this Google email — ask an admin to invite you first, then use Google to link it';
      }
    } else if (e?.status === 409) {
      msg = e.message || 'This Google account is already linked elsewhere';
    }
    res.statusCode = 302;
    res.setHeader('Set-Cookie', clearCookies);
    res.setHeader('Location', loginErrorRedirect(baseUrl, 'failed', msg));
    res.end();
  }
}

export function getOAuthProviderStatus() {
  return {
    google: isGoogleOAuthConfigured(),
    microsoft: !!(process.env.OAUTH_MICROSOFT_CLIENT_ID && process.env.OAUTH_MICROSOFT_CLIENT_SECRET),
    publicUrl: process.env.APP_PUBLIC_URL || null,
  };
}
