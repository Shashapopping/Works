import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
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
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg, #0a1520 0%, #0e2438 50%, #0a1520 100%)',
      padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 400, background: 'var(--cd-surface)',
        border: '1px solid var(--cd-border)', borderRadius: 14, padding: 28,
        boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            background: '#fff', borderRadius: 6, padding: '6px 10px',
            display: 'flex', alignItems: 'center',
          }}>
            <img src="/HBM-logo.jpeg" alt="HBM" style={{ height: 28, display: 'block' }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
              HBM Fleet Intelligence
            </div>
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>Sign in to continue</div>
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
        ) : (
          <form onSubmit={onLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
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
          </form>
        )}
      </div>
    </div>
  );
}
