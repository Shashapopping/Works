import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Mail, Pause, Play, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type Frequency = 'daily' | 'weekly' | 'monthly';

interface PackDef {
  id: string;
  label: string;
  hint: string;
}

interface Automation {
  id: string;
  enabled: boolean;
  frequency: Frequency;
  packs: string[];
  recipients: string[];
  sendHour: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
  lastSentAt: string | null;
  nextSendAt: string | null;
  lastError: string | null;
}

const WEEKDAYS = [
  { v: 1, label: 'Mon' },
  { v: 2, label: 'Tue' },
  { v: 3, label: 'Wed' },
  { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' },
  { v: 6, label: 'Sat' },
  { v: 0, label: 'Sun' },
];

function fmtWhen(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

async function automateFetch(url: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

export default function ReportAutomate() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [packs, setPacks] = useState<PackDef[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [defaultRecipient, setDefaultRecipient] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [selectedPacks, setSelectedPacks] = useState<Set<string>>(() => new Set(['safety_events']));
  const [recipients, setRecipients] = useState('');
  const [sendHour, setSendHour] = useState(7);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await automateFetch('/api/reports/automate');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not load Automate');
      }
      const data = await res.json();
      setAutomations(data.automations || []);
      setPacks(data.packs || []);
      setEmailConfigured(!!data.emailConfigured);
      const fallback = data.defaultRecipient || user?.email || '';
      setDefaultRecipient(fallback);
      setRecipients(prev => prev || fallback);
      if ((data.automations || []).length > 0) setOpen(true);
    } catch (e: any) {
      setError(e?.message || 'Could not load Automate');
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => { void load(); }, [load]);

  const togglePack = (id: string) => {
    setSelectedPacks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await automateFetch('/api/reports/automate', {
        method: 'POST',
        body: JSON.stringify({
          frequency,
          packs: [...selectedPacks],
          recipients: recipients.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean),
          sendHour,
          dayOfWeek,
          dayOfMonth,
          timezone: 'Africa/Lagos',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      setAutomations(prev => [data.automation, ...prev]);
      setMessage('Automation saved to your account.');
      setOpen(true);
    } catch (e: any) {
      setError(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    const res = await automateFetch(`/api/reports/automate/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Update failed');
    setAutomations(prev => prev.map(a => (a.id === id ? data.automation : a)));
    return data.automation as Automation;
  };

  const remove = async (id: string) => {
    setError(null);
    const res = await automateFetch(`/api/reports/automate/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Delete failed');
      return;
    }
    setAutomations(prev => prev.filter(a => a.id !== id));
  };

  const sendTest = async (id: string) => {
    setSendingId(id);
    setMessage(null);
    setError(null);
    try {
      const res = await automateFetch(`/api/reports/automate/${id}/send`, {
        method: 'POST',
        body: JSON.stringify({ test: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.sent) throw new Error(data.error || 'Send failed');
      if (data.automation) {
        setAutomations(prev => prev.map(a => (a.id === id ? data.automation : a)));
      }
      setMessage('Test report sent.');
    } catch (e: any) {
      setError(e?.message || 'Send failed');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="bpl-automate">
      <label className="bpl-automate-check">
        <input
          type="checkbox"
          checked={open}
          onChange={e => setOpen(e.target.checked)}
        />
        <span className="bpl-automate-check-box" aria-hidden>{open ? <Check size={11} strokeWidth={3} /> : null}</span>
        <span className="bpl-automate-check-copy">
          <strong>Automate</strong>
          <em>Email reports on a calm schedule — tied to your account</em>
        </span>
      </label>

      {open && (
        <div className="bpl-automate-panel">
          {!emailConfigured && (
            <div className="bpl-automate-banner warn">
              Resend is not configured on this server yet. Schedules can still be saved; sends will wait for an API key.
            </div>
          )}

          {loading ? (
            <div className="bpl-automate-quiet"><Loader2 size={14} className="bpl-automate-spin" /> Loading your automations…</div>
          ) : (
            <>
              <div className="bpl-automate-hero">
                <Mail size={16} strokeWidth={1.75} />
                <div>
                  <div className="bpl-automate-hero-title">Set it once. Exhale.</div>
                  <div className="bpl-automate-hero-sub">
                    Pick what matters, choose a cadence, and we’ll deliver a quiet summary to your inbox.
                  </div>
                </div>
              </div>

              <div className="bpl-automate-section">
                <div className="bpl-automate-label">Report packs</div>
                <div className="bpl-automate-packs">
                  {(packs.length ? packs : [
                    { id: 'safety_events', label: 'Safety & incidents', hint: 'Event counts for the period' },
                    { id: 'fleet_summary', label: 'Fleet summary', hint: 'Live status snapshot' },
                  ]).map(pack => {
                    const on = selectedPacks.has(pack.id);
                    return (
                      <button
                        key={pack.id}
                        type="button"
                        className={`bpl-automate-pack${on ? ' on' : ''}`}
                        onClick={() => togglePack(pack.id)}
                      >
                        <span className="bpl-automate-pack-check">{on ? <Check size={12} strokeWidth={3} /> : null}</span>
                        <span>
                          <strong>{pack.label}</strong>
                          <em>{pack.hint}</em>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bpl-automate-section">
                <div className="bpl-automate-label">Cadence</div>
                <div className="bpl-automate-seg">
                  {([
                    ['daily', 'Daily'],
                    ['weekly', 'Weekly'],
                    ['monthly', 'Monthly'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={frequency === key ? 'on' : ''}
                      onClick={() => setFrequency(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {frequency === 'weekly' && (
                <div className="bpl-automate-section">
                  <div className="bpl-automate-label">Day</div>
                  <div className="bpl-automate-seg bpl-automate-seg--wrap">
                    {WEEKDAYS.map(d => (
                      <button
                        key={d.v}
                        type="button"
                        className={dayOfWeek === d.v ? 'on' : ''}
                        onClick={() => setDayOfWeek(d.v)}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {frequency === 'monthly' && (
                <div className="bpl-automate-section">
                  <div className="bpl-automate-label">Day of month</div>
                  <input
                    className="bpl-automate-input"
                    type="number"
                    min={1}
                    max={28}
                    value={dayOfMonth}
                    onChange={e => setDayOfMonth(Number(e.target.value) || 1)}
                  />
                </div>
              )}

              <div className="bpl-automate-row">
                <div className="bpl-automate-section" style={{ flex: 1 }}>
                  <div className="bpl-automate-label">Send hour (Lagos)</div>
                  <select
                    className="bpl-automate-input"
                    value={sendHour}
                    onChange={e => setSendHour(Number(e.target.value))}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="bpl-automate-section">
                <div className="bpl-automate-label">Recipients</div>
                <input
                  className="bpl-automate-input"
                  type="text"
                  placeholder={defaultRecipient || 'you@company.com'}
                  value={recipients}
                  onChange={e => setRecipients(e.target.value)}
                />
                <div className="bpl-automate-hint">Comma-separated. Defaults to your account email.</div>
              </div>

              <button
                type="button"
                className="bpl-automate-primary"
                disabled={saving || selectedPacks.size === 0}
                onClick={() => void create()}
              >
                {saving ? 'Saving…' : 'Save automation'}
              </button>

              {automations.length > 0 && (
                <div className="bpl-automate-list">
                  <div className="bpl-automate-label">Your automations</div>
                  {automations.map(a => (
                    <div key={a.id} className={`bpl-automate-card${a.enabled ? '' : ' paused'}`}>
                      <div className="bpl-automate-card-top">
                        <div>
                          <strong>{a.frequency}</strong>
                          <span> · {a.packs.join(', ')}</span>
                        </div>
                        <div className="bpl-automate-card-actions">
                          <button
                            type="button"
                            title={a.enabled ? 'Pause' : 'Resume'}
                            onClick={() => void patch(a.id, { enabled: !a.enabled }).catch(e => setError(e.message))}
                          >
                            {a.enabled ? <Pause size={13} /> : <Play size={13} />}
                          </button>
                          <button
                            type="button"
                            title="Send test"
                            disabled={sendingId === a.id || !emailConfigured}
                            onClick={() => void sendTest(a.id)}
                          >
                            {sendingId === a.id ? <Loader2 size={13} className="bpl-automate-spin" /> : <Send size={13} />}
                          </button>
                          <button type="button" title="Delete" onClick={() => void remove(a.id)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      <div className="bpl-automate-card-meta">
                        To {a.recipients.join(', ')}
                        <br />
                        Next {fmtWhen(a.nextSendAt)}
                        {a.lastSentAt ? ` · Last ${fmtWhen(a.lastSentAt)}` : ''}
                        {a.lastError ? ` · ${a.lastError}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {message && <div className="bpl-automate-banner ok">{message}</div>}
              {error && <div className="bpl-automate-banner warn">{error}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
