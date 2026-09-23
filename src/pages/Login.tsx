import { useState, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchOAuthProviders, startGoogleOAuth, startMicrosoftOAuth } from '../lib/authApi';
import { brandLogoAlt, brandLogoSrc, productName } from '../lib/branding';
import { Lock, Check, Building2, Truck, ChevronLeft } from 'lucide-react';

type LoginPortal = 'admin' | 'transporter';

export default function Login() {
  const { user, loading, login, changePassword } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string; reason?: string } | null)?.from || '/';
  const sessionExpired = (location.state as { reason?: string } | null)?.reason === 'session_expired';

  const [portal, setPortal] = useState<LoginPortal | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() => (
    sessionExpired ? 'Your session expired. Please sign in again.' : ''
  ));
  const [busy, setBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [microsoftEnabled, setMicrosoftEnabled] = useState(false);

  useEffect(() => {
    fetchOAuthProviders()
      .then(p => {
        setGoogleEnabled(p.google);
        setMicrosoftEnabled(p.microsoft);
      })
      .catch(() => {});
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const oauthErr = params.get('msg');
    if (params.get('oauth') && oauthErr) setError(oauthErr);
    else if ((location.state as { reason?: string } | null)?.reason === 'session_expired') {
      setError('Your session expired. Please sign in again.');
    }
  }, [location.state]);

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

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 14,
    background: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'block',
  };

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password, portal === 'transporter');
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

  const portalCardStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    padding: '16px 14px',
    borderRadius: 10,
    cursor: 'pointer',
    textAlign: 'left',
    background: active ? 'rgba(0,120,212,0.14)' : 'var(--cd-surface-2)',
    border: active ? '1px solid rgba(0,120,212,0.55)' : '1px solid var(--cd-border)',
    color: 'var(--cd-text)',
    transition: 'border-color 0.15s, background 0.15s',
  });

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg, #0a1520 0%, #0e2438 50%, #0a1520 100%)',
      padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: portal === null ? 480 : 400, background: 'var(--cd-surface)',
        border: '1px solid var(--cd-border)', borderRadius: 14, padding: 28,
        boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
        transition: 'max-width 0.2s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          {brandLogoSrc() ? (
            <div style={{
              background: '#fff', borderRadius: 6, padding: '6px 10px',
              display: 'flex', alignItems: 'center',
            }}>
              <img src={brandLogoSrc()!} alt={brandLogoAlt()} style={{ height: 28, display: 'block' }} />
            </div>
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'var(--bpl-blue, #0078D4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 14,
            }}>
              F
            </div>
          )}
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
              {productName()}
            </div>
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>
              {mustChange ? 'Set your password' : portal === null ? 'Choose how to sign in' : 'Sign in to continue'}
            </div>
          </div>
        </div>

        {mustChange ? (
          <form onSubmit={onChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--cd-text-muted)',
              background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', borderRadius: 8, padding: '10px 12px',
            }}>
              <Lock size={14} />
              Set a new password before using the platform (admin-provisioned account).
            </div>
            <div>
              <label style={labelStyle}>Current password</label>
              <input
                type="password"
                style={fieldStyle}
                value={currentPassword || password}
                onChange={e => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label style={labelStyle}>New password</label>
              <input
                type="password"
                style={fieldStyle}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div>
              <label style={labelStyle}>Confirm new password</label>
              <input
                type="password"
                style={fieldStyle}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            {error && <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>}
            <button type="submit" className="bpl-btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? 'Saving…' : <><Check size={14} /> Save and continue</>}
            </button>
          </form>
        ) : portal === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                onClick={() => { setPortal('admin'); setError(''); }}
                style={portalCardStyle(false)}
              >
                <Building2 size={22} style={{ color: 'var(--bpl-blue, #0078D4)' }} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>HBM Admin</span>
                <span style={{ fontSize: 12, color: 'var(--cd-text-muted)', lineHeight: 1.45 }}>
                  Platform administrators and internal staff
                </span>
              </button>
              <button
                type="button"
                onClick={() => { setPortal('transporter'); setError(''); }}
                style={portalCardStyle(false)}
              >
                <Truck size={22} style={{ color: 'var(--bpl-blue, #0078D4)' }} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>Transporter</span>
                <span style={{ fontSize: 12, color: 'var(--cd-text-muted)', lineHeight: 1.45 }}>
                  External transporter partners — scoped to your fleet only
                </span>
              </button>
            </div>
            {error && <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>}
          </div>
        ) : (
          <form onSubmit={onLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
            <button
              type="button"
              onClick={() => { setPortal(null); setError(''); }}
              style={{
                alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--cd-text-muted)', fontSize: 12, fontWeight: 600, padding: 0,
              }}
            >
              <ChevronLeft size={14} />
              Back
            </button>

            <div style={{
              fontSize: 12, fontWeight: 700, color: 'var(--cd-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {portal === 'admin' ? 'HBM Admin' : 'Transporter'}
            </div>

            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                style={fieldStyle}
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                style={fieldStyle}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>}
            <button type="submit" className="bpl-btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            {(googleEnabled || microsoftEnabled) && (
              <>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  color: 'var(--cd-text-muted)', fontSize: 11, margin: '4px 0',
                }}>
                  <span style={{ flex: 1, height: 1, background: 'var(--cd-border)' }} />
                  or
                  <span style={{ flex: 1, height: 1, background: 'var(--cd-border)' }} />
                </div>
                {googleEnabled && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startGoogleOAuth({ portal: portal === 'transporter' ? 'transporter' : 'admin' })}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14,
                      border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)',
                      color: 'var(--cd-text)', cursor: 'pointer', fontWeight: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.203 36 24 36c-5.514 0-10-4.486-10-10s4.486-10 10-10c2.841 0 5.406 1.197 7.188 3.113l5.657-5.657C34.046 10.891 29.268 9 24 9 14.611 9 7 16.611 7 26s7.611 17 17 17c9.389 0 17-7.611 17-17 0-1.134-.111-2.242-.389-3.917z"/>
                      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 16.108 18.961 13 24 13c2.841 0 5.406 1.197 7.188 3.113l5.657-5.657C34.046 10.891 29.268 9 24 9 16.318 9 9.656 13.337 6.306 20.309z"/>
                      <path fill="#4CAF50" d="M24 43c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 43 24 43z"/>
                      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.05 12.05 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.111-2.651-.389-3.917z"/>
                    </svg>
                    Sign in with Google
                  </button>
                )}
                {microsoftEnabled && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startMicrosoftOAuth({ portal: portal === 'transporter' ? 'transporter' : 'admin' })}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14,
                      border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)',
                      color: 'var(--cd-text)', cursor: 'pointer', fontWeight: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
                      <path fill="#f25022" d="M1 1h10v10H1z"/>
                      <path fill="#00a4ef" d="M12 1h10v10H12z"/>
                      <path fill="#7fba00" d="M1 12h10v10H1z"/>
                      <path fill="#ffb900" d="M12 12h10v10H12z"/>
                    </svg>
                    Sign in with Microsoft
                  </button>
                )}
                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', lineHeight: 1.45, textAlign: 'center' }}>
                  Existing accounts: use the same email as your invite — Google/Microsoft link automatically and password still works.
                </div>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
