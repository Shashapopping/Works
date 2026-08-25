import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, Pause, Play, Save, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useFleet } from '../context/FleetContext';
import { authFetchInit } from '../lib/authApi';
import { REPORT_TYPE_OPTIONS, reportTypeLabel, type ReportType } from '../lib/reportTypes';
import type { ExportFormat } from '../lib/reportExport';
import SiteScopeDropdown from './SiteScopeDropdown';
import { selectedSiteScopeLabel } from '../lib/cementSiteTree';

type Frequency = 'hourly' | 'daily' | 'weekly' | 'monthly';
type DateRange = 'today' | '7days' | '30days' | 'custom';
type ReportingWindowMode = 'last24h' | 'customLookback';
type LookbackUnit = 'hours' | 'days' | 'weeks';
type ViewMode = 'events' | 'trends';
type MonthlyPeriodMode = 'beginning' | 'end' | 'custom';

type ReportConfig = {
  dateRange?: DateRange;
  fromDate?: string;
  toDate?: string;
  windowMode: ReportingWindowMode;
  lookbackValue: number;
  lookbackUnit: LookbackUnit;
  search: string;
  site: string;
  siteKeys: string[];
  eventType: string;
  view: ViewMode;
  reportType: ReportType;
  tripGroupBy: 'asset' | 'driver';
  format: ExportFormat;
};

interface Automation {
  id: string;
  title: string | null;
  enabled: boolean;
  frequency: Frequency;
  packs: string[];
  reportConfig: ReportConfig | null;
  format: ExportFormat;
  recipients: string[];
  sendHour: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
  lastSentAt: string | null;
  nextSendAt: string | null;
  lastError: string | null;
}

interface ReportAutomateProps {
  embedded?: boolean;
  defaultOpen?: boolean;
  defaultFrequency?: Frequency;
  defaultPacks?: string[];
}

const EVENT_TYPES = [
  'Harsh Braking',
  'Harsh Acceleration',
  'Overspeeding',
  'Overspeed Tiered',
  'Harsh Cornering',
];

const WEEKDAYS = [
  { v: 1, label: 'Mon' },
  { v: 2, label: 'Tue' },
  { v: 3, label: 'Wed' },
  { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' },
  { v: 6, label: 'Sat' },
  { v: 0, label: 'Sun' },
];

const DEFAULT_CONFIG: ReportConfig = {
  windowMode: 'last24h',
  lookbackValue: 2,
  lookbackUnit: 'hours',
  search: '',
  site: '',
  siteKeys: [],
  eventType: '',
  view: 'events',
  reportType: 'events',
  tripGroupBy: 'asset',
  format: 'csv',
};

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

function formatLabel(format: ExportFormat) {
  return format === 'excel' ? 'EXCEL' : format.toUpperCase();
}

function normalizeLookbackValue(value: unknown) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 2;
}

function normalizeLookbackUnit(unit: unknown): LookbackUnit {
  return unit === 'days' || unit === 'weeks' ? unit : 'hours';
}

function migrateLegacyWindow(config: Partial<ReportConfig> & { dateRange?: DateRange }) {
  if (config.windowMode === 'last24h' || config.windowMode === 'customLookback') {
    return {
      windowMode: config.windowMode,
      lookbackValue: normalizeLookbackValue(config.lookbackValue),
      lookbackUnit: normalizeLookbackUnit(config.lookbackUnit),
    };
  }
  if (config.dateRange === '7days') return { windowMode: 'customLookback' as const, lookbackValue: 7, lookbackUnit: 'days' as const };
  if (config.dateRange === '30days') return { windowMode: 'customLookback' as const, lookbackValue: 30, lookbackUnit: 'days' as const };
  return { windowMode: 'last24h' as const, lookbackValue: 2, lookbackUnit: 'hours' as const };
}

function normalizeConfigForUi(config: Partial<ReportConfig> = {}): ReportConfig {
  const window = migrateLegacyWindow(config);
  return {
    ...DEFAULT_CONFIG,
    ...config,
    ...window,
    search: String(config.search || ''),
    site: String(config.site || ''),
    siteKeys: Array.isArray(config.siteKeys) ? config.siteKeys : [],
    eventType: String(config.eventType || ''),
    view: config.view === 'trends' ? 'trends' : 'events',
    reportType: config.reportType || DEFAULT_CONFIG.reportType,
    tripGroupBy: config.tripGroupBy === 'driver' ? 'driver' : 'asset',
    format: config.format || DEFAULT_CONFIG.format,
  };
}

function reportingWindowLabel(config: ReportConfig) {
  if (config.windowMode === 'last24h') return 'Last 24 hours';
  const value = normalizeLookbackValue(config.lookbackValue);
  const unit = normalizeLookbackUnit(config.lookbackUnit);
  const singular = value === 1 ? unit.replace(/s$/, '') : unit;
  return `Last ${value} ${singular}`;
}

function buildReportTitle(config: ReportConfig, siteLabel = config.site || 'All sites') {
  const pieces = [
    reportTypeLabel(config.reportType),
    reportingWindowLabel(config),
    siteLabel,
    config.eventType || 'All event types',
    config.reportType === 'events' ? (config.view === 'trends' ? 'Trends graph' : 'Events table') : '',
    formatLabel(config.format),
  ].filter(Boolean);
  return pieces.join(' · ');
}

function automationSummary(a: Automation) {
  const cfg = a.reportConfig;
  const title = a.title || (cfg ? buildReportTitle(cfg, cfg.site || 'All sites') : a.packs.join(', '));
  return `${title} | ${a.frequency} | next ${fmtWhen(a.nextSendAt)}`;
}

async function automateFetch(url: string, options: RequestInit = {}) {
  return fetch(url, authFetchInit({
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  }));
}

export default function ReportAutomate({
  embedded = false,
  defaultOpen = false,
  defaultFrequency = 'weekly',
  defaultPacks = [],
}: ReportAutomateProps = {}) {
  const { user } = useAuth();
  const { siteOptions, siteNameOptions } = useFleet();
  const [open, setOpen] = useState(defaultOpen || embedded);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [selectedAutomationId, setSelectedAutomationId] = useState('');
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [defaultRecipient, setDefaultRecipient] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [config, setConfig] = useState<ReportConfig>(() => {
    if (defaultPacks.includes('offline_2h')) {
      return normalizeConfigForUi({ reportType: 'events', windowMode: 'customLookback', lookbackValue: 2, lookbackUnit: 'hours', eventType: '', format: 'pdf' });
    }
    return normalizeConfigForUi(DEFAULT_CONFIG);
  });
  const [frequency, setFrequency] = useState<Frequency>(defaultFrequency);
  const [recipients, setRecipients] = useState('');
  const [sendHour, setSendHour] = useState(7);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [monthlyPeriodMode, setMonthlyPeriodMode] = useState<MonthlyPeriodMode>('end');
  const [dayOfMonth, setDayOfMonth] = useState(0);

  const selectedSiteLabel = useMemo(
    () => selectedSiteScopeLabel(config.siteKeys, siteOptions, siteNameOptions, 'All sites') ?? 'All sites',
    [config.siteKeys, siteOptions, siteNameOptions],
  );
  const reportTitle = useMemo(() => buildReportTitle(config, selectedSiteLabel), [config, selectedSiteLabel]);
  const selectedAutomation = automations.find(a => a.id === selectedAutomationId) || null;

  const setConfigValue = <K extends keyof ReportConfig>(key: K, value: ReportConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const setConfigSiteKeys = (siteKeys: string[]) => {
    const nextLabel = selectedSiteScopeLabel(siteKeys, siteOptions, siteNameOptions, 'All sites') ?? 'All sites';
    setConfig(prev => ({ ...prev, siteKeys, site: siteKeys.length ? nextLabel : '' }));
  };

  const toggleConfigSite = (site: string) => {
    setConfig(prev => {
      const siteKeys = prev.siteKeys.includes(site)
        ? prev.siteKeys.filter(s => s !== site)
        : [...prev.siteKeys, site];
      const nextLabel = selectedSiteScopeLabel(siteKeys, siteOptions, siteNameOptions, 'All sites') ?? 'All sites';
      return { ...prev, siteKeys, site: siteKeys.length ? nextLabel : '' };
    });
  };

  const chooseMonthlyPeriod = (mode: MonthlyPeriodMode) => {
    setMonthlyPeriodMode(mode);
    if (mode === 'beginning') setDayOfMonth(1);
    else if (mode === 'end') setDayOfMonth(0);
    else setDayOfMonth(prev => (prev === 0 ? 15 : prev));
  };

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
      setEmailConfigured(!!data.emailConfigured);
      const fallback = data.defaultRecipient || user?.email || '';
      setDefaultRecipient(fallback);
      setRecipients(prev => prev || fallback);
      if (embedded || (data.automations || []).length > 0) setOpen(true);
    } catch (e: any) {
      setError(e?.message || 'Could not load Automate');
    } finally {
      setLoading(false);
    }
  }, [embedded, user?.email]);

  useEffect(() => { void load(); }, [load]);

  const loadAutomationForEdit = (id: string) => {
    setSelectedAutomationId(id);
    const a = automations.find(item => item.id === id);
    if (!a) return;
    if (a.reportConfig) setConfig(normalizeConfigForUi({ ...a.reportConfig, format: a.format || a.reportConfig.format || 'csv' }));
    setFrequency(a.frequency);
    setRecipients(a.recipients.join(', '));
    setSendHour(a.sendHour ?? 7);
    setDayOfWeek(a.dayOfWeek ?? 1);
    setDayOfMonth(a.dayOfMonth ?? 0);
    setMonthlyPeriodMode(a.dayOfMonth === 0 ? 'end' : a.dayOfMonth === 1 ? 'beginning' : 'custom');
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    const payload = {
      title: reportTitle,
      frequency,
      reportConfig: { ...config, format: config.format },
      format: config.format,
      recipients: recipients.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean),
      sendHour,
      dayOfWeek,
      dayOfMonth,
      timezone: 'Africa/Lagos',
    };
    try {
      const res = await automateFetch(
        selectedAutomationId ? `/api/reports/automate/${selectedAutomationId}` : '/api/reports/automate',
        {
          method: selectedAutomationId ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      if (selectedAutomationId) {
        setAutomations(prev => prev.map(a => (a.id === selectedAutomationId ? data.automation : a)));
      } else {
        setAutomations(prev => [data.automation, ...prev]);
        setSelectedAutomationId(data.automation.id);
      }
      setMessage('Automation profile saved and filed in Documents.');
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
    if (selectedAutomationId === id) setSelectedAutomationId('');
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
      if (data.automation) setAutomations(prev => prev.map(a => (a.id === id ? data.automation : a)));
      setMessage('Test report sent.');
    } catch (e: any) {
      setError(e?.message || 'Send failed');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className={`bpl-automate${embedded ? ' bpl-automate--embedded' : ''}`}>
      {!embedded && (
        <button type="button" className="bpl-automate-check" onClick={() => setOpen(v => !v)}>
          <span className="bpl-automate-check-copy">
            <strong>Automate</strong>
            <em>Save report profiles and schedule delivery</em>
          </span>
        </button>
      )}

      {open && (
        <div className="bpl-automate-panel">
          {!emailConfigured && (
            <div className="bpl-automate-banner warn">
              Resend is not configured on this server yet. Schedules can still be saved; sends will wait for an API key.
            </div>
          )}

          {loading ? (
            <div className="bpl-automate-quiet"><Loader2 size={14} className="bpl-automate-spin" /> Loading automations...</div>
          ) : (
            <>
              <div className="bpl-automate-hero">
                <Mail size={16} strokeWidth={1.75} />
                <div>
                  <div className="bpl-automate-hero-title">{reportTitle}</div>
                  <div className="bpl-automate-hero-sub">
                    Pick the exact report details first. The saved profile is filed in Documents and used by the schedule.
                  </div>
                </div>
              </div>

              <div className="bpl-automate-section">
                <div className="bpl-automate-label">Report type</div>
                <div className="bpl-automate-packs">
                  {REPORT_TYPE_OPTIONS.map(opt => {
                    const on = config.reportType === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`bpl-automate-pack${on ? ' on' : ''}`}
                        onClick={() => setConfigValue('reportType', opt.id)}
                      >
                        <span>
                          <strong>{opt.label}</strong>
                          <em>{opt.hint}</em>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bpl-automate-section">
                <div className="bpl-automate-label">Reporting window</div>
                <div className="bpl-automate-seg">
                  {([
                    ['last24h', 'Last 24 hours'],
                    ['customLookback', 'Custom lookback'],
                  ] as const).map(([key, label]) => (
                    <button key={key} type="button" className={config.windowMode === key ? 'on' : ''} onClick={() => setConfigValue('windowMode', key)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="bpl-automate-hint">This controls the data window every time the automation runs. Cadence only controls when it sends.</div>
              </div>

              {config.windowMode === 'customLookback' && (
                <div className="bpl-automate-row">
                  <div className="bpl-automate-section" style={{ flex: 1 }}>
                    <div className="bpl-automate-label">Look back</div>
                    <input
                      className="bpl-automate-input"
                      type="number"
                      min={1}
                      max={365}
                      value={config.lookbackValue}
                      onChange={e => setConfigValue('lookbackValue', normalizeLookbackValue(e.target.value))}
                    />
                  </div>
                  <div className="bpl-automate-section" style={{ flex: 1 }}>
                    <div className="bpl-automate-label">Unit</div>
                    <select className="bpl-automate-input" value={config.lookbackUnit} onChange={e => setConfigValue('lookbackUnit', normalizeLookbackUnit(e.target.value))}>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                      <option value="weeks">Weeks</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="bpl-automate-section">
                <div className="bpl-automate-label">Search</div>
                <input className="bpl-automate-input" value={config.search} onChange={e => setConfigValue('search', e.target.value)} placeholder="Driver, asset, transporter, address..." />
              </div>

              <div className="bpl-automate-row">
                <div className="bpl-automate-section" style={{ flex: 1 }}>
                  <SiteScopeDropdown
                    label="Site"
                    variant="field"
                    selectedSites={config.siteKeys}
                    setSelectedSites={setConfigSiteKeys}
                    toggleSite={toggleConfigSite}
                    siteOptions={siteOptions}
                    siteNameOptions={siteNameOptions}
                  />
                </div>
                <div className="bpl-automate-section" style={{ flex: 1 }}>
                  <div className="bpl-automate-label">Event type</div>
                  <select className="bpl-automate-input" value={config.eventType} onChange={e => setConfigValue('eventType', e.target.value)}>
                    <option value="">All event types</option>
                    {EVENT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
              </div>

              <div className="bpl-automate-section">
                <div className="bpl-automate-label">View</div>
                <div className="bpl-automate-seg">
                  <button type="button" className={config.view === 'events' ? 'on' : ''} onClick={() => setConfigValue('view', 'events')}>Events table</button>
                  <button type="button" className={config.view === 'trends' ? 'on' : ''} onClick={() => setConfigValue('view', 'trends')}>Trends graph</button>
                </div>
              </div>

              {config.reportType === 'trips' && (
                <div className="bpl-automate-section">
                  <div className="bpl-automate-label">Trip report grouping</div>
                  <div className="bpl-automate-seg">
                    <button type="button" className={config.tripGroupBy === 'asset' ? 'on' : ''} onClick={() => setConfigValue('tripGroupBy', 'asset')}>By asset</button>
                    <button type="button" className={config.tripGroupBy === 'driver' ? 'on' : ''} onClick={() => setConfigValue('tripGroupBy', 'driver')}>By driver</button>
                  </div>
                </div>
              )}

              <div className="bpl-automate-section">
                <div className="bpl-automate-label">Format</div>
                <div className="bpl-automate-seg">
                  {(['csv', 'excel', 'pdf'] as const).map(f => (
                    <button key={f} type="button" className={config.format === f ? 'on' : ''} onClick={() => setConfigValue('format', f)}>
                      {formatLabel(f)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bpl-automate-section">
                <div className="bpl-automate-label">Cadence</div>
                <div className="bpl-automate-seg">
                  {(['hourly', 'daily', 'weekly', 'monthly'] as const).map(key => (
                    <button key={key} type="button" className={frequency === key ? 'on' : ''} onClick={() => setFrequency(key)}>
                      {key[0].toUpperCase() + key.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {frequency === 'weekly' && (
                <div className="bpl-automate-section">
                  <div className="bpl-automate-label">Day</div>
                  <div className="bpl-automate-seg bpl-automate-seg--wrap">
                    {WEEKDAYS.map(d => (
                      <button key={d.v} type="button" className={dayOfWeek === d.v ? 'on' : ''} onClick={() => setDayOfWeek(d.v)}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {frequency === 'monthly' && (
                <div className="bpl-automate-section">
                  <div className="bpl-automate-label">Monthly window</div>
                  <div className="bpl-automate-seg bpl-automate-seg--wrap">
                    {([
                      ['beginning', 'Beginning'],
                      ['end', 'End'],
                      ['custom', 'Custom day'],
                    ] as const).map(([key, label]) => (
                      <button key={key} type="button" className={monthlyPeriodMode === key ? 'on' : ''} onClick={() => chooseMonthlyPeriod(key)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {monthlyPeriodMode === 'custom' && (
                    <input className="bpl-automate-input" type="number" min={1} max={28} value={dayOfMonth} onChange={e => setDayOfMonth(Number(e.target.value) || 1)} />
                  )}
                </div>
              )}

              {frequency !== 'hourly' && (
                <div className="bpl-automate-section">
                  <div className="bpl-automate-label">Send hour (Lagos)</div>
                  <select className="bpl-automate-input" value={sendHour} onChange={e => setSendHour(Number(e.target.value))}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="bpl-automate-section">
                <div className="bpl-automate-label">Recipients</div>
                <input className="bpl-automate-input" placeholder={defaultRecipient || 'you@company.com'} value={recipients} onChange={e => setRecipients(e.target.value)} />
                <div className="bpl-automate-hint">Comma-separated. Defaults to your account email.</div>
              </div>

              <button type="button" className="bpl-automate-primary" disabled={saving} onClick={() => void save()}>
                <Save size={14} />
                {saving ? 'Saving...' : selectedAutomationId ? 'Update automation' : 'Save automation'}
              </button>

              <div className="bpl-automate-saved-bar">
                <div>
                  <div className="bpl-automate-label">Saved automations</div>
                  <select className="bpl-automate-input" value={selectedAutomationId} onChange={e => loadAutomationForEdit(e.target.value)}>
                    <option value="">Create new automation</option>
                    {automations.map(a => <option key={a.id} value={a.id}>{automationSummary(a)}</option>)}
                  </select>
                </div>
                {selectedAutomation && (
                  <div className="bpl-automate-saved-actions">
                    <button type="button" onClick={() => void patch(selectedAutomation.id, { enabled: !selectedAutomation.enabled }).catch(e => setError(e.message))}>
                      {selectedAutomation.enabled ? <Pause size={13} /> : <Play size={13} />}
                      {selectedAutomation.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button type="button" disabled={sendingId === selectedAutomation.id || !emailConfigured} onClick={() => void sendTest(selectedAutomation.id)}>
                      {sendingId === selectedAutomation.id ? <Loader2 size={13} className="bpl-automate-spin" /> : <Send size={13} />}
                      Test
                    </button>
                    <button type="button" onClick={() => void remove(selectedAutomation.id)}>
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                )}
              </div>

              {message && <div className="bpl-automate-banner ok">{message}</div>}
              {error && <div className="bpl-automate-banner warn">{error}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
