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
import { SkelTable, DataRegion } from '../components/data/DataBusy';
import SiteScopeDropdown from '../components/SiteScopeDropdown';
import { useAuth } from '../context/AuthContext';
import { authFetch, useFleet } from '../context/FleetContext';
import { appendUrlScope } from '../lib/siteScope';
import {
  buildTabularReportBlob,
  exportTabularReport,
  archiveReportDownload,
  type ExportFormat,
  type LogEntry,
} from '../lib/reportExport';
import {
  isReportExportAllowed,
  normalizeReportEmail,
} from '../lib/reportExportAllowlist';
import {
  REPORT_TYPE_OPTIONS,
  reportTypeLabel,
  type ReportType,
  type TabularReport,
} from '../lib/reportTypes';
import {
  buildEventTypeCounts,
  connectivityEventDisplayLabel,
  REPORT_EVENT_TYPE_CATALOG,
  REPORT_EVENT_TYPE_IDS,
  reportEventTypeDef,
} from '../lib/reports/eventTypeCatalog';
import {
  buildConnectivityEntries,
  selectedIvmsEventTypes,
  wantsIvmsEvents,
} from '../lib/reports/buildConnectivityEntries';
import { isConnectivityEventType, IVMS_EVENT_TYPES, isAutomationOfflineCandidate } from '../lib/reports/connectivityCounts';
import { repeatOffenderIdsFromSnapshot, saveOfflineSnapshot } from '../lib/reports/repeatOffenders';
import { generateTabularReport } from '../lib/reports/generateTabularReport';
import {
  matchesEventReportSearch,
  reportSearchPlaceholder,
  vehicleStatusForEntry,
} from '../lib/reports/reportSearch';
import type { TripReportGroupBy } from '../lib/reports/buildTripReport';
import { displayDriverName, isKnownDriver } from '../lib/driverUtils';
import { reportTitle as brandReportTitle } from '../lib/branding';
import { authFetchInit } from '../lib/authApi';
import { authCachedJson, cachePeek, CACHE_TTL } from '../lib/apiCache';
import { selectedSiteScopeLabel } from '../lib/cementSiteTree';
import { startJitteredInterval } from '../lib/pollSchedule';
import { trackingWindowHoursFromIso } from '../lib/reports/trackingWindow';

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

const REPORTS_OFFLINE_SNAPSHOT_KEY = 'reports-page';

function persistOfflineSnapshotIfNeeded(
  vehicleList: { id: string; status?: string; position?: unknown; date?: string }[],
  selected: Set<string>,
  windowHours: number,
) {
  if (!selected.has('Offline')) return;
  const candidateIds = vehicleList
    .filter(v => isAutomationOfflineCandidate(v, Date.now(), windowHours))
    .map(v => v.id);
  saveOfflineSnapshot(REPORTS_OFFLINE_SNAPSHOT_KEY, candidateIds);
}

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
const REPORT_EMAIL_WARN_ROWS = 5_000;
const REPORT_EMAIL_MAX_ROWS = 100_000;
const EVENTS_REFRESH_MS = 30_000;
const EVENT_TYPES = REPORT_EVENT_TYPE_IDS;

function confirmLargeEmailReport(rowCount: number, format: ExportFormat) {
  if (rowCount <= REPORT_EMAIL_WARN_ROWS) return true;
  const rows = rowCount.toLocaleString();
  const formatLabel = format.toUpperCase();
  const sizeNote = rowCount >= 50_000
    ? ' Very large reports are usually fastest as CSV.'
    : '';
  return window.confirm(
    `This ${formatLabel} report contains ${rows} rows and may take a long time to generate and send.${sizeNote}\n\nContinue?`,
  );
}

function reportSiteKeyFor(zone?: string | null) {
  const z = (zone || '').trim();
  return z || 'Unknown';
}

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

function eventDisplayLabel(entry: LogEntry) {
  return connectivityEventDisplayLabel(entry.label || '');
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
  const eventRows = Array.isArray(events) ? events : [];
  const vehicleRows = Array.isArray(vehicles) ? vehicles : [];
  return eventRows.map(e => {
    const vehicle = vehicleRows.find(v => v.id === e.assetId || v.regNo === e.regNo);
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

function eventRowsFromPayload(data: any): Record<string, unknown>[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.entries)) return data.entries;
  return [];
}

/** Page through /api/events/log until every matching IVMS row is collected (past 10k dump). */
async function fetchAllIvmsEventRows(
  paramsBase: URLSearchParams,
  scopeAssetIds: string[],
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const pageSize = 1000;
  let offset = 0;
  let total = Infinity;
  const all: Record<string, unknown>[] = [];

  while (offset < total && all.length < 500_000) {
    const params = new URLSearchParams(paramsBase);
    params.set('format', 'page');
    params.set('limit', String(pageSize));
    params.set('offset', String(offset));
    const url = appendUrlScope(`/api/events/log?${params}`, {
      assetIds: scopeAssetIds,
    });
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Failed to fetch events for export');
    const data = await res.json();
    const rows = eventRowsFromPayload(data);
    total = typeof data?.total === 'number' ? data.total : offset + rows.length;
    if (!rows.length) break;
    all.push(...rows);
    offset += rows.length;
    // /events/log page mode may cap below the requested limit — don't stop early.
    if (offset >= total) break;
  }

  return { rows: all, total: Number.isFinite(total) ? total : all.length };
}

function mapApiEntry(e: Record<string, unknown>, vehicles: ReturnType<typeof useFleet>['vehicles']): LogEntry {
  const vehicleRows = Array.isArray(vehicles) ? vehicles : [];
  const vehicle = vehicleRows.find(
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
  hint,
  count,
  checked,
  onToggle,
}: {
  label: string;
  hint?: string;
  count?: number;
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
      <span className="bpl-reports-check-copy">
        <span className="bpl-reports-check-label">
          {label}
          {count != null && count >= 0 && (
            <span className="bpl-reports-check-count"> · {count.toLocaleString()}</span>
          )}
        </span>
        {hint && <span className="bpl-reports-check-hint">{hint}</span>}
      </span>
    </button>
  );
}

function MultiSelectDropdown({
  label,
  options,
  counts,
  selected,
  onToggle,
  onSelectAll,
  allLabel,
  emptyMeansAll = false,
  emptyLabel = 'None selected',
}: {
  label: string;
  options: readonly string[];
  counts?: Record<string, number>;
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
            {options.map(option => {
              const def = reportEventTypeDef(option);
              return (
                <FilterCheck
                  key={option}
                  label={option}
                  hint={def?.hint}
                  count={counts?.[option]}
                  checked={isChecked(option)}
                  onToggle={() => onToggle(option)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const {
    events: fleetEvents,
    vehicles,
    siteOptions,
    siteNameOptions,
    selectedSites,
    setSelectedSites,
    toggleSite,
    scopedAssetIds,
    siteFilterActive,
  } = useFleet();
  const vehiclesRef = useRef(vehicles);
  const fleetEventsRef = useRef(fleetEvents);
  vehiclesRef.current = vehicles;
  fleetEventsRef.current = fleetEvents;

  const [entries, setEntries] = useState<LogEntry[]>(() => {
    const { from, to } = getDateBounds('7days', '', '');
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('format', 'page');
    params.set('limit', String(EVENT_PREVIEW_LIMIT));
    const url = `/api/events/log?${params}`;
    const cached = cachePeek<any>(url);
    if (!cached) return [];
    const rows = Array.isArray(cached) ? cached : cached?.entries ?? [];
    return rows;
  });
  const [eventCensusTotal, setEventCensusTotal] = useState(() => {
    const { from, to } = getDateBounds('7days', '', '');
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('format', 'page');
    params.set('limit', String(EVENT_PREVIEW_LIMIT));
    const url = `/api/events/log?${params}`;
    const cached = cachePeek<any>(url);
    if (cached && typeof cached.total === 'number') return cached.total;
    return Array.isArray(cached) ? cached.length : (cached?.entries?.length ?? 0);
  });
  const [loading, setLoading] = useState(() => {
    const { from, to } = getDateBounds('7days', '', '');
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('format', 'page');
    params.set('limit', String(EVENT_PREVIEW_LIMIT));
    return !cachePeek(`/api/events/log?${params}`);
  });
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<string>>(
    () => new Set(EVENT_TYPES),
  );
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
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);

  const reportTitle = brandReportTitle();
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
      if (siteFilterActive && scopedAssetIds.length === 0) {
        if (!silent) {
          setEntries([]);
          setEventCensusTotal(0);
          setLoading(false);
        }
        return;
      }
      const { from, to } = getDateBounds(dateRange, fromDate, toDate);
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('format', 'page');
      params.set('limit', String(EVENT_PREVIEW_LIMIT));
      if (selectedEventTypes.size > 0 && selectedEventTypes.size < EVENT_TYPES.length) {
        const ivmsTypes = selectedIvmsEventTypes(selectedEventTypes);
        if (ivmsTypes.length > 0) params.set('types', ivmsTypes.join(','));
      }
      const url = appendUrlScope(`/api/events/log?${params}`, {
        assetIds: siteFilterActive ? scopedAssetIds : [],
      });
      const applyData = (data: any) => {
        const veh = vehiclesRef.current;
        const rows = eventRowsFromPayload(data);
        setEntries(rows.map((e: Record<string, unknown>) => mapApiEntry(e, veh)));
        setEventCensusTotal(typeof data?.total === 'number' ? data.total : rows.length);
      };
      if (!silent) {
        const cached = cachePeek<any>(url);
        if (cached !== null) {
          applyData(cached);
          setLoading(false);
        } else {
          setEntries([]);
          setEventCensusTotal(0);
          setLoading(true);
        }
      }
      try {
        const data = await authCachedJson<any>(url, authFetch, { ttlMs: CACHE_TTL.fleetEvents });
        if (cancelled) return;
        if (data !== null) {
          applyData(data);
        } else {
          const demo = mapDemoEntries(fleetEventsRef.current, vehiclesRef.current);
          setEntries(demo);
          setEventCensusTotal(demo.length);
        }
      } catch (e) {
        if (!cancelled) {
          const demo = mapDemoEntries(fleetEventsRef.current, vehiclesRef.current);
          setEntries(demo);
          setEventCensusTotal(demo.length);
        }
      } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    };
    void load(false);
    const stop = startJitteredInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void load(true);
    }, EVENTS_REFRESH_MS, 8_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [dateRange, fromDate, toDate, selectedEventTypes, selectedSites, scopedAssetIds.join(','), siteFilterActive]);

  const selectedSiteLabel = useMemo(
    () => selectedSiteScopeLabel(selectedSites, siteOptions, siteNameOptions, 'All sites') ?? 'All sites',
    [selectedSites, siteOptions, siteNameOptions],
  );

  const scopedVehicleRefs = useMemo(() => {
    if (!siteFilterActive) return null;
    const ids = new Set<string>();
    const regs = new Set<string>();
    // vehicles from context are already header-filtered when siteFilterActive.
    vehicles.forEach(v => {
      if (v.id) ids.add(v.id.toString());
      if (v.regNo) regs.add(v.regNo.trim().toLowerCase());
    });
    return { ids, regs };
  }, [siteFilterActive, vehicles]);

  const eventMatchesSelectedSite = (event: LogEntry) => {
    if (!scopedVehicleRefs) return true;
    const id = event.assetId?.toString();
    const reg = event.regNo?.trim().toLowerCase();
    return Boolean((id && scopedVehicleRefs.ids.has(id)) || (reg && scopedVehicleRefs.regs.has(reg)));
  };

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

  const vehicleRefs = useMemo(
    () => vehicles.map(v => ({
      id: v.id,
      regNo: v.regNo,
      transporter: v.transporter,
      site: v.site,
      status: v.status,
    })),
    [vehicles],
  );

  const trackingWindowHours = useMemo(() => {
    const { from, to } = getDateBounds(dateRange, fromDate, toDate);
    return trackingWindowHoursFromIso(from, to);
  }, [dateRange, fromDate, toDate]);

  const eventTypeCounts = useMemo(() => {
    const ivms: Record<string, number> = {};
    for (const e of entries) {
      if (e.type === 'panic') continue;
      const label = eventLabel(e);
      if (HIDDEN_LABELS.includes(label)) continue;
      ivms[label] = (ivms[label] || 0) + 1;
    }
    return buildEventTypeCounts(ivms, vehicles, trackingWindowHours);
  }, [entries, vehicles, trackingWindowHours]);

  const eventMatchesSearch = (event: LogEntry) =>
    matchesEventReportSearch(
      event,
      searchTerm,
      vehicleStatusForEntry(event, vehicleRefs),
    );

  const vehicleMatchesSelectedSite = (vehicle: (typeof vehicles)[number]) => {
    if (!siteFilterActive) return true;
    const allowed = new Set(selectedSites.map(s => s.trim().toLowerCase()).filter(Boolean));
    const zone = ((vehicle.zone || '').trim() || 'Unknown').toLowerCase();
    const site = (vehicle.site || '').trim().toLowerCase();
    const transporter = (vehicle.transporter || '').trim().toLowerCase();
    return allowed.has(zone) || allowed.has(site) || allowed.has(transporter);
  };

  const repeatOffenderIds = useMemo(() => {
    if (!selectedEventTypes.has('Offline')) return undefined;
    const candidateIds = vehicles
      .filter(v => isAutomationOfflineCandidate(v, Date.now(), trackingWindowHours))
      .map(v => v.id);
    return repeatOffenderIdsFromSnapshot(REPORTS_OFFLINE_SNAPSHOT_KEY, candidateIds);
  }, [vehicles, selectedEventTypes, trackingWindowHours]);

  const connectivityEntries = useMemo(
    () =>
      buildConnectivityEntries({
        vehicles,
        selectedTypes: selectedEventTypes,
        matchesSite: vehicleMatchesSelectedSite,
        matchesSearch: eventMatchesSearch,
        repeatOffenderIds,
        windowHours: trackingWindowHours,
      }),
    [vehicles, selectedEventTypes, selectedSites, searchTerm, vehicleRefs, repeatOffenderIds, trackingWindowHours],
  );

  const ivmsFiltered = useMemo(
    () =>
      entries.filter(e => {
        if (e.type === 'panic') return false;
        const label = eventLabel(e);
        if (HIDDEN_LABELS.includes(label)) return false;
        if (!matchesEventType(e, selectedEventTypes)) return false;
        if (!eventMatchesSelectedSite(e)) return false;
        return eventMatchesSearch(e);
      }),
    [entries, selectedEventTypes, scopedVehicleRefs, searchTerm, vehicleRefs],
  );

  const filtered = useMemo(
    () => [...ivmsFiltered, ...connectivityEntries],
    [ivmsFiltered, connectivityEntries],
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
    const id = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => window.clearTimeout(id);
  }, [searchTerm]);

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
            debouncedSearchTerm ? `Search: ${debouncedSearchTerm}` : '',
          ].filter(Boolean).join('  ·  '),
          search: debouncedSearchTerm,
          events: scorecardEvents,
          fromIso: from,
          toIso: to,
          tripGroupBy,
          vehicles: vehicleRefs,
        });
        if (!cancelled) setTabularPreview(tabular);
      } catch {
        if (!cancelled) setTabularPreview(null);
      } finally {
        if (!cancelled) setTabularPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reportType, dateRange, fromDate, toDate, debouncedSearchTerm, scorecardEvents, reportTitle, tripGroupBy, vehicleRefs]);

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
      if (isConnectivityEventType(label)) return;
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
    return types.filter(t => t !== 'Total' && !isConnectivityEventType(t));
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

  const selectAllEvents = () => setSelectedEventTypes(new Set(EVENT_TYPES));

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
      ? `Sites: ${selectedSiteLabel}`
      : null,
    searchTerm ? `Search: ${searchTerm}` : '',
  ].filter(Boolean).join('  ·  ');

  const canGenerate =
    reportType === 'events'
      ? filtered.length > 0 || eventCensusTotal > 0 || connectivityEntries.length > 0
      : !tabularPreviewLoading && (tabularPreview?.rowCount ?? 0) > 0;
  const estimatedEmailRows =
    reportType === 'events'
      ? (wantsIvmsEvents(selectedEventTypes, EVENT_TYPES.length) ? eventCensusTotal : 0)
        + connectivityEntries.length
      : (tabularPreview?.rowCount ?? 0);

  const buildIvmsExportParams = (from: string | null, to: string | null) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const ivmsTypes = selectedIvmsEventTypes(selectedEventTypes);
    if (
      ivmsTypes.length > 0
      && ivmsTypes.length < IVMS_EVENT_TYPES.length
      && selectedEventTypes.size < EVENT_TYPES.length
    ) {
      params.set('types', ivmsTypes.join(','));
    }
    if (searchTerm.trim()) params.set('q', searchTerm.trim());
    return params;
  };

  const runGenerate = async () => {
    const { from, to } = getDateBounds(dateRange, fromDate, toDate);
    let eventsForReport: LogEntry[] = [];
    if (reportType === 'events') {
      const fetchIvms = wantsIvmsEvents(selectedEventTypes, EVENT_TYPES.length);

      if (fetchIvms) {
        if (siteFilterActive && scopedAssetIds.length === 0) {
          eventsForReport = [];
        } else {
          const { rows } = await fetchAllIvmsEventRows(
            buildIvmsExportParams(from, to),
            siteFilterActive ? scopedAssetIds : [],
          );
          const veh = vehiclesRef.current;
          eventsForReport = rows
            .map((e: Record<string, unknown>) => mapApiEntry(e, veh))
            .filter(e => {
              if (e.type === 'panic') return false;
              const label = eventLabel(e);
              if (HIDDEN_LABELS.includes(label)) return false;
              if (!matchesEventType(e, selectedEventTypes)) return false;
              if (!eventMatchesSelectedSite(e)) return false;
              return eventMatchesSearch(e);
            });
        }
      }

      eventsForReport = [...eventsForReport, ...connectivityEntries];
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
      vehicles: vehicleRefs,
    });
  };

  const handleDownload = async () => {
    if (!canGenerate) return;
    setDownloading(true);
    setEmailStatus(null);
    try {
      // Events CSV/Excel: server pages the full IVMS set (no 10k one-shot dump).
      if (reportType === 'events' && (exportFormat === 'csv' || exportFormat === 'excel')) {
        const { from, to } = getDateBounds(dateRange, fromDate, toDate);
        const fetchIvms = wantsIvmsEvents(selectedEventTypes, EVENT_TYPES.length);
        if (siteFilterActive && scopedAssetIds.length === 0 && fetchIvms && connectivityEntries.length === 0) {
          setEmailStatus('No rows for this report type and filters.');
          return;
        }

        const ivmsTypes = selectedIvmsEventTypes(selectedEventTypes);
        let typesParam: string | null = null;
        if (
          fetchIvms
          && ivmsTypes.length > 0
          && ivmsTypes.length < IVMS_EVENT_TYPES.length
          && selectedEventTypes.size < EVENT_TYPES.length
        ) {
          typesParam = ivmsTypes.join(',');
        }

        const res = await authFetch('/api/reports/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reportType: 'events',
            format: exportFormat,
            from: from || null,
            to: to || null,
            types: typesParam,
            assetIds: siteFilterActive && scopedAssetIds.length
              ? scopedAssetIds.join(',')
              : null,
            q: searchTerm.trim() || null,
            title: `${reportTitle} — ${reportTypeLabel('events')}`,
            meta: buildMeta(),
            includeIvms: fetchIvms && !(siteFilterActive && scopedAssetIds.length === 0),
            extraEntries: connectivityEntries,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to export report');
        }
        const rowCount = Number(res.headers.get('X-Report-Row-Count') || 0);
        if (rowCount === 0) {
          setEmailStatus('No rows for this report type and filters.');
          return;
        }
        const disposition = res.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="([^"]+)"/i);
        const filename = match?.[1] || `hbm-events-${new Date().toISOString().slice(0, 10)}.${exportFormat === 'excel' ? 'xlsx' : 'csv'}`;
        const mime = res.headers.get('Content-Type')
          || (exportFormat === 'excel'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv;charset=utf-8');
        const buffer = await res.arrayBuffer();
        const blob = new Blob([buffer], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        void archiveReportDownload({
          filename,
          mime,
          blob,
          type: 'Events',
          meta: {
            reportTitle: `${reportTitle} — ${reportTypeLabel('events')}`,
            filters: buildMeta(),
            format: exportFormat,
            reportType: 'events',
            rowCount,
          },
        });
        if (res.headers.get('X-Report-Truncated') === '1') {
          setEmailStatus(`Downloaded ${rowCount.toLocaleString()} rows (export safety cap reached).`);
        }
        persistOfflineSnapshotIfNeeded(vehicles, selectedEventTypes, trackingWindowHours);
        return;
      }

      const tabular = await runGenerate();
      if (tabular.rowCount === 0) {
        setEmailStatus('No rows for this report type and filters.');
        return;
      }
      await exportTabularReport(tabular, exportFormat);
      persistOfflineSnapshotIfNeeded(vehicles, selectedEventTypes, trackingWindowHours);
    } catch (e) {
      setEmailStatus((e as Error)?.message || 'Failed to generate report.');
    } finally {
      setDownloading(false);
    }
  };

  const handleEmailReport = async () => {
    if (!canGenerate) return;
    const to = normalizeReportEmail(emailTo || defaultEmailTo);
    if (!to) {
      setEmailStatus('Please enter a recipient email address.');
      return;
    }
    if (estimatedEmailRows > REPORT_EMAIL_MAX_ROWS) {
      setEmailStatus(`This report has ${estimatedEmailRows.toLocaleString()} rows. Email reports are capped at ${REPORT_EMAIL_MAX_ROWS.toLocaleString()} rows.`);
      return;
    }
    if (!confirmLargeEmailReport(estimatedEmailRows, exportFormat)) {
      setEmailStatus('Email report cancelled.');
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
      if (tabular.rowCount > REPORT_EMAIL_MAX_ROWS) {
        setEmailStatus(`This report has ${tabular.rowCount.toLocaleString()} rows. Email reports are capped at ${REPORT_EMAIL_MAX_ROWS.toLocaleString()} rows.`);
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
      persistOfflineSnapshotIfNeeded(vehicles, selectedEventTypes, trackingWindowHours);
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
              ? (filtered.length > EVENT_PREVIEW_LIMIT
                ? `Showing ${EVENT_PREVIEW_LIMIT} of ${filtered.length.toLocaleString()}`
                : `${filtered.length.toLocaleString()} event${filtered.length !== 1 ? 's' : ''}`)
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
              placeholder={reportSearchPlaceholder(reportType)}
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
              <SiteScopeDropdown
                label="Site"
                variant="field"
                selectedSites={selectedSites}
                setSelectedSites={setSelectedSites}
                toggleSite={toggleSite}
                siteOptions={siteOptions}
                siteNameOptions={siteNameOptions}
              />

              <MultiSelectDropdown
                label="Event type"
                options={EVENT_TYPES}
                counts={eventTypeCounts}
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
                placeholder="name@example.com"
                disabled={emailing}
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
                        const label = eventDisplayLabel(entry);
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
                              {entry.connectivityNote && (
                                <div className="bpl-reports-cell-sub">{entry.connectivityNote}</div>
                              )}
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
                  {filtered.length > EVENT_PREVIEW_LIMIT && (
                    <div className="bpl-reports-preview-note">
                      Showing {EVENT_PREVIEW_LIMIT} of {filtered.length.toLocaleString()} events — download or email for the full set
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
