import { useState, useMemo, useEffect, useDeferredValue, useRef, Fragment } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Search, ClipboardCheck, ChevronDown, ChevronRight, ExternalLink, AlertTriangle } from 'lucide-react';
import { authFetch, useFleet } from '../context/FleetContext';
import type { LogEntry } from '../context/FleetContext';
import { authCachedJson, cachePeek, CACHE_TTL } from '../lib/apiCache';
import { isKnownDriver, displayDriverName, isActiveDriver, isActiveDriverId } from '../lib/driverUtils';
import {
  buildDriverConsequenceCard,
  loadConsequenceOccurrences,
  nextOccurrenceIndex,
  getOccurrenceCount,
  getResponseLogForDriver,
  type OccurrenceStore,
} from '../lib/consequenceScore';
import { brandLabel, eventLocationLabel } from '../lib/branding';
import MockNamesBadge from '../components/MockNamesBadge';
import { SkelValue, SkelTable } from '../components/data/DataBusy';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useClientPagination } from '../hooks/useClientPagination';
import { useTableSort } from '../hooks/useTableSort';
import { filterOverspeedEvents, isOverspeedLabel } from '../lib/overspeedFilter';
import { filterTripDriversByVehicles } from '../lib/siteScope';
import { tripStatsByDriverKey } from '../lib/driverAssessment';
import { useAssessmentTripDrivers } from '../hooks/useAssessmentTripDrivers';
import { COACHING_SCORE_THRESHOLD } from '../config/interventionRules';
import PagePeriodBar from '../components/PagePeriodBar';
import TablePaginationBar from '../components/TablePaginationBar';
import CustomDateTimeRange from '../components/CustomDateTimeRange';
import IncidentTrendsPanel from '../components/incidents/IncidentTrendsPanel';
import {
  type PageDateRange,
  defaultPageCustomRange,
  ensureCustomRangeDefaults,
  pagePeriodIsoBounds,
} from '../lib/pagePeriod';
import { startJitteredInterval } from '../lib/pollSchedule';
import {
  EVENT_FILTER_OPTIONS,
  type EventFilterKey,
  eventTypesQueryParam,
  filterEventsByType,
  isEventFilterKey,
  sumOverspeedFamily,
} from '../lib/eventFilters';

type Tab = 'events' | 'by-driver' | 'patterns';
type DateRange = PageDateRange;
type EventsView = 'events' | 'trends';
type EventFilter = EventFilterKey;
const RESPONSE_TRACKING_EVENT_COUNT = 8;

const EVENT_COLORS: Record<string, string> = {
  'Harsh Braking': '#0d9488',
  'Harsh Acceleration': '#0078D4',
  'Overspeeding': '#9333ea',
  'Overspeed Tiered': '#a855f7',
  'Road Speed Overspeeding': '#c026d3',
  'Harsh Cornering': '#d97706',
};

const EVENT_PAGE_SIZE = 100;
const DRIVER_TABLE_PAGE_SIZE = 50;

function getLabel(e: LogEntry) {
  return e.label || 'Unknown';
}

/** Stable range tokens — avoids unique `to=now` cache misses on every revisit. */
function incidentApiRange(range: DateRange): 'today' | '7d' | '30d' | 'all' | null {
  if (range === 'today') return 'today';
  if (range === '7days') return '7d';
  if (range === '30days') return '30d';
  if (range === 'alltime' || range === 'all') return '30d';
  return null;
}

/** Bucket wall-clock for from/to URLs (events/log) so remounts hit the same cache key. */
function bucketedNowIso(bucketMs = 5 * 60_000) {
  const t = Math.ceil(Date.now() / bucketMs) * bucketMs;
  return new Date(t).toISOString();
}

function isoIncidentRange(range: DateRange, customFrom = '', customTo = ''): { from: string; to: string } {
  const b = pagePeriodIsoBounds(range, customFrom, customTo);
  if (b.from && b.to) return { from: b.from, to: b.to };
  return { from: '2020-01-01T00:00:00.000Z', to: bucketedNowIso() };
}

function incidentSummaryUrl(range: DateRange, customFrom = '', customTo = '') {
  const token = incidentApiRange(range);
  if (token && token !== 'all') return `/api/safety/summary?range=${token}`;
  if (token === 'all') return '/api/safety/summary?range=30d'; // fallback wide window
  const { from, to } = isoIncidentRange(range, customFrom, customTo);
  return `/api/safety/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

function incidentRiskDriversUrl(range: DateRange, customFrom = '', customTo = '') {
  const token = incidentApiRange(range);
  if (token && token !== 'all') return `/api/risk/drivers?range=${token}`;
  const { from, to } = isoIncidentRange(range, customFrom, customTo);
  return `/api/risk/drivers?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

function incidentEventsPageUrl(range: DateRange, opts: {
  page: number;
  eventFilter: EventFilter;
  search: string;
  assetId?: string;
}, customFrom = '', customTo = '') {
  const { from, to } = isoIncidentRange(range, customFrom, customTo);
  const params = new URLSearchParams();
  params.set('from', from);
  params.set('to', to);
  params.set('format', 'page');
  params.set('limit', String(EVENT_PAGE_SIZE));
  params.set('offset', String(Math.max(0, opts.page) * EVENT_PAGE_SIZE));
  const typesParam = eventTypesQueryParam(opts.eventFilter);
  if (typesParam) params.set('types', typesParam);
  const q = opts.search.trim();
  if (q) params.set('q', q);
  if (opts.assetId) params.set('assetId', opts.assetId);
  return `/api/events/log?${params}`;
}

function incidentPatternsEventsUrl(range: DateRange, driverName: string, customFrom = '', customTo = '') {
  const { from, to } = isoIncidentRange(range, customFrom, customTo);
  const params = new URLSearchParams();
  params.set('from', from);
  params.set('to', to);
  params.set('format', 'page');
  params.set('limit', '10');
  params.set('offset', '0');
  params.set('driver', driverName);
  return `/api/events/log?${params}`;
}


function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Africa/Lagos',
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function EventsTab({
  dateRange,
  customFrom,
  customTo,
  onDateRangeChange,
  onCustomFromChange,
  onCustomToChange,
  eventsView,
  onEventsViewChange,
  highlightEventId,
  initialSearch,
  initialAssetId,
}: {
  dateRange: DateRange;
  customFrom: string;
  customTo: string;
  onDateRangeChange: (range: DateRange) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  eventsView: EventsView;
  onEventsViewChange: (view: EventsView) => void;
  highlightEventId: string | null;
  initialSearch: string;
  initialAssetId: string | null;
}) {
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  const initialFilter: EventFilter =
    !highlightEventId && filterParam && isEventFilterKey(filterParam)
      ? filterParam
      : 'All';
  const [search, setSearch] = useState(initialSearch);
  const [eventFilter, setEventFilter] = useState<EventFilter>(initialFilter);
  const [page, setPage] = useState(0);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const debouncedSearch = useDebouncedValue(search, 250);
  const deferredSearch = useDeferredValue(debouncedSearch);

  const pageUrl = incidentEventsPageUrl(dateRange, {
    page,
    eventFilter,
    search: deferredSearch,
    assetId: initialAssetId || undefined,
  }, customFrom, customTo);
  const [visibleRows, setVisibleRows] = useState<LogEntry[]>(() => {
    const cached = cachePeek<{ entries?: LogEntry[] } | LogEntry[]>(pageUrl);
    if (!cached) return [];
    const rows = Array.isArray(cached) ? cached : cached.entries ?? [];
    return filterEventsByType(filterOverspeedEvents(rows), eventFilter);
  });
  const [censusTotal, setCensusTotal] = useState(() => {
    const cached = cachePeek<{ total?: number; entries?: LogEntry[] }>(pageUrl);
    if (cached && typeof cached === 'object' && !Array.isArray(cached) && typeof cached.total === 'number') {
      return cached.total;
    }
    return visibleRows.length;
  });
  const [eventsLoading, setEventsLoading] = useState(() => !cachePeek(pageUrl));

  useEffect(() => {
    if (!highlightEventId) return;
    setEventFilter('All');
    setSearch('');
    setPage(0);
  }, [highlightEventId]);

  useEffect(() => {
    setPage(0);
  }, [dateRange, eventFilter, deferredSearch, customFrom, customTo, initialAssetId]);

  useEffect(() => {
    if (highlightEventId) return;
    setSearch(initialSearch);
    setPage(0);
  }, [highlightEventId, initialSearch, initialAssetId]);

  useEffect(() => {
    let cancelled = false;

    const applyPayload = (data: { entries?: LogEntry[]; total?: number } | LogEntry[] | null) => {
      if (!data) return;
      const raw = Array.isArray(data) ? data : data.entries ?? [];
      const rows = filterEventsByType(filterOverspeedEvents(raw), eventFilter);
      setVisibleRows(rows);
      setCensusTotal(
        !Array.isArray(data) && typeof data.total === 'number' ? data.total : rows.length,
      );
    };

    const load = async (silent: boolean) => {
      const url = incidentEventsPageUrl(dateRange, {
        page,
        eventFilter,
        search: deferredSearch,
        assetId: initialAssetId || undefined,
      }, customFrom, customTo);
      const cached = cachePeek<{ entries?: LogEntry[]; total?: number } | LogEntry[]>(url);
      if (cached != null) {
        applyPayload(cached);
        setEventsLoading(false);
      } else if (!silent) {
        setEventsLoading(true);
      }

      try {
        const data = await authCachedJson<{ entries?: LogEntry[]; total?: number } | LogEntry[]>(
          url,
          authFetch,
          { ttlMs: CACHE_TTL.fleetEvents },
        );
        if (cancelled || data == null) return;
        applyPayload(data);
      } catch {
        /* keep cached rows */
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    };

    void load(false);
    const stop = startJitteredInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void load(true);
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [dateRange, eventFilter, deferredSearch, page, customFrom, customTo, initialAssetId]);

  const pageCount = Math.max(1, Math.ceil(censusTotal / EVENT_PAGE_SIZE) || 1);
  const from = censusTotal === 0 ? 0 : page * EVENT_PAGE_SIZE + 1;
  const to = Math.min(censusTotal, (page + 1) * EVENT_PAGE_SIZE);
  const hasPrev = page > 0;
  const hasNext = page < pageCount - 1;

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  useEffect(() => {
    if (!highlightEventId) return;
    highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightEventId, visibleRows]);

  return (
    <div className="bpl-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 520, padding: 0 }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--cd-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: dateRange === 'custom' ? 8 : 0 }}>
          {(['today', '7days', '30days', 'custom'] as DateRange[]).map(r => (
            <button
              key={r}
              type="button"
              onClick={() => {
                if (r === 'custom') {
                  ensureCustomRangeDefaults(customFrom, customTo, onCustomFromChange, onCustomToChange);
                }
                onDateRangeChange(r);
              }}
              style={{
                padding: '4px 10px', borderRadius: 9999, fontSize: 11,
                fontWeight: dateRange === r ? 500 : 400, cursor: 'pointer',
                border: dateRange === r ? '0.5px solid var(--cd-accent-2, #5b8f8a)' : '0.5px solid var(--cd-border)',
                background: dateRange === r ? '#eff6ff' : 'var(--cd-surface-2)',
                color: dateRange === r ? '#2563eb' : 'var(--cd-text-muted)',
              }}
            >
              {r === 'today' ? 'Today' : r === '7days' ? '7 days' : r === '30days' ? '30 days' : 'Custom'}
            </button>
          ))}
        </div>
        {dateRange === 'custom' && (
          <CustomDateTimeRange
            stacked
            from={customFrom}
            to={customTo}
            onFromChange={onCustomFromChange}
            onToChange={onCustomToChange}
            style={{ marginTop: 8 }}
          />
        )}
      </div>

      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--cd-border)', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'var(--cd-text-soft, var(--cd-text-muted))' }} />
          <input
            type="text"
            placeholder="Search reg no, asset name, or driver..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', paddingLeft: 32, paddingRight: 12, paddingTop: 7, paddingBottom: 7,
              border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 13, outline: 'none',
              backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)',
            }}
          />
        </div>
      </div>

      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--cd-border)', display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
        {EVENT_FILTER_OPTIONS.map(f => {
          const active = eventFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setEventFilter(f.key)}
              style={{
                padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                border: active ? '0.5px solid #fde68a' : '0.5px solid var(--cd-border)',
                background: active ? '#fef3c7' : 'var(--cd-surface-2)',
                color: active ? '#854F0B' : 'var(--cd-text-muted)',
              }}
            >
              {f.key === 'Road Speed Overspeeding' ? 'Road Speed' : f.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--cd-border)', display: 'flex', gap: 8, flexShrink: 0 }}>
        {([
          { id: 'events' as const, label: 'Events' },
          { id: 'trends' as const, label: 'Trends' },
        ]).map(v => (
          <button
            key={v.id}
            type="button"
            onClick={() => onEventsViewChange(v.id)}
            style={{
              padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: eventsView === v.id ? 'none' : '1px solid var(--cd-border)',
              background: eventsView === v.id ? '#0f172a' : 'var(--cd-surface-2)',
              color: eventsView === v.id ? '#fff' : 'var(--cd-text-muted)',
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      {eventsView === 'trends' ? (
        <div style={{ flex: 1, padding: 12 }}>
          <IncidentTrendsPanel
            dateRange={dateRange}
            customFrom={customFrom}
            customTo={customTo}
            activeFilter={eventFilter}
          />
        </div>
      ) : (
      <>
      <div className="bpl-incident-list" style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {eventsLoading && visibleRows.length === 0 ? (
          <div style={{ padding: 8 }}><SkelTable rows={8} /></div>
        ) : visibleRows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cd-text-muted)', fontSize: 13 }}>
            No events available
          </div>
        ) : visibleRows.map((e, i) => {
          const label = getLabel(e);
          const color = EVENT_COLORS[label] || 'var(--bpl-blue)';
          const location = eventLocationLabel(e);
          const hasDriver = isKnownDriver(e.driverName);
          const isHighlighted = !!highlightEventId && e.eventId === highlightEventId;
          const speed = isOverspeedLabel(label) && e.speed != null && Number.isFinite(Number(e.speed))
            ? Math.round(Number(e.speed))
            : null;
          const meta = [
            hasDriver ? displayDriverName(e.driverName) : null,
            e.assetName && e.assetName !== 'N/A' ? e.assetName : null,
            e.transporter && e.transporter !== 'N/A' ? brandLabel(e.transporter) : null,
            location && location !== '—' ? location : null,
          ].filter(Boolean).join(' · ');
          return (
            <div
              key={e.eventId || i}
              ref={isHighlighted ? highlightRef : undefined}
              className={`bpl-incident-card${isHighlighted ? ' bpl-incident-highlight' : ''}`}
              style={{ '--incident-accent': color } as React.CSSProperties}
            >
              <div className="bpl-incident-card-body">
                <div className="bpl-incident-card-top">
                  <span className="bpl-incident-type">{label}</span>
                  <span className="bpl-incident-time">{formatTime(e.eventTime || e.timestamp)}</span>
                </div>
                <div className="bpl-incident-title">{e.regNo || e.assetId}</div>
                {meta && <div className="bpl-incident-meta">{meta}</div>}
              </div>
              {speed != null && (
                <div className="bpl-incident-speed">
                  <span className="bpl-incident-speed-value">{speed}</span>
                  <span className="bpl-incident-speed-unit">km/h</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--cd-border)', fontSize: 11, color: 'var(--cd-text-muted)', textAlign: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>{censusTotal === 0 ? 'No events' : `Showing ${from}–${to} of ${censusTotal.toLocaleString()}`}</span>
          {pageCount > 1 && (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                disabled={!hasPrev}
                onClick={() => setPage(p => Math.max(0, p - 1))}
                style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 11, cursor: hasPrev ? 'pointer' : 'default',
                  border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)',
                  color: hasPrev ? 'var(--cd-text)' : 'var(--cd-text-soft, var(--cd-text-muted))',
                }}
              >
                Prev
              </button>
              <span>Page {page + 1} / {pageCount}</span>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 11, cursor: hasNext ? 'pointer' : 'default',
                  border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)',
                  color: hasNext ? 'var(--cd-text)' : 'var(--cd-text-soft, var(--cd-text-muted))',
                }}
              >
                Next
              </button>
            </span>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}

type RiskDriverRow = {
  driverId?: string | null;
  driverName?: string;
  harshBraking?: number;
  overspeeding?: number;
  overspeedTiered?: number;
  harshAcceleration?: number;
  harshCornering?: number;
  total?: number;
};

function ByDriverTab({ dateRange, customFrom, customTo }: { dateRange: DateRange; customFrom: string; customTo: string }) {
  const url = incidentRiskDriversUrl(dateRange, customFrom, customTo);
  const [rows, setRows] = useState(() => {
    const cached = cachePeek<{ drivers?: RiskDriverRow[] }>(url);
    return (cached?.drivers ?? [])
      .map(d => ({
        name: d.driverName || 'N/A',
        harshBraking: d.harshBraking ?? 0,
        overspeeding: (d.overspeeding ?? 0) + (d.overspeedTiered ?? 0),
        harshAcceleration: d.harshAcceleration ?? 0,
        harshCornering: d.harshCornering ?? 0,
        total: d.total ?? 0,
      }))
      .filter(d => isKnownDriver(d.name))
      .sort((a, b) => b.total - a.total);
  });
  const [eventsLoading, setEventsLoading] = useState(() => !cachePeek(url));

  useEffect(() => {
    let cancelled = false;
    const nextUrl = incidentRiskDriversUrl(dateRange, customFrom, customTo);
    const cached = cachePeek<{ drivers?: RiskDriverRow[] }>(nextUrl);
    if (cached?.drivers) {
      setRows(
        cached.drivers
          .map(d => ({
            name: d.driverName || 'N/A',
            harshBraking: d.harshBraking ?? 0,
            overspeeding: (d.overspeeding ?? 0) + (d.overspeedTiered ?? 0),
            harshAcceleration: d.harshAcceleration ?? 0,
            harshCornering: d.harshCornering ?? 0,
            total: d.total ?? 0,
          }))
          .filter(d => isKnownDriver(d.name))
          .sort((a, b) => b.total - a.total),
      );
      setEventsLoading(false);
    } else {
      setEventsLoading(true);
    }

    authCachedJson<{ drivers?: RiskDriverRow[] }>(nextUrl, authFetch, {
      ttlMs: CACHE_TTL.riskDrivers,
    })
      .then(data => {
        if (cancelled || !data?.drivers) return;
        setRows(
          data.drivers
            .map(d => ({
              name: d.driverName || 'N/A',
              harshBraking: d.harshBraking ?? 0,
              overspeeding: (d.overspeeding ?? 0) + (d.overspeedTiered ?? 0),
              harshAcceleration: d.harshAcceleration ?? 0,
              harshCornering: d.harshCornering ?? 0,
              total: d.total ?? 0,
            }))
            .filter(d => isKnownDriver(d.name))
            .sort((a, b) => b.total - a.total),
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });

    return () => { cancelled = true; };
  }, [dateRange, customFrom, customTo]);

  const pagination = useClientPagination(
    rows,
    DRIVER_TABLE_PAGE_SIZE,
    `${dateRange}|${customFrom}|${customTo}`,
  );

  return (
    <div className="bpl-card" style={{ overflow: 'hidden' }}>
      <table className="bpl-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Driver</th>
            <th>Harsh Braking</th>
            <th>Overspeeding</th>
            <th>Harsh Accel.</th>
            <th>Cornering</th>
            <th>Total</th>
            <th>Risk</th>
          </tr>
        </thead>
        <tbody>
          {eventsLoading && rows.length === 0 ? (
            <tr><td colSpan={8} style={{ padding: 12 }}><SkelTable rows={8} /></td></tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--cd-text-muted)' }}>
                No driver event data available
              </td>
            </tr>
          ) : pagination.pageRows.map((d, i) => {
            const risk = d.total > 10 ? 'HIGH' : d.total > 5 ? 'MEDIUM' : 'LOW';
            const riskColor = risk === 'HIGH' ? '#CC0000' : risk === 'MEDIUM' ? '#d97706' : '#16a34a';
            return (
              <tr key={d.name}>
                <td style={{ fontWeight: 700, color: 'var(--cd-text-muted)' }}>#{pagination.from + i}</td>
                <td style={{ fontWeight: 600 }}>{displayDriverName(d.name)}</td>
                <td style={{ fontWeight: 600, color: d.harshBraking > 3 ? '#CC0000' : 'var(--cd-text)' }}>
                  {d.harshBraking}
                </td>
                <td>{d.overspeeding}</td>
                <td>{d.harshAcceleration}</td>
                <td>{d.harshCornering}</td>
                <td style={{ fontWeight: 700 }}>{d.total.toLocaleString()}</td>
                <td>
                  <span style={{
                    padding: '2px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 700,
                    background: `${riskColor}15`, color: riskColor,
                  }}>
                    {risk}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <TablePaginationBar
        from={pagination.from}
        to={pagination.to}
        total={pagination.total}
        page={pagination.page}
        pageCount={pagination.pageCount}
        hasPrev={pagination.hasPrev}
        hasNext={pagination.hasNext}
        prev={pagination.prev}
        next={pagination.next}
      />
    </div>
  );
}

type TrackingSortKey = 'driver' | 'vehicle' | 'score';

function PatternsTab({
  dateRange,
  customFrom,
  customTo,
  vehicles,
  selectedSites,
}: {
  dateRange: DateRange;
  customFrom: string;
  customTo: string;
  vehicles: ReturnType<typeof useFleet>['vehicles'];
  selectedSites: string[];
}) {
  // Distance baseline stays a fixed current+last month window regardless of the
  // selected tab range — tying it to the page's date filter (as a prior change
  // briefly did) shrinks the km denominator for narrow ranges and pushes far
  // more drivers out of "Green".
  const { tripDrivers, loading: tripLoading } = useAssessmentTripDrivers();
  const [occurrences] = useState<OccurrenceStore>(() => loadConsequenceOccurrences());
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandEvents, setExpandEvents] = useState<Record<string, LogEntry[]>>({});
  const [expandLoading, setExpandLoading] = useState<Record<string, boolean>>({});
  const navigateTo = useNavigate();

  const periodRiskUrl = incidentRiskDriversUrl(dateRange, customFrom, customTo);
  const windowRiskUrl = incidentRiskDriversUrl('7days');
  const [periodRisk, setPeriodRisk] = useState<RiskDriverRow[]>(() =>
    cachePeek<{ drivers?: RiskDriverRow[] }>(periodRiskUrl)?.drivers ?? [],
  );
  const [windowRisk, setWindowRisk] = useState<RiskDriverRow[]>(() =>
    cachePeek<{ drivers?: RiskDriverRow[] }>(windowRiskUrl)?.drivers ?? [],
  );
  const [riskLoading, setRiskLoading] = useState(() =>
    !cachePeek(periodRiskUrl) || !cachePeek(windowRiskUrl),
  );
  // Keep showing cached rows on revisit — only skeleton when we have nothing to paint.
  const busy = (riskLoading || tripLoading)
    && periodRisk.length === 0
    && tripDrivers.length === 0;

  useEffect(() => {
    let cancelled = false;
    const periodUrl = incidentRiskDriversUrl(dateRange, customFrom, customTo);
    const winUrl = incidentRiskDriversUrl('7days');
    const periodCached = cachePeek<{ drivers?: RiskDriverRow[] }>(periodUrl);
    const winCached = cachePeek<{ drivers?: RiskDriverRow[] }>(winUrl);
    if (periodCached?.drivers) setPeriodRisk(periodCached.drivers);
    if (winCached?.drivers) setWindowRisk(winCached.drivers);
    // Only block the UI when neither request has cached payload yet.
    const hasCache = !!(periodCached?.drivers && winCached?.drivers);
    setRiskLoading(!hasCache);
    setExpandEvents({});
    setExpandLoading({});

    Promise.all([
      authCachedJson<{ drivers?: RiskDriverRow[] }>(periodUrl, authFetch, {
        ttlMs: CACHE_TTL.riskDrivers,
      }),
      authCachedJson<{ drivers?: RiskDriverRow[] }>(winUrl, authFetch, {
        ttlMs: CACHE_TTL.riskDrivers,
      }),
    ])
      .then(([period, win]) => {
        if (cancelled) return;
        if (period?.drivers) setPeriodRisk(period.drivers);
        if (win?.drivers) setWindowRisk(win.drivers);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRiskLoading(false);
      });
    return () => { cancelled = true; };
  }, [dateRange, customFrom, customTo]);

  const scopedTripDrivers = useMemo(
    () => selectedSites.length ? filterTripDriversByVehicles(tripDrivers, vehicles) : tripDrivers,
    [selectedSites.length, tripDrivers, vehicles],
  );

  const distanceByKey = useMemo(() => tripStatsByDriverKey(scopedTripDrivers), [scopedTripDrivers]);

  const windowTotalsByKey = useMemo(() => {
    const map = new Map<string, number>();
    windowRisk.forEach(row => {
      const name = row.driverName || '';
      if (!isActiveDriver(name, row.driverId)) return;
      const key = (row.driverId && isActiveDriverId(row.driverId)) ? row.driverId : name;
      map.set(key, row.total || 0);
      if (name && name !== key) map.set(name, row.total || 0);
    });
    return map;
  }, [windowRisk]);

  const trackingRows = useMemo(() => {
    const byDriver = new Map<string, {
      key: string;
      name: string;
      counts: { harshBraking: number; harshAccel: number; overspeeding: number; cornering: number };
    }>();

    periodRisk.forEach(row => {
      const name = row.driverName || 'N/A';
      if (!isActiveDriver(name, row.driverId)) return;
      const key = (row.driverId && isActiveDriverId(row.driverId)) ? row.driverId : name;
      byDriver.set(key, {
        key,
        name,
        counts: {
          harshBraking: row.harshBraking || 0,
          harshAccel: row.harshAcceleration || 0,
          overspeeding: (row.overspeeding || 0) + (row.overspeedTiered || 0),
          cornering: row.harshCornering || 0,
        },
      });
    });

    scopedTripDrivers.forEach(t => {
      const key = (t.driverId && isActiveDriverId(t.driverId)) ? t.driverId : t.driverName;
      if (!byDriver.has(key)) {
        byDriver.set(key, {
          key,
          name: t.driverName,
          counts: { harshBraking: 0, harshAccel: 0, overspeeding: 0, cornering: 0 },
        });
      }
    });

    return Array.from(byDriver.values())
      .map(row => {
        const trip = distanceByKey.get(row.key) || distanceByKey.get((row.name || '').trim());
        const distanceKm = trip?.km || 0;
        const preliminary = buildDriverConsequenceCard({ counts: row.counts, distanceKm });
        const occurrenceIndex = nextOccurrenceIndex(occurrences, row.key, preliminary.category);
        const consequence = buildDriverConsequenceCard({
          counts: row.counts,
          distanceKm,
          occurrenceIndex,
        });
        const loggedCount = getOccurrenceCount(occurrences, row.key, consequence.category);
        const windowEventCount = windowTotalsByKey.get(row.key)
          ?? windowTotalsByKey.get((row.name || '').trim())
          ?? 0;
        return { ...row, distanceKm, consequence, loggedCount, windowEventCount };
      })
      .filter(r =>
        r.consequence.displayScore <= COACHING_SCORE_THRESHOLD ||
        r.windowEventCount > RESPONSE_TRACKING_EVENT_COUNT
      )
      .sort((a, b) => a.consequence.displayScore - b.consequence.displayScore);
  }, [periodRisk, scopedTripDrivers, distanceByKey, occurrences, windowTotalsByKey]);

  const responseSummary = useMemo(() => {
    return trackingRows.reduce((acc, row) => {
      acc.total += row.consequence.counts.eventCount;
      acc.harshBraking += row.consequence.counts.harshBraking;
      acc.overspeeding += row.consequence.counts.overspeeding;
      acc.harshAccel += row.consequence.counts.harshAccel;
      return acc;
    }, { total: 0, harshBraking: 0, overspeeding: 0, harshAccel: 0 });
  }, [trackingRows]);

  const responseKpis = [
    { label: 'Total Events', value: responseSummary.total, color: 'var(--cd-text)' },
    { label: 'Harsh Braking', value: responseSummary.harshBraking, color: '#CC0000' },
    { label: 'Overspeeding', value: responseSummary.overspeeding, color: '#9333ea' },
    { label: 'Harsh Accel.', value: responseSummary.harshAccel, color: '#0078D4' },
  ];

  const goToCoaching = (driverName: string) => {
    const q = driverName.trim();
    navigateTo(`/drivers/coaching?q=${encodeURIComponent(q)}&open=${encodeURIComponent(q)}`);
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return trackingRows;
    return trackingRows.filter(r => r.name.toLowerCase().includes(q) || r.consequence.categoryLabel.toLowerCase().includes(q));
  }, [trackingRows, search]);

  const getSortValue = (row: typeof trackingRows[number], key: TrackingSortKey) => {
    if (key === 'driver') return row.name;
    if (key === 'vehicle') return row.distanceKm;
    return row.consequence.displayScore;
  };
  const { sorted, toggle: toggleSort, ariaSort, indicator } = useTableSort(filteredRows, getSortValue);
  const pagination = useClientPagination(
    sorted,
    DRIVER_TABLE_PAGE_SIZE,
    `${dateRange}|${customFrom}|${customTo}|${search}`,
  );

  const loadExpandEvents = (row: { key: string; name: string }) => {
    if (expandEvents[row.key] || expandLoading[row.key]) return;
    const url = incidentPatternsEventsUrl(dateRange, row.name, customFrom, customTo);
    const cached = cachePeek<{ entries?: LogEntry[] } | LogEntry[]>(url);
    if (cached) {
      const rows = Array.isArray(cached) ? cached : cached.entries ?? [];
      setExpandEvents(prev => ({ ...prev, [row.key]: filterOverspeedEvents(rows).slice(0, 10) }));
      return;
    }
    setExpandLoading(prev => ({ ...prev, [row.key]: true }));
    authCachedJson<{ entries?: LogEntry[] } | LogEntry[]>(url, authFetch, { ttlMs: CACHE_TTL.fleetEvents })
      .then(data => {
        const rows = !data ? [] : Array.isArray(data) ? data : data.entries ?? [];
        setExpandEvents(prev => ({ ...prev, [row.key]: filterOverspeedEvents(rows).slice(0, 10) }));
      })
      .catch(() => {
        setExpandEvents(prev => ({ ...prev, [row.key]: [] }));
      })
      .finally(() => {
        setExpandLoading(prev => ({ ...prev, [row.key]: false }));
      });
  };

  const toggleExpanded = (row: { key: string; name: string }) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(row.key)) n.delete(row.key);
      else {
        n.add(row.key);
        loadExpandEvents(row);
      }
      return n;
    });
  };

  return (
    <div>
      <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {responseKpis.map(s => (
          <div key={s.label} className="bpl-kpi-card">
            <div className="bpl-kpi-label">{s.label}</div>
            <div className="bpl-kpi-value" style={{ color: s.color, fontSize: 28 }}>
              {busy ? <SkelValue wide /> : s.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <div className="bpl-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <ClipboardCheck size={16} color="#0078D4" />
          <Link
            to="/settings/scoring#driver-discipline"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)',
              textDecoration: 'none',
            }}
            title="Open consequence settings"
          >
            Consequence Response Tracking
            <ExternalLink size={13} color="#0078D4" aria-hidden />
          </Link>
        </div>
        <p style={{ fontSize: 13, color: 'var(--cd-text-muted)', margin: 0 }}>
          Drivers requiring response by score or recent scored-event frequency.
        </p>
      </div>

      <div className="bpl-card bpl-fatigue-toolbar" style={{ marginBottom: 16 }}>
        <div className="bpl-fatigue-search">
          <Search size={15} />
          <input
            type="search"
            placeholder="Search driver or category…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search response drivers"
          />
        </div>
        <div style={{ fontSize: 13, color: 'var(--cd-text-muted)', marginLeft: 'auto' }}>
          {busy ? <SkelValue /> : `${sorted.length} driver${sorted.length === 1 ? '' : 's'}`}
        </div>
      </div>

      <div className="bpl-card bpl-table-scroll" style={{ padding: 0 }}>
        <table className="bpl-dispatch-table bpl-fatigue-table">
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              {([
                { key: 'driver' as const, label: 'Driver' },
                { key: 'vehicle' as const, label: 'Distance' },
                { key: 'score' as const, label: 'Score' },
              ]).map(col => (
                <th
                  key={col.key}
                  aria-sort={ariaSort(col.key)}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort(col.key)}
                >
                  {col.label}{indicator(col.key)}
                </th>
              ))}
              <th>Category</th>
              <th>Recommended consequence</th>
              <th style={{ width: 120 }}> </th>
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={7} style={{ padding: 12 }}><SkelTable rows={6} /></td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--cd-text-muted)' }}>
                  No Amber, Yellow, or Red drivers in this date range
                </td>
              </tr>
            ) : pagination.pageRows.map(row => {
              const { consequence } = row;
              const color = consequence.categoryColor;
              const open = expanded.has(row.key);
              const recent = expandEvents[row.key] ?? [];
              const recentBusy = !!expandLoading[row.key];
              return (
                <Fragment key={row.key}>
                  <tr onClick={() => toggleExpanded(row)} aria-expanded={open} style={{ cursor: 'pointer' }}>
                    <td style={{ color: 'var(--cd-text-muted)' }}>
                      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </td>
                    <td style={{ fontWeight: 600 }}>{displayDriverName(row.name)}</td>
                    <td>
                        <div>{Math.round(row.distanceKm).toLocaleString()} km</div>
                        <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>
                          {row.windowEventCount} recent scored events
                        </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color }}>{consequence.displayScore}</span>
                      <span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}> /100</span>
                    </td>
                    <td>
                      <span style={{
                        padding: '3px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 700,
                        background: `${color}15`, color,
                      }}>
                        {consequence.categoryLabel}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 280 }}>
                      {consequence.occurrenceIndex === 1 ? '1st' : '2nd+'} occurrence: {consequence.recommendedConsequence}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="bpl-btn-secondary"
                        onClick={e => { e.stopPropagation(); goToCoaching(row.name); }}
                        style={{ fontSize: 11, padding: '4px 8px' }}
                      >
                        Make comment
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={7} style={{ padding: '12px 16px 16px 48px', background: 'var(--cd-bg, var(--cd-surface))' }}>
                        <div style={{
                          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                          gap: 10, maxWidth: 560, marginBottom: 14,
                        }}>
                          {[
                            { label: 'Penalty points', value: consequence.penaltyPoints },
                            { label: 'Score / 100 km', value: consequence.driverScore.toFixed(1) },
                            { label: 'Occurrences logged', value: row.loggedCount },
                          ].map(s => (
                            <div key={s.label} style={{
                              padding: '8px 10px', borderRadius: 8, background: 'var(--cd-surface-2)',
                              border: '1px solid var(--cd-border)',
                            }}>
                              <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cd-text)', marginTop: 2 }}>{s.value}</div>
                            </div>
                          ))}
                        </div>

                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                          Recent events
                        </div>
                        {recentBusy ? (
                          <div style={{ marginBottom: 14 }}><SkelTable rows={3} /></div>
                        ) : recent.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 14 }}>No recent events in this range.</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 560, marginBottom: 14 }}>
                            {recent.map((e, i) => (
                              <div key={e.eventId || i} style={{ padding: '8px 10px', background: 'var(--cd-surface)', borderRadius: 8, border: '1px solid var(--cd-border)', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: EVENT_COLORS[getLabel(e)] || 'var(--cd-text)' }}>{getLabel(e)}</span>
                                <span style={{ fontSize: 11, color: 'var(--cd-text-muted)', flex: 1 }}>{e.address || '—'}</span>
                                <span style={{ fontSize: 11, color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
                                  {e.eventTime ? new Date(e.eventTime).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                          Response history
                        </div>
                        {getResponseLogForDriver(row.key).length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>No responses logged yet.</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 560 }}>
                            {getResponseLogForDriver(row.key).map(entry => (
                              <div key={entry.id} style={{ padding: '8px 10px', background: 'var(--cd-surface)', borderRadius: 8, border: '1px solid var(--cd-border)' }}>
                                <div style={{ fontSize: 12, color: 'var(--cd-text)' }}>{entry.note}</div>
                                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 4 }}>
                                  {entry.loggedBy} · {entry.category} occurrence {entry.occurrenceIndex} · {new Date(entry.loggedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <TablePaginationBar
          from={pagination.from}
          to={pagination.to}
          total={pagination.total}
          page={pagination.page}
          pageCount={pagination.pageCount}
          hasPrev={pagination.hasPrev}
          hasNext={pagination.hasNext}
          prev={pagination.prev}
          next={pagination.next}
        />
      </div>
    </div>
  );
}

export default function IncidentIntelligence({ tab }: { tab: Tab }) {
  const [searchParams] = useSearchParams();
  const highlightEventId = searchParams.get('event');
  const assetIdParam = searchParams.get('assetId');
  const querySearch = searchParams.get('q') ?? '';
  const viewParam = searchParams.get('view');
  const rangeParam = searchParams.get('range');
  const initialDateRange: DateRange =
    rangeParam === 'today' || rangeParam === '7days' || rangeParam === '30days'
      ? rangeParam
      : rangeParam === 'alltime'
        ? '7days'
        : '7days';
  const [dateRange, setDateRange] = useState<DateRange>(initialDateRange);
  const [customRange, setCustomRange] = useState(defaultPageCustomRange);
  const [eventsView, setEventsView] = useState<EventsView>(viewParam === 'trends' ? 'trends' : 'events');
  const { vehicles, selectedSites } = useFleet();

  const summaryUrl = incidentSummaryUrl(dateRange, customRange.from, customRange.to);
  const [summaryExposure, setSummaryExposure] = useState(() =>
    cachePeek<{ incidentTotal?: number; byLabel?: Record<string, number> }>(summaryUrl),
  );
  const [summaryLoading, setSummaryLoading] = useState(() => !cachePeek(summaryUrl));

  useEffect(() => {
    let cancelled = false;
    const url = incidentSummaryUrl(dateRange, customRange.from, customRange.to);
    const cached = cachePeek<{ incidentTotal?: number; byLabel?: Record<string, number> }>(url);
    if (cached) {
      setSummaryExposure(cached);
      setSummaryLoading(false);
    } else {
      setSummaryLoading(true);
    }
    authCachedJson<{ incidentTotal?: number; byLabel?: Record<string, number> }>(url, authFetch, {
      ttlMs: CACHE_TTL.safetySummary,
    })
      .then(data => {
        if (cancelled || !data) return;
        setSummaryExposure(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => { cancelled = true; };
  }, [dateRange, customRange.from, customRange.to]);

  useEffect(() => {
    if (rangeParam === 'today' || rangeParam === '7days' || rangeParam === '30days' || rangeParam === 'alltime') {
      setDateRange(rangeParam === 'alltime' ? '7days' : rangeParam);
    }
  }, [rangeParam]);

  useEffect(() => {
    if (viewParam === 'trends') setEventsView('trends');
  }, [viewParam]);

  useEffect(() => {
    if (!highlightEventId || tab !== 'events') return;
    setDateRange('7days');
  }, [highlightEventId, tab]);

  const byLabel = summaryExposure?.byLabel || {};
  const summaryKpis = [
    { label: 'Total Events', value: summaryExposure?.incidentTotal ?? 0, color: 'var(--cd-text)' },
    { label: 'Harsh Braking', value: byLabel['Harsh Braking'] ?? 0, color: '#CC0000' },
    { label: 'Overspeeding', value: sumOverspeedFamily(byLabel), color: '#9333ea' },
    { label: 'Harsh Accel.', value: byLabel['Harsh Acceleration'] ?? 0, color: '#0078D4' },
  ];

  const TAB_TITLES: Record<Tab, string> = {
    'events': 'Event Explorer',
    'by-driver': 'By Driver',
    'patterns': 'Response Tracking',
  };

  return (
    <div>
      <div className="bpl-page-header bpl-page-header-row">
        <div>
          {tab === 'events' ? (
            <>
              <h1 className="bpl-page-title">
                <AlertTriangle size={18} color="#c8102e" style={{ display: 'inline', marginRight: 8, verticalAlign: -3 }} />
                Event Explorer <MockNamesBadge />
              </h1>
              <p className="bpl-page-subtitle">Fleet events and trend analysis</p>
            </>
          ) : (
            <>
              <h1 className="bpl-page-title">Incident Intelligence — {TAB_TITLES[tab]} <MockNamesBadge /></h1>
              <p className="bpl-page-subtitle">Investigate and understand safety events across the fleet</p>
            </>
          )}
        </div>
        {tab !== 'events' && (
          <PagePeriodBar
            value={dateRange}
            onChange={next => {
              setDateRange(next);
              if (next === 'custom') {
                ensureCustomRangeDefaults(
                  customRange.from,
                  customRange.to,
                  f => setCustomRange(r => ({ ...r, from: f.slice(0, 10) })),
                  t => setCustomRange(r => ({ ...r, to: t.slice(0, 10) })),
                );
              }
            }}
            customFrom={customRange.from}
            customTo={customRange.to}
            onCustomFromChange={f => setCustomRange(r => ({ ...r, from: f }))}
            onCustomToChange={t => setCustomRange(r => ({ ...r, to: t }))}
            stackedCustom
          />
        )}
      </div>

      {tab !== 'patterns' && tab !== 'events' && (
        <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {summaryKpis.map(s => (
            <div key={s.label} className="bpl-kpi-card">
              <div className="bpl-kpi-label">{s.label}</div>
              <div className="bpl-kpi-value" style={{ color: s.color, fontSize: 28 }}>
                {summaryLoading && !summaryExposure ? <SkelValue wide /> : s.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'events' && (
        <EventsTab
          dateRange={dateRange}
          customFrom={customRange.from}
          customTo={customRange.to}
          onDateRangeChange={setDateRange}
          onCustomFromChange={f => setCustomRange(r => ({ ...r, from: f }))}
          onCustomToChange={t => setCustomRange(r => ({ ...r, to: t }))}
          eventsView={eventsView}
          onEventsViewChange={setEventsView}
          highlightEventId={highlightEventId}
          initialSearch={querySearch}
          initialAssetId={assetIdParam}
        />
      )}
      {tab === 'by-driver' && <ByDriverTab dateRange={dateRange} customFrom={customRange.from} customTo={customRange.to} />}
      {tab === 'patterns' && (
        <PatternsTab
          dateRange={dateRange}
          customFrom={customRange.from}
          customTo={customRange.to}
          vehicles={vehicles}
          selectedSites={selectedSites}
        />
      )}
    </div>
  );
}
