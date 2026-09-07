import { useState, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchOAuthProviders, startGoogleOAuth } from '../lib/authApi';
import { brandLogoAlt, brandLogoSrc, clientName, platformName } from '../lib/branding';
import { Lock, Check } from 'lucide-react';

export default function Login() {
  const { user, loading, login, changePassword } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    fetchOAuthProviders().then(p => setGoogleEnabled(p.google)).catch(() => {});
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const oauthErr = params.get('msg');
    if (params.get('oauth') && oauthErr) setError(oauthErr);
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--cd-bg)' }}>
        <div style={{ color: 'var(--cd-text-muted)', fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  if (user && !user.mustChangePassword) {
    return <Navigate to={from} replace />;
  }

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const onChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword || password, newPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setBusy(false);
    }
  };

  const mustChange = !!user?.mustChangePassword;

  return (
    <div className="bpl-login-page">
      <div className="bpl-login-card">
        <div className="bpl-login-brand">
          {brandLogoSrc() ? (
            <img src={brandLogoSrc()!} alt={brandLogoAlt()} className="bpl-login-logo" />
          ) : (
            <div className="bpl-login-logo-fallback">H</div>
          )}
          <div className="bpl-login-brand-name">{clientName()}</div>
          <div className="bpl-login-brand-sub">{platformName()}</div>
          <div className="bpl-login-brand-hint">Sign in to continue</div>
        </div>

        {mustChange ? (
          <form onSubmit={onChangePassword} className="bpl-login-form">
            <div className="bpl-login-notice">
              <Lock size={14} />
              Set a new password before using the platform (admin-provisioned account).
            </div>
            <input
              type="password"
              className="bpl-login-field"
              placeholder="Current password"
              value={currentPassword || password}
              onChange={e => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <input
              type="password"
              className="bpl-login-field"
              placeholder="New password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <input
              type="password"
              className="bpl-login-field"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            {error && <div className="bpl-login-error">{error}</div>}
            <button type="submit" className="bpl-btn-primary bpl-login-submit" disabled={busy}>
              {busy ? 'Saving…' : <><Check size={14} /> Save and continue</>}
            </button>
          </form>
        ) : (
          <form onSubmit={onLogin} className="bpl-login-form">
            <input
              type="email"
              className="bpl-login-field"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
            <input
              type="password"
              className="bpl-login-field"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            {error && <div className="bpl-login-error">{error}</div>}
            <button type="submit" className="bpl-btn-primary bpl-login-submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            {googleEnabled && (
              <>
                <div className="bpl-login-divider">
                  <span />
                  or
                  <span />
                </div>
                <button
                  type="button"
                  className="bpl-login-btn-oauth"
                  disabled={busy}
                  onClick={() => startGoogleOAuth()}
                >
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.203 36 24 36c-5.514 0-10-4.486-10-10s4.486-10 10-10c2.841 0 5.406 1.197 7.188 3.113l5.657-5.657C34.046 10.891 29.268 9 24 9 14.611 9 7 16.611 7 26s7.611 17 17 17c9.389 0 17-7.611 17-17 0-1.134-.111-2.242-.389-3.917z"/>
                    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 16.108 18.961 13 24 13c2.841 0 5.406 1.197 7.188 3.113l5.657-5.657C34.046 10.891 29.268 9 24 9 16.318 9 9.656 13.337 6.306 20.309z"/>
                    <path fill="#4CAF50" d="M24 43c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 43 24 43z"/>
                    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.05 12.05 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.111-2.651-.389-3.917z"/>
                  </svg>
                  Sign in with Google
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
