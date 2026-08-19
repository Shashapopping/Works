import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, FileBarChart2, Mail, Search } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import FeatureGate from '../components/FeatureGate';
import ReportAutomate from '../components/ReportAutomate';
import { SkelTable, DataRegion } from '../components/data/DataBusy';
import { useAuth } from '../context/AuthContext';
import { authFetch, useFleet } from '../context/FleetContext';
import {
  buildTabularReportBlob,
  exportTabularReport,
  type ExportFormat,
  type LogEntry,
} from '../lib/reportExport';
import {
  isReportExportAllowed,
  normalizeReportEmail,
  REPORT_EXPORT_ALLOWED_DOMAINS,
} from '../lib/reportExportAllowlist';
import {
  REPORT_TYPE_OPTIONS,
  reportTypeLabel,
  type ReportType,
  type TabularReport,
} from '../lib/reportTypes';
import { generateTabularReport } from '../lib/reports/generateTabularReport';
import type { TripReportGroupBy } from '../lib/reports/buildTripReport';
import { displayDriverName, isKnownDriver } from '../lib/driverUtils';
import { reportTitle as brandReportTitle } from '../lib/branding';
import { authFetchInit } from '../lib/authApi';

interface TrendDay {
  date: string;
  'Harsh Braking': number;
  'Harsh Acceleration': number;
  Overspeeding: number;
  'Overspeed Tiered': number;
  'Harsh Cornering': number;
  Total: number;
}

type DateRange = 'today' | '7days' | '30days' | 'custom';
type ViewMode = 'events' | 'trends';

const EVENT_TYPES = [
  'Harsh Braking',
  'Harsh Acceleration',
  'Overspeeding',
  'Overspeed Tiered',
  'Harsh Cornering',
] as const;

const HIDDEN_LABELS = [
  'Possible Power Tamper',
  'Battery Disconnection',
  'Battery Disconnected',
  'Front Panel Tamper',
  'Back Panel Tamper',
  'No Blue Key',
];

const EVENT_COLORS: Record<string, string> = {
  Total: '#0f172a',
  'Harsh Braking': '#0d9488',
  'Harsh Acceleration': '#2563eb',
  Overspeeding: '#9333ea',
  'Overspeed Tiered': '#ea580c',
  'Harsh Cornering': '#16a34a',
};

/** Preview table only — full filtered set still used for download/email. */
const EVENT_PREVIEW_LIMIT = 20;
const EVENTS_REFRESH_MS = 30_000;

function getDateBounds(
  dateRange: DateRange,
  fromDate: string,
  toDate: string,
): { from: string | null; to: string | null } {
  const now = new Date();
  if (dateRange === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
  }
  if (dateRange === '7days') {
    return { from: new Date(now.getTime() - 7 * 86400000).toISOString(), to: now.toISOString() };
  }
  if (dateRange === '30days') {
    return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), to: now.toISOString() };
  }
  if (dateRange === 'custom' && fromDate && toDate) {
    return {
      from: new Date(fromDate).toISOString(),
      to: new Date(new Date(toDate).getTime() + 86400000).toISOString(),
    };
  }
  return { from: '2020-01-01T00:00:00.000Z', to: now.toISOString() };
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function eventLabel(entry: LogEntry) {
  return entry.label || 'Unknown';
}

function matchesEventType(entry: LogEntry, selected: Set<string>) {
  if (selected.size === 0) return false;
  return selected.has(eventLabel(entry));
}

function TrendTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { payload: TrendDay }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  return (
    <div className="bpl-reports-chart-tooltip">
      <div className="bpl-reports-chart-tooltip-title">{label}</div>
      {Object.entries(EVENT_COLORS).map(([key, color]) => {
        const val = data[key as keyof TrendDay];
        if (val === undefined) return null;
        return (
          <div key={key} className="bpl-reports-chart-tooltip-row">
            <span className="bpl-reports-chart-tooltip-label">
              <span className="bpl-reports-chart-dot" style={{ background: color }} />
              {key}
            </span>
            <strong>{val}</strong>
          </div>
        );
      })}
    </div>
  );
}

function mapDemoEntries(
  events: ReturnType<typeof useFleet>['events'],
  vehicles: ReturnType<typeof useFleet>['vehicles'],
): LogEntry[] {
  return events.map(e => {
    const vehicle = vehicles.find(v => v.id === e.assetId || v.regNo === e.regNo);
    return {
      eventId: e.eventId,
      label: e.label,
      type: e.type === 'panic' ? 'panic' : 'warning',
      timestamp: e.eventTime,
      eventTime: e.eventTime,
      assetId: e.assetId || e.regNo || 'unknown',
      regNo: e.regNo,
      assetName: vehicle?.assetName,
      site: vehicle?.site,
      transporter: vehicle?.transporter,
      driverName: e.driverName || vehicle?.driverName,
      driverPhone: e.driverPhone || vehicle?.driverPhone,
      address: e.address || vehicle?.address,
    };
  });
}

function mapApiEntry(e: Record<string, unknown>, vehicles: ReturnType<typeof useFleet>['vehicles']): LogEntry {
  const vehicle = vehicles.find(
    v => v.id === String(e.assetId ?? '') || v.regNo === String(e.regNo ?? ''),
  );
  return {
    eventId: String(e.eventId ?? e.id ?? `${e.regNo}-${e.eventTime}`),
    label: e.label != null ? String(e.label) : undefined,
    type: e.type === 'panic' ? 'panic' : 'warning',
    timestamp: String(e.timestamp ?? e.eventTime ?? new Date().toISOString()),
    eventTime: String(e.eventTime ?? e.timestamp ?? new Date().toISOString()),
    assetId: String(e.assetId ?? e.regNo ?? 'unknown'),
    driverId: e.driverId != null ? String(e.driverId) : undefined,
    regNo: e.regNo != null ? String(e.regNo) : undefined,
    assetName: e.assetName != null ? String(e.assetName) : vehicle?.assetName,
    site: e.site != null ? String(e.site) : vehicle?.site,
    transporter: e.transporter != null ? String(e.transporter) : vehicle?.transporter,
    driverName: e.driverName != null ? String(e.driverName) : vehicle?.driverName,
    driverPhone: e.driverPhone != null ? String(e.driverPhone) : vehicle?.driverPhone,
    address: e.address != null ? String(e.address) : vehicle?.address,
  };
}

function FilterCheck({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`bpl-reports-check${checked ? ' active' : ''}`}
      onClick={onToggle}
    >
      <span className="bpl-reports-check-box" aria-hidden>{checked ? '✓' : ''}</span>
      {label}
    </button>
  );
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
  onSelectAll,
  allLabel,
  emptyMeansAll = false,
  emptyLabel = 'None selected',
}: {
  label: string;
  options: readonly string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  onSelectAll: () => void;
  allLabel: string;
  emptyMeansAll?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const allSelected = emptyMeansAll
    ? selected.size === 0
    : selected.size === options.length;

  const summary = useMemo(() => {
    if (emptyMeansAll && selected.size === 0) return allLabel;
    if (!emptyMeansAll && selected.size === 0) return emptyLabel;
    if (!emptyMeansAll && selected.size === options.length) return allLabel;
    if (selected.size === 1) return [...selected][0];
    return `${selected.size} selected`;
  }, [selected, options.length, allLabel, emptyLabel, emptyMeansAll]);

  const isChecked = (value: string) => {
    if (emptyMeansAll) return selected.has(value);
    return selected.has(value);
  };

  return (
    <div className="bpl-reports-ms-dropdown" ref={rootRef}>
      <div className="bpl-field-label">{label}</div>
      <button
        type="button"
        className={`bpl-reports-ms-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
      >
        <span className="bpl-reports-ms-trigger-text">{summary}</span>
        <ChevronDown size={14} className={`bpl-reports-ms-chevron${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="bpl-reports-ms-menu">
          <FilterCheck label="Select all" checked={allSelected} onToggle={onSelectAll} />
          <div className="bpl-reports-ms-scroll">
            {options.map(option => (
              <FilterCheck
                key={option}
                label={option}
                checked={isChecked(option)}
                onToggle={() => onToggle(option)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const { events: fleetEvents, vehicles } = useFleet();
  const vehiclesRef = useRef(vehicles);
  const fleetEventsRef = useRef(fleetEvents);
  vehiclesRef.current = vehicles;
  fleetEventsRef.current = fleetEvents;

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [eventCensusTotal, setEventCensusTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<string>>(
    () => new Set(EVENT_TYPES),
  );
  const [selectedSites, setSelectedSites] = useState<Set<string>>(() => new Set());
  const [dateRange, setDateRange] = useState<DateRange>('7days');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('events');
  const [showTotal, setShowTotal] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [reportType, setReportType] = useState<ReportType>('events');
  const [tripGroupBy, setTripGroupBy] = useState<TripReportGroupBy>('asset');
  const [tabularPreview, setTabularPreview] = useState<TabularReport | null>(null);
  const [tabularPreviewLoading, setTabularPreviewLoading] = useState(false);

  const reportTitle = brandReportTitle();
  const canExport = isReportExportAllowed(user?.email);
  const defaultEmailTo = useMemo(() => {
    const me = normalizeReportEmail(user?.email);
    if (isReportExportAllowed(me)) return me;
    return '';
  }, [user?.email]);

  useEffect(() => {
    setEmailTo(defaultEmailTo);
  }, [defaultEmailTo]);

  useEffect(() => {
    let cancelled = false;

    const load = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const { from, to } = getDateBounds(dateRange, fromDate, toDate);
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        params.set('format', 'page');
        params.set('limit', String(EVENT_PREVIEW_LIMIT));
        if (selectedEventTypes.size > 0 && selectedEventTypes.size < EVENT_TYPES.length) {
          params.set('types', [...selectedEventTypes].join(','));
        }
        const url = `/api/events/log?${params}`;
        const res = await authFetch(url);
        if (cancelled) return;
        const veh = vehiclesRef.current;
        if (res.ok) {
          const data = await res.json();
          const rows = Array.isArray(data) ? data : data?.entries ?? [];
          setEntries(rows.map((e: Record<string, unknown>) => mapApiEntry(e, veh)));
          setEventCensusTotal(typeof data?.total === 'number' ? data.total : rows.length);
        } else {
          const demo = mapDemoEntries(fleetEventsRef.current, veh);
          setEntries(demo);
          setEventCensusTotal(demo.length);
        }
      } catch {
        if (!cancelled) {
          const demo = mapDemoEntries(fleetEventsRef.current, vehiclesRef.current);
          setEntries(demo);
          setEventCensusTotal(demo.length);
        } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    };
    void load(false);
    const interval = setInterval(() => void load(true), EVENTS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dateRange, fromDate, toDate, selectedEventTypes]);

  const siteOptions = useMemo(() => {
    const sites = new Set<string>();
    vehicles.forEach(v => {
      if (v.site && v.site !== 'XN - Decommissioned') sites.add(v.site);
    });
    entries.forEach(e => {
      if (e.site) sites.add(e.site);
    });
    return Array.from(sites).sort((a, b) => a.localeCompare(b));
  }, [vehicles, entries]);

  const earliestDate = useMemo(() => {
    if (entries.length === 0) return new Date();
    let minTs = Infinity;
    for (const e of entries) {
      const t = new Date(e.timestamp).getTime();
      if (t < minTs) minTs = t;
    }
    const d = new Date(Number.isFinite(minTs) ? minTs : Date.now());
    d.setHours(0, 0, 0, 0);
    return d;
  }, [entries]);

  const filtered = useMemo(
    () =>
      entries.filter(e => {
        if (e.type === 'panic') return false;
        const label = eventLabel(e);
        if (HIDDEN_LABELS.includes(label)) return false;
        if (!matchesEventType(e, selectedEventTypes)) return false;
        if (selectedSites.size > 0 && (!e.site || !selectedSites.has(e.site))) return false;
        const q = searchTerm.toLowerCase();
        const matchesSearch =
          searchTerm === '' ||
          (e.regNo && e.regNo !== 'N/A' && e.regNo.toLowerCase().includes(q)) ||
          (e.assetName && e.assetName.toLowerCase().includes(q)) ||
          (e.assetId && e.assetId.toLowerCase().includes(q)) ||
          (isKnownDriver(e.driverName) && e.driverName!.toLowerCase().includes(q)) ||
          (e.driverPhone && e.driverPhone.toLowerCase().includes(q));
        return matchesSearch;
      }),
    [entries, selectedEventTypes, selectedSites, searchTerm],
  );

  const previewRows = useMemo(
    () => filtered.slice(0, EVENT_PREVIEW_LIMIT),
    [filtered],
  );

  const scorecardEvents = useMemo(
    () =>
      entries.filter(e => {
        if (e.type === 'panic') return false;
        const label = eventLabel(e);
        if (HIDDEN_LABELS.includes(label)) return false;
        return true;
      }),
    [entries],
  );

  useEffect(() => {
    if (reportType === 'events') {
      setTabularPreview(null);
      setTabularPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setTabularPreviewLoading(true);
    const { from, to } = getDateBounds(dateRange, fromDate, toDate);
    void (async () => {
      try {
        const tabular = await generateTabularReport({
          reportType,
          baseTitle: reportTitle,
          meta: [
            `Type: ${reportTypeLabel(reportType)}`,
            `Date: ${
              dateRange === 'today' ? 'Today'
                : dateRange === '7days' ? 'Last 7 days'
                  : dateRange === '30days' ? 'Last 30 days'
                    : fromDate && toDate ? `${fromDate} to ${toDate}` : 'Custom'
            }`,
            searchTerm ? `Search: ${searchTerm}` : '',
          ].filter(Boolean).join('  ·  '),
          search: searchTerm,
          events: scorecardEvents,
          fromIso: from,
          toIso: to,
          tripGroupBy,
        });
        if (!cancelled) setTabularPreview(tabular);
      } catch {
        if (!cancelled) setTabularPreview(null);
      } finally {
        if (!cancelled) setTabularPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reportType, dateRange, fromDate, toDate, searchTerm, scorecardEvents, reportTitle, tripGroupBy]);

  const tabularPreviewRows = useMemo(
    () => (tabularPreview?.rows ?? []).slice(0, EVENT_PREVIEW_LIMIT),
    [tabularPreview],
  );

  const trendData = useMemo((): TrendDay[] => {
    const now = new Date();
    let startDate: Date;
    let endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    if (dateRange === 'today') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
    } else if (dateRange === '7days') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
    } else if (dateRange === '30days') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 29);
      startDate.setHours(0, 0, 0, 0);
    } else if (dateRange === 'custom' && fromDate && toDate) {
      startDate = new Date(fromDate);
      endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
    } else {
      startDate = new Date(earliestDate);
    }

    const byDate = new Map<string, TrendDay>();
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const dateKey = cursor.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      byDate.set(dateKey, {
        date: dateKey,
        'Harsh Braking': 0,
        'Harsh Acceleration': 0,
        Overspeeding: 0,
        'Overspeed Tiered': 0,
        'Harsh Cornering': 0,
        Total: 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    filtered.forEach(e => {
      const label = eventLabel(e);
      const date = new Date(e.timestamp).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
      });
      const day = byDate.get(date);
      if (!day) return;
      const key = label as keyof TrendDay;
      if (key !== 'date' && key in day) {
        day[key]++;
      }
      day.Total++;
    });

    return Array.from(byDate.values());
  }, [filtered, dateRange, fromDate, toDate, earliestDate]);

  const summaryStats = useMemo(() => {
    if (trendData.length === 0) return null;
    const total = trendData.reduce((sum, d) => sum + d.Total, 0);
    const avg = Math.round(total / trendData.length);
    const peak = trendData.reduce((max, d) => (d.Total > max.Total ? d : max), trendData[0]);
    const lowest = trendData.reduce((min, d) => (d.Total < min.Total ? d : min), trendData[0]);
    return { total, avg, peak, lowest };
  }, [trendData]);

  const activeLines = useMemo(() => {
    if (showTotal) return ['Total'];
    const types = selectedEventTypes.size === 0
      ? [...EVENT_TYPES]
      : [...selectedEventTypes];
    return types.filter(t => t !== 'Total');
  }, [selectedEventTypes, showTotal]);

  const toggleEventType = (evt: string) => {
    setSelectedEventTypes(prev => {
      const next = new Set(prev);
      if (next.has(evt)) next.delete(evt);
      else next.add(evt);
      return next;
    });
    setShowTotal(false);
  };

  const toggleSite = (site: string) => {
    setSelectedSites(prev => {
      const next = new Set(prev);
      if (next.has(site)) next.delete(site);
      else next.add(site);
      return next;
    });
  };

  const selectAllEvents = () => setSelectedEventTypes(new Set(EVENT_TYPES));
  const selectAllSites = () => setSelectedSites(new Set());

  const dateRangeLabel =
    dateRange === 'today' ? 'Today'
      : dateRange === '7days' ? 'Last 7 days'
        : dateRange === '30days' ? 'Last 30 days'
          : fromDate && toDate ? `${fromDate} to ${toDate}` : 'Custom';

  const buildMeta = () => [
    `Type: ${reportTypeLabel(reportType)}`,
    `Date: ${dateRangeLabel}`,
    reportType === 'events'
      ? `Events: ${selectedEventTypes.size === 0 ? 'None' : [...selectedEventTypes].join(', ')}`
      : null,
    reportType === 'events'
      ? `Sites: ${selectedSites.size === 0 ? 'All' : [...selectedSites].join(', ')}`
      : null,
    searchTerm ? `Search: ${searchTerm}` : '',
  ].filter(Boolean).join('  ·  ');

  const canGenerate =
    canExport &&
    (reportType === 'events'
      ? eventCensusTotal > 0
      : !tabularPreviewLoading && (tabularPreview?.rowCount ?? 0) > 0);

  const runGenerate = async () => {
    const { from, to } = getDateBounds(dateRange, fromDate, toDate);
    let eventsForReport = entries;
    if (reportType === 'events') {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (selectedEventTypes.size > 0 && selectedEventTypes.size < EVENT_TYPES.length) {
        params.set('types', [...selectedEventTypes].join(','));
      }
      const res = await authFetch(`/api/events/log?${params}`);
      if (!res.ok) throw new Error('Failed to fetch events for export');
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data?.entries ?? [];
      const veh = vehiclesRef.current;
      eventsForReport = rows
        .map((e: Record<string, unknown>) => mapApiEntry(e, veh))
        .filter(e => {
          if (e.type === 'panic') return false;
          const label = eventLabel(e);
          if (HIDDEN_LABELS.includes(label)) return false;
          if (!matchesEventType(e, selectedEventTypes)) return false;
          if (selectedSites.size > 0 && (!e.site || !selectedSites.has(e.site))) return false;
          const q = searchTerm.toLowerCase();
          return (
            searchTerm === '' ||
            (e.regNo && e.regNo !== 'N/A' && e.regNo.toLowerCase().includes(q)) ||
            (e.assetName && e.assetName.toLowerCase().includes(q)) ||
            (e.assetId && e.assetId.toLowerCase().includes(q)) ||
            (isKnownDriver(e.driverName) && e.driverName!.toLowerCase().includes(q)) ||
            (e.driverPhone && e.driverPhone.toLowerCase().includes(q))
          );
        });
    } else {
      eventsForReport = entries.filter(e => {
        if (e.type === 'panic') return false;
        const label = eventLabel(e);
        if (HIDDEN_LABELS.includes(label)) return false;
        return true;
      });
    }
    return generateTabularReport({
      reportType,
      baseTitle: reportTitle,
      meta: buildMeta(),
      search: searchTerm,
      events: eventsForReport,
      fromIso: from,
      toIso: to,
      tripGroupBy,
    });
  };

  const handleDownload = async () => {
    if (!canGenerate) return;
    setDownloading(true);
    setEmailStatus(null);
    try {
      const tabular = await runGenerate();
      if (tabular.rowCount === 0) {
        setEmailStatus('No rows for this report type and filters.');
        return;
      }
      await exportTabularReport(tabular, exportFormat);
    } catch (e) {
      setEmailStatus((e as Error)?.message || 'Failed to generate report.');
    } finally {
      setDownloading(false);
    }
  };

  const handleEmailReport = async () => {
    if (!canGenerate) return;
    const to = normalizeReportEmail(emailTo || defaultEmailTo);
    if (!isReportExportAllowed(to)) {
      setEmailStatus(`Recipient must be @${REPORT_EXPORT_ALLOWED_DOMAINS.join(' or @')}`);
      return;
    }
    setEmailing(true);
    setEmailStatus(null);
    try {
      const tabular = await runGenerate();
      if (tabular.rowCount === 0) {
        setEmailStatus('No rows for this report type and filters.');
        return;
      }
      const { blob, filename, mime } = await buildTabularReportBlob(tabular, exportFormat);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const chunk = 0x8000;
      let binary = '';
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const contentBase64 = btoa(binary);
      const res = await fetch('/api/reports/email', authFetchInit({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          filename,
          mime,
          contentBase64,
          reportTitle: tabular.title,
          meta: tabular.meta,
          eventCount: tabular.rowCount,
        }),
      }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.sent) {
        setEmailStatus(data.error || 'Failed to send report email.');
        return;
      }
      setEmailStatus(`Sent to ${to}`);
    } catch (e) {
      setEmailStatus((e as Error)?.message || 'Failed to send report email.');
    } finally {
      setEmailing(false);
    }
  };

  const filterSummary =
    selectedEventTypes.size > 0 && selectedEventTypes.size < EVENT_TYPES.length
      ? [...selectedEventTypes].join(', ')
      : null;

  return (
    <FeatureGate featureId="reports">
      <div className="bpl-page-header bpl-page-header-row">
        <div>
          <h1 className="bpl-page-title">
            <FileBarChart2 size={18} color="#0078D4" style={{ display: 'inline', marginRight: 8, verticalAlign: -3 }} />
            Reports
          </h1>
          <p className="bpl-page-subtitle">
            Generate event, driver scorecard, trip, and utilization reports — live data
          </p>
        </div>
        <span className="bpl-badge-blue">
          {reportType === 'events'
            ? (viewMode === 'events'
              ? (eventCensusTotal > EVENT_PREVIEW_LIMIT
                ? `Showing ${EVENT_PREVIEW_LIMIT} of ${eventCensusTotal.toLocaleString()}`
                : `${eventCensusTotal.toLocaleString()} event${eventCensusTotal !== 1 ? 's' : ''}`)
              : `${trendData.length} day${trendData.length !== 1 ? 's' : ''} of trends`)
            : tabularPreviewLoading
              ? 'Loading preview…'
              : `${tabularPreview?.rowCount ?? 0} row${(tabularPreview?.rowCount ?? 0) !== 1 ? 's' : ''}`}
        </span>
      </div>

      <div className="bpl-reports-layout">
        <div className="bpl-card bpl-reports-filters">
          <div className="bpl-reports-filters-title">Filters</div>

          <div className="bpl-field-label">Date range</div>
          <div className="bpl-reports-pill-row">
            {(
              [
                ['today', 'Today'],
                ['7days', '7 days'],
                ['30days', '30 days'],
                ['custom', 'Custom'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`bpl-reports-pill${dateRange === key ? ' active' : ''}`}
                onClick={() => setDateRange(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {dateRange === 'custom' && (
            <div className="bpl-reports-custom-dates">
              <div>
                <label className="bpl-field-label">From</label>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="bpl-field-label">To</label>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
              </div>
            </div>
          )}

          <div className="bpl-field-label">Search</div>
          <div className="bpl-reports-search">
            <Search size={14} />
            <input
              type="text"
              placeholder={
                reportType === 'events'
                  ? 'Reg no, asset, driver, phone…'
                  : reportType === 'driver_scorecard'
                    ? 'Driver, phone, reg…'
                    : reportType === 'trips'
                      ? 'Reg no, asset, driver…'
                      : 'Reg no, asset, zone…'
              }
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          {reportType === 'trips' && (
            <>
              <div className="bpl-field-label">Organize by</div>
              <div className="bpl-reports-view-toggle">
                {([
                  ['asset', 'Assets'],
                  ['driver', 'Drivers'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`bpl-reports-view-btn${tripGroupBy === key ? ' active' : ''}`}
                    onClick={() => setTripGroupBy(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          {reportType === 'events' && (
            <>
              <MultiSelectDropdown
                label="Site"
                options={siteOptions}
                selected={selectedSites}
                onToggle={toggleSite}
                onSelectAll={selectAllSites}
                allLabel="All sites"
                emptyMeansAll
              />

              <MultiSelectDropdown
                label="Event type"
                options={EVENT_TYPES}
                selected={selectedEventTypes}
                onToggle={toggleEventType}
                onSelectAll={selectAllEvents}
                allLabel="All event types"
                emptyLabel="None selected"
              />

              <div className="bpl-field-label">View</div>
              <div className="bpl-reports-view-toggle">
                {(['events', 'trends'] as ViewMode[]).map(v => (
                  <button
                    key={v}
                    type="button"
                    className={`bpl-reports-view-btn${viewMode === v ? ' active' : ''}`}
                    onClick={() => setViewMode(v)}
                  >
                    {v === 'events' ? 'Events table' : 'Trends graph'}
                  </button>
                ))}
              </div>

              {viewMode === 'trends' && (
                <>
                  <div className="bpl-field-label">Graph lines</div>
                  <button
                    type="button"
                    className={`bpl-reports-pill bpl-reports-pill--total${showTotal ? ' active' : ''}`}
                    onClick={() => setShowTotal(prev => !prev)}
                  >
                    Show total only
                  </button>
                </>
              )}
            </>
          )}

          <div className="bpl-reports-download-section">
            <div className="bpl-field-label">Report type</div>
            <div className="bpl-reports-type-list">
              {REPORT_TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className={`bpl-reports-type-btn${reportType === opt.id ? ' active' : ''}`}
                  onClick={() => setReportType(opt.id)}
                  title={opt.hint}
                >
                  <span className="bpl-reports-type-label">{opt.label}</span>
                  <span className="bpl-reports-type-hint">{opt.hint}</span>
                </button>
              ))}
            </div>
            <div className="bpl-field-label">Format</div>
            <div className="bpl-reports-format-row">
              {(['csv', 'excel', 'pdf'] as ExportFormat[]).map(f => (
                <button
                  key={f}
                  type="button"
                  className={`bpl-reports-pill bpl-reports-pill--format${exportFormat === f ? ' active' : ''}`}
                  onClick={() => setExportFormat(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            {!canExport && (
              <div className="bpl-reports-export-note">
                Report export limited to approved HBM domains (@{REPORT_EXPORT_ALLOWED_DOMAINS.join(', @')}).
              </div>
            )}
            <button
              type="button"
              className="bpl-reports-download-btn"
              disabled={!canGenerate || downloading}
              onClick={handleDownload}
            >
              <Download size={14} />
              {downloading ? 'Preparing…' : 'Download report'}
            </button>
            <div className="bpl-reports-email-row">
              <label className="bpl-field-label" htmlFor="report-email-to">Email report to</label>
              <input
                id="report-email-to"
                type="email"
                className="bpl-reports-email-select"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                placeholder={`name@${REPORT_EXPORT_ALLOWED_DOMAINS[0]}`}
                disabled={!canExport || emailing}
              />
              <button
                type="button"
                className="bpl-reports-email-btn"
                disabled={!canGenerate || emailing}
                onClick={handleEmailReport}
              >
                <Mail size={14} />
                {emailing ? 'Sending…' : 'Email report'}
              </button>
              {emailStatus && (
                <div className="bpl-reports-email-status">{emailStatus}</div>
              )}
            </div>
          </div>

          <ReportAutomate />

          <div className="bpl-reports-filters-foot">
            Auto-refreshes every 30s
            {loading && ' · Loading…'}
          </div>
        </div>

        <div className="bpl-card bpl-reports-main">
          <div className="bpl-reports-main-head">
            <span>
              {reportType === 'events'
                ? (viewMode === 'events' ? 'Event log' : 'Event trends')
                : reportTypeLabel(reportType)}
            </span>
            {reportType === 'events' && viewMode === 'trends' && !showTotal && filterSummary && (
              <span className="bpl-reports-main-sub">{filterSummary}</span>
            )}
          </div>

          {reportType !== 'events' ? (
            <div className="bpl-reports-table-wrap">
              {tabularPreviewLoading || loading ? (
                <div style={{ padding: 16 }}><SkelTable rows={8} /></div>
              ) : !tabularPreview || tabularPreview.rowCount === 0 ? (
                <div className="bpl-reports-empty">No rows for this report type and filters</div>
              ) : (
                <>
                  <table className="bpl-reports-table">
                    <thead>
                      <tr>
                        {tabularPreview.columns.map(col => (
                          <th key={col.header}>{col.header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tabularPreviewRows.map((row, i) => {
                        const isGroup = Boolean(row[0]);
                        return (
                          <tr
                            key={`${row[0]}-${row[1]}-${row[2]}-${i}`}
                            style={isGroup ? { background: 'var(--cd-surface-2)' } : undefined}
                          >
                            {row.map((cell, ci) => (
                              <td key={ci} className={!isGroup && ci > 0 ? 'muted' : undefined}>
                                {isGroup ? <strong>{cell || '—'}</strong> : (ci === 0 ? '' : (cell || '—'))}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {tabularPreview.rowCount > EVENT_PREVIEW_LIMIT && (
                    <div className="bpl-reports-preview-note">
                      Showing {EVENT_PREVIEW_LIMIT} of {tabularPreview.rowCount} rows — download or email for the full set
                    </div>
                  )}
                </>
              )}
            </div>
          ) : viewMode === 'events' ? (
            <div className="bpl-reports-table-wrap">
              {loading ? (
                <div style={{ padding: 16 }}><SkelTable rows={8} /></div>
              ) : filtered.length === 0 ? (
                <div className="bpl-reports-empty">No events match your filters</div>
              ) : (
                <>
                  <table className="bpl-reports-table">
                    <thead>
                      <tr>
                        {['Time', 'Event', 'Vehicle', 'Driver', 'Transporter', 'Site', 'Location'].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((entry, i) => {
                        const label = eventLabel(entry);
                        const displayName =
                          entry.regNo && entry.regNo !== 'N/A' ? entry.regNo : entry.assetId;
                        const driverDisplay = displayDriverName(entry.driverName);
                        return (
                          <tr key={`${entry.eventId}-${i}`}>
                            <td className="muted">{formatTime(entry.timestamp)}</td>
                            <td>
                              <span className="bpl-reports-event-label">
                                {label}
                              </span>
                            </td>
                            <td>
                              <strong>{displayName}</strong>
                              {entry.assetName && entry.assetName !== 'Unknown Vehicle' && (
                                <div className="bpl-reports-cell-sub">{entry.assetName}</div>
                              )}
                            </td>
                            <td>
                              {driverDisplay}
                              {entry.driverPhone && entry.driverPhone !== 'N/A' && (
                                <div className="bpl-reports-cell-sub">{entry.driverPhone}</div>
                              )}
                            </td>
                            <td>{entry.transporter && entry.transporter !== 'N/A' ? entry.transporter : '—'}</td>
                            <td>{entry.site && entry.site !== 'N/A' ? entry.site : '—'}</td>
                            <td className="route">
                              {entry.address && entry.address !== 'N/A' ? entry.address : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {eventCensusTotal > EVENT_PREVIEW_LIMIT && (
                    <div className="bpl-reports-preview-note">
                      Showing {EVENT_PREVIEW_LIMIT} of {eventCensusTotal.toLocaleString()} events — download or email for the full set
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="bpl-reports-trends-body">
              <DataRegion busy={loading} variant="chart" tall label="Loading trends">
              {trendData.length === 0 ? (
                <div className="bpl-reports-empty">No data for selected period</div>
              ) : (
                <>
                  {summaryStats && (
                    <div className="bpl-reports-summary-grid">
                      {[
                        { label: 'Total events', value: summaryStats.total },
                        { label: 'Daily average', value: summaryStats.avg },
                        { label: 'Peak day', value: summaryStats.peak.Total, sub: summaryStats.peak.date },
                        { label: 'Lowest day', value: summaryStats.lowest.Total, sub: summaryStats.lowest.date },
                      ].map(card => (
                        <div key={card.label} className="bpl-reports-summary-card">
                          <div className="bpl-reports-summary-value">{card.value}</div>
                          <div className="bpl-reports-summary-label">{card.label}</div>
                          {card.sub && <div className="bpl-reports-summary-sub">{card.sub}</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  <ResponsiveContainer width="100%" height={360}>
                    <LineChart data={trendData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--cd-border)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                        interval={trendData.length > 14 ? Math.floor(trendData.length / 7) : 0}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip content={<TrendTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                      {activeLines.map(line => (
                        <Line
                          key={line}
                          type="linear"
                          dataKey={line}
                          stroke={EVENT_COLORS[line]}
                          strokeWidth={line === 'Total' ? 2.5 : 1.5}
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>

                  <p className="bpl-reports-chart-hint">
                    Hover a point for the full breakdown. Use the filters on the left to narrow event types and sites.
                  </p>
                </>
              )}
              </DataRegion>
            </div>
          )}
        </div>
      </div>
    </FeatureGate>
  );
}
