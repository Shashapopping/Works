import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, Pause, Play, Save, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useFleet } from '../context/FleetContext';
import { authFetchInit } from '../lib/authApi';
import { REPORT_TYPE_OPTIONS, reportTypeLabel, type ReportType } from '../lib/reportTypes';
import { reportSearchPlaceholder } from '../lib/reports/reportSearch';
import {
  countConnectivityFromGps,
  isConnectivityEventType,
  NO_RECENT_COMMUNICATION,
  normalizeConnectivityEventType,
} from '../lib/reports/connectivityCounts';
import { buildCadenceScheduleSummary } from '../lib/reports/automationSchedule';
import {
  buildEventTypeCounts,
  formatEventTypeOptionLabel,
  REPORT_EVENT_TYPE_CATALOG,
  reportEventTypeDef,
} from '../lib/reports/eventTypeCatalog';
import {
  TRACKING_WINDOW_HELPER,
  trackingWindowFilterHint,
  trackingWindowLabel,
  trackingWindowTitleLabel,
  trackingWindowHours,
} from '../lib/reports/trackingWindow';
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
  nightBatch?: boolean;
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
  pendingTriggerCount?: number;
}

interface ReportAutomateProps {
  embedded?: boolean;
  defaultOpen?: boolean;
  defaultFrequency?: Frequency;
  defaultPacks?: string[];
}

const EVENT_TYPES = REPORT_EVENT_TYPE_CATALOG.map(o => o.id);
const NO_RECENT_COMMUNICATION_DISPLAY_LABEL = 'No recent communication (2 hrs)';

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
  nightBatch: false,
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
  const eventType = normalizeConnectivityEventType(String(config.eventType || ''));
  const fixedNoRecentWindow = eventType === NO_RECENT_COMMUNICATION
    ? { windowMode: 'customLookback' as const, lookbackValue: 2, lookbackUnit: 'hours' as const }
    : window;
  return {
    ...DEFAULT_CONFIG,
    ...config,
    ...fixedNoRecentWindow,
    search: String(config.search || ''),
    site: String(config.site || ''),
    siteKeys: Array.isArray(config.siteKeys) ? config.siteKeys : [],
    eventType,
    view: config.view === 'trends' ? 'trends' : 'events',
    reportType: config.reportType || DEFAULT_CONFIG.reportType,
    tripGroupBy: config.tripGroupBy === 'driver' ? 'driver' : 'asset',
    format: config.format || DEFAULT_CONFIG.format,
    nightBatch: !!config.nightBatch,
  };
}

function reportingWindowLabel(config: ReportConfig) {
  return trackingWindowTitleLabel(config);
}

function buildReportTitle(config: ReportConfig, siteLabel = config.site || 'All sites') {
  const eventLabel = config.eventType === NO_RECENT_COMMUNICATION
    ? NO_RECENT_COMMUNICATION_DISPLAY_LABEL
    : config.eventType || 'All event types';
  const pieces = [
    reportTypeLabel(config.reportType),
    reportingWindowLabel(config),
    siteLabel,
    eventLabel,
    config.reportType === 'events' ? (config.view === 'trends' ? 'Trends graph' : 'Events table') : '',
    formatLabel(config.format),
  ].filter(Boolean);
  return pieces.join(' · ');
}

function automationSummary(a: Automation) {
  const cfg = a.reportConfig;
  const title = a.title || (cfg ? buildReportTitle(cfg, cfg.site || 'All sites') : a.packs.join(', '));
  const pending = cfg?.eventType === NO_RECENT_COMMUNICATION ? ` | ${a.pendingTriggerCount || 0} pending` : '';
  return `${title} | ${a.frequency}${pending} | next ${fmtWhen(a.nextSendAt)}`;
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
  const { siteOptions, siteNameOptions, vehicles, events: fleetEvents } = useFleet();
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
      return normalizeConfigForUi({ reportType: 'events', windowMode: 'customLookback', lookbackValue: 2, lookbackUnit: 'hours', eventType: NO_RECENT_COMMUNICATION, format: 'pdf' });
    }
    return normalizeConfigForUi(DEFAULT_CONFIG);
  });
  const [frequency, setFrequency] = useState<Frequency>(defaultFrequency);
  const [recipients, setRecipients] = useState('');
  const [sendHour, setSendHour] = useState(7);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [monthlyPeriodMode, setMonthlyPeriodMode] = useState<MonthlyPeriodMode>('end');
  const [dayOfMonth, setDayOfMonth] = useState(0);
  const [nightBatch, setNightBatch] = useState(false);
  const [scheduleTick, setScheduleTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setScheduleTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const selectedSiteLabel = useMemo(
    () => selectedSiteScopeLabel(config.siteKeys, siteOptions, siteNameOptions, 'All sites') ?? 'All sites',
    [config.siteKeys, siteOptions, siteNameOptions],
  );
  const reportTitle = useMemo(() => buildReportTitle(config, selectedSiteLabel), [config, selectedSiteLabel]);
  const selectedAutomation = automations.find(a => a.id === selectedAutomationId) || null;

  const trackingWindowHoursValue = useMemo(
    () => trackingWindowHours(config),
    [config.windowMode, config.lookbackValue, config.lookbackUnit],
  );

  const eventTypeCounts = useMemo(() => {
    const ivms: Record<string, number> = {};
    for (const e of fleetEvents) {
      const label = e.label?.trim();
      if (!label) continue;
      ivms[label] = (ivms[label] || 0) + 1;
    }
    return buildEventTypeCounts(ivms, vehicles, trackingWindowHoursValue);
  }, [fleetEvents, vehicles, trackingWindowHoursValue]);

  const connectivityAssetCount = useMemo(() => {
    if (!isConnectivityEventType(config.eventType)) return null;
    return countConnectivityFromGps(vehicles, config.eventType, trackingWindowHoursValue);
  }, [config.eventType, vehicles, trackingWindowHoursValue]);

  const cadenceSummary = useMemo(() => {
    void scheduleTick;
    const isNoRecent = config.eventType === NO_RECENT_COMMUNICATION;
    const eventLabel = isNoRecent ? NO_RECENT_COMMUNICATION_DISPLAY_LABEL : config.eventType || 'All event types';
    const base = buildCadenceScheduleSummary({
      frequency,
      sendHour,
      dayOfWeek,
      dayOfMonth,
      nightBatch: frequency === 'hourly' ? nightBatch : false,
      eventLabel,
      trackingWindowPhrase: trackingWindowLabel(config),
      reportTypeLabel: reportTypeLabel(config.reportType),
      assetCount: connectivityAssetCount,
    });
    if (!isNoRecent) return base;
    return `${NO_RECENT_COMMUNICATION_DISPLAY_LABEL} is stored once when a vehicle reaches 2 hours without GPS. New arrivals are sent hourly.`;
  }, [
    scheduleTick,
    frequency,
    sendHour,
    dayOfWeek,
    dayOfMonth,
    config,
    connectivityAssetCount,
    nightBatch,
    trackingWindowHoursValue,
  ]);

  const setConfigValue = <K extends keyof ReportConfig>(key: K, value: ReportConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const setEventType = (eventType: string) => {
    const normalized = normalizeConnectivityEventType(eventType);
    setConfig(prev => {
      if (normalized !== NO_RECENT_COMMUNICATION) return { ...prev, eventType: normalized };
      return {
        ...prev,
        eventType: normalized,
        reportType: 'events',
        view: 'events',
        windowMode: 'customLookback',
        lookbackValue: 2,
        lookbackUnit: 'hours',
      };
    });
    if (normalized === NO_RECENT_COMMUNICATION) {
      setFrequency('hourly');
      setNightBatch(false);
    }
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
    if (a.reportConfig) {
      const normalized = normalizeConfigForUi({ ...a.reportConfig, format: a.format || a.reportConfig.format || 'csv' });
      setConfig(normalized);
      setNightBatch(a.frequency === 'hourly' && !!normalized.nightBatch);
    }
    setFrequency(a.frequency);
    setRecipients(a.recipients.join(', '));
    setSendHour(a.sendHour ?? 7);
    setDayOfWeek(a.dayOfWeek ?? 1);
    setDayOfMonth(a.dayOfMonth ?? 0);
    setMonthlyPeriodMode(a.dayOfMonth === 0 ? 'end' : a.dayOfMonth === 1 ? 'beginning' : 'custom');
  };

  useEffect(() => {
    if (!embedded || selectedAutomationId || automations.length !== 1) return;
    loadAutomationForEdit(automations[0].id);
  }, [embedded, automations, selectedAutomationId]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    const recipientList = recipients.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    const isNoRecent = config.eventType === NO_RECENT_COMMUNICATION;
    const effectiveFrequency = isNoRecent ? 'hourly' : frequency;
    const effectiveConfig = isNoRecent
      ? {
        ...config,
        reportType: 'events' as const,
        view: 'events' as const,
        windowMode: 'customLookback' as const,
        lookbackValue: 2,
        lookbackUnit: 'hours' as const,
        eventType: NO_RECENT_COMMUNICATION,
        format: config.format,
        nightBatch: false,
      }
      : { ...config, format: config.format, nightBatch: frequency === 'hourly' ? nightBatch : false };
    const payload = {
      title: isNoRecent ? NO_RECENT_COMMUNICATION_DISPLAY_LABEL : reportTitle,
      frequency: effectiveFrequency,
      reportConfig: effectiveConfig,
      format: config.format,
      recipients: recipientList,
      sendHour,
      dayOfWeek,
      dayOfMonth,
      timezone: 'Africa/Lagos',
    };
    const existingId = selectedAutomationId
      || automations.find(a => a.title === reportTitle)?.id
      || '';
    try {
      const res = await automateFetch(
        existingId ? `/api/reports/automate/${existingId}` : '/api/reports/automate',
        {
          method: existingId ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      if (existingId) {
        setAutomations(prev => prev.map(a => (a.id === existingId ? data.automation : a)));
        setSelectedAutomationId(existingId);
      } else {
        setAutomations(prev => [data.automation, ...prev]);
        setSelectedAutomationId(data.automation.id);
      }
      if (data.automation?.recipients?.length) {
        setRecipients(data.automation.recipients.join(', '));
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
      const recipientList = recipients.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
      const saved = automations.find(a => a.id === id);
      const savedRecipients = (saved?.recipients || []).map(r => r.toLowerCase()).sort().join(',');
      const pendingRecipients = recipientList.map(r => r.toLowerCase()).sort().join(',');
      if (recipientList.length > 0 && pendingRecipients !== savedRecipients) {
        await patch(id, { recipients: recipientList });
      }
      const res = await automateFetch(`/api/reports/automate/${id}/send`, {
        method: 'POST',
        body: JSON.stringify({ test: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.sent) throw new Error(data.error || 'Send failed');
      if (data.automation) setAutomations(prev => prev.map(a => (a.id === id ? data.automation : a)));
      const rowNote = data.rowCount != null ? ` (${data.rowCount.toLocaleString()} rows)` : '';
      setMessage(`Test report sent${rowNote}. Check your inbox and spam folder.`);
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
                <div className="bpl-automate-label">Tracking window</div>
                {config.eventType === NO_RECENT_COMMUNICATION ? (
                  <div className="bpl-automate-schedule-preview" role="status">
                    {NO_RECENT_COMMUNICATION_DISPLAY_LABEL} uses a fixed 2-hour GPS silence trigger.
                  </div>
                ) : (
                  <>
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
                <div className="bpl-automate-hint">{TRACKING_WINDOW_HELPER}</div>
                <div className="bpl-automate-hint">{trackingWindowFilterHint(config.reportType)}</div>
                  </>
                )}
              </div>

              {config.eventType !== NO_RECENT_COMMUNICATION && config.windowMode === 'customLookback' && (
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
                <input className="bpl-automate-input" value={config.search} onChange={e => setConfigValue('search', e.target.value)} placeholder={reportSearchPlaceholder(config.reportType)} />
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
                  <select className="bpl-automate-input" value={config.eventType} onChange={e => setEventType(e.target.value)}>
                    <option value="">All event types — IVMS and connectivity</option>
                    <optgroup label="IVMS events">
                      {REPORT_EVENT_TYPE_CATALOG.filter(d => d.group === 'ivms').map(def => (
                        <option key={def.id} value={def.id}>
                          {formatEventTypeOptionLabel(def.id, eventTypeCounts[def.id])}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Connectivity events">
                      {REPORT_EVENT_TYPE_CATALOG.filter(d => d.group === 'connectivity').map(def => (
                        <option key={def.id} value={def.id}>
                          {formatEventTypeOptionLabel(def.id, eventTypeCounts[def.id])}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  {config.eventType && reportEventTypeDef(config.eventType)?.hint && (
                    <div className="bpl-automate-hint">
                      {reportEventTypeDef(config.eventType)!.hint}
                      {config.eventType === 'Offline' && (
                        <> Repeat offenders are assets still offline since the previous send.</>
                      )}
                      {eventTypeCounts[config.eventType] != null && (
                        <> · <strong>{eventTypeCounts[config.eventType].toLocaleString()}</strong> in feed now</>
                      )}
                    </div>
                  )}
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
                {config.eventType === NO_RECENT_COMMUNICATION ? (
                  <div className="bpl-automate-schedule-preview" role="status">
                    Hourly. New {NO_RECENT_COMMUNICATION_DISPLAY_LABEL} arrivals are emailed on the next hourly run.
                  </div>
                ) : (
                  <div className="bpl-automate-seg">
                  {(['hourly', 'daily', 'weekly', 'monthly'] as const).map(key => (
                    <button
                      key={key}
                      type="button"
                      className={frequency === key ? 'on' : ''}
                      onClick={() => {
                        setFrequency(key);
                        if (key !== 'hourly') setNightBatch(false);
                      }}
                    >
                      {key[0].toUpperCase() + key.slice(1)}
                    </button>
                  ))}
                  </div>
                )}
              </div>

              {config.eventType !== NO_RECENT_COMMUNICATION && frequency === 'weekly' && (
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

              {config.eventType !== NO_RECENT_COMMUNICATION && frequency === 'monthly' && (
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

              {config.eventType !== NO_RECENT_COMMUNICATION && frequency !== 'hourly' && (
                <div className="bpl-automate-section">
                  <div className="bpl-automate-label">Send hour (Lagos)</div>
                  <select className="bpl-automate-input" value={sendHour} onChange={e => setSendHour(Number(e.target.value))}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </div>
              )}

              {config.eventType !== NO_RECENT_COMMUNICATION && frequency === 'hourly' && (
                <label className="bpl-automate-night-batch">
                  <input
                    type="checkbox"
                    checked={nightBatch}
                    onChange={e => setNightBatch(e.target.checked)}
                  />
                  <span className="bpl-automate-night-batch-copy">
                    <strong>Batch night window to 6:00 AM</strong>
                    <em>
                      Hourly runs between 7:00 PM and 6:00 AM Lagos are held and delivered together at 6:00 AM.
                    </em>
                  </span>
                </label>
              )}

              <div className="bpl-automate-section">
                <div className="bpl-automate-schedule-preview" role="status">
                  {cadenceSummary}
                </div>
                {selectedAutomation?.nextSendAt && (
                  <div className="bpl-automate-hint">
                    Saved schedule next send: {fmtWhen(selectedAutomation.nextSendAt)} (server).
                  </div>
                )}
                {selectedAutomation?.reportConfig?.eventType === NO_RECENT_COMMUNICATION && (
                  <div className="bpl-automate-pending">
                    <strong>{(selectedAutomation.pendingTriggerCount || 0).toLocaleString()}</strong>
                    <span>pending trigger{selectedAutomation.pendingTriggerCount === 1 ? '' : 's'} queued for the next send</span>
                  </div>
                )}
              </div>

              <div className="bpl-automate-section">
                <div className="bpl-automate-label">Recipients</div>
                <input className="bpl-automate-input" placeholder={defaultRecipient || 'you@company.com'} value={recipients} onChange={e => setRecipients(e.target.value)} />
                <div className="bpl-automate-hint">Comma-separated. Defaults to your account email. Scheduled and test sends use saved recipients — update automation after changing this field.</div>
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
