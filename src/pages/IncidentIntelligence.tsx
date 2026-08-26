import { useState, useMemo, useEffect, useDeferredValue, useRef, Fragment } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Search, ClipboardCheck, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import type { LogEntry } from '../context/FleetContext';
import { isKnownDriver, displayDriverName, isActiveDriver, isActiveDriverId } from '../lib/driverUtils';
import {
  buildDriverConsequenceCard,
  loadConsequenceOccurrences,
  nextOccurrenceIndex,
  getOccurrenceCount,
  getResponseLogForDriver,
  type OccurrenceStore,
  type ConsequenceCategory,
} from '../lib/consequenceScore';
import { brandLabel, eventLocationLabel } from '../lib/branding';
import MockNamesBadge from '../components/MockNamesBadge';
import { SkelValue, SkelTable } from '../components/data/DataBusy';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTableSort } from '../hooks/useTableSort';
import { isOverspeedLabel } from '../lib/overspeedFilter';
import { filterTripDriversByVehicles, summarizeEventsByLabel } from '../lib/siteScope';
import { defaultDriverCustomRange, tripStatsByDriverKey, type DriverPeriod } from '../lib/driverAssessment';
import { usePeriodTripDrivers } from '../hooks/useAssessmentTripDrivers';

type Tab = 'events' | 'by-driver' | 'patterns';
type DateRange = 'today' | '7days' | '30days' | 'alltime';
type EventFilter = 'All' | 'Harsh Braking' | 'Harsh Acceleration' | 'Overspeeding' | 'Overspeed Tiered' | 'Harsh Cornering';

const HIDDEN_LABELS = ['Possible Power Tamper', 'Battery Disconnection', 'Battery Disconnected', 'Front Panel Tamper', 'Back Panel Tamper', 'No Blue Key'];
const EVENT_FILTERS: EventFilter[] = ['All', 'Harsh Braking', 'Harsh Acceleration', 'Overspeeding', 'Overspeed Tiered', 'Harsh Cornering'];

const EVENT_COLORS: Record<string, string> = {
  'Harsh Braking': '#0d9488',
  'Harsh Acceleration': '#0078D4',
  'Overspeeding': '#9333ea',
  'Overspeed Tiered': '#a855f7',
  'Harsh Cornering': '#d97706',
};

const EVENT_PAGE_SIZE = 100;

function getLabel(e: LogEntry) {
  return e.label || 'Unknown';
}

function isoIncidentRange(range: DateRange): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  if (range === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to };
  }
  if (range === '7days') return { from: new Date(now.getTime() - 7 * 86400000).toISOString(), to };
  if (range === '30days') return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), to };
  return { from: '2020-01-01T00:00:00.000Z', to };
}

function getDateFilter(e: LogEntry, range: DateRange) {
  const ts = new Date(e.eventTime || e.timestamp).getTime();
  const now = Date.now();
  if (range === 'today') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return ts >= start.getTime();
  }
  if (range === '7days') return ts >= now - 7 * 24 * 60 * 60 * 1000;
  if (range === '30days') return ts >= now - 30 * 24 * 60 * 60 * 1000;
  return true;
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
  highlightEventId,
  initialSearch,
  events,
  eventsLoading,
}: {
  dateRange: DateRange;
  highlightEventId: string | null;
  initialSearch: string;
  events: LogEntry[];
  eventsLoading: boolean;
}) {
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  const initialFilter: EventFilter =
    !highlightEventId && filterParam && (EVENT_FILTERS as string[]).includes(filterParam)
      ? (filterParam as EventFilter)
      : 'All';
  const [search, setSearch] = useState(initialSearch);
  const [eventFilter, setEventFilter] = useState<EventFilter>(initialFilter);
  const [page, setPage] = useState(0);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const debouncedSearch = useDebouncedValue(search, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);

  useEffect(() => {
    if (!highlightEventId) return;
    setEventFilter('All');
    setSearch('');
    setPage(0);
  }, [highlightEventId]);

  useEffect(() => {
    setPage(0);
  }, [dateRange, eventFilter, deferredSearch]);

  useEffect(() => {
    if (highlightEventId) return;
    setSearch(initialSearch);
    setPage(0);
  }, [highlightEventId, initialSearch]);

  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    return events.filter(e => {
      if (!getDateFilter(e, dateRange)) return false;
      if (e.type === 'panic') return false;
      const label = getLabel(e);
      if (HIDDEN_LABELS.includes(label)) return false;
      if (eventFilter !== 'All' && label !== eventFilter) return false;
      if (highlightEventId && e.eventId === highlightEventId) return true;
      if (q) {
        return (
          (e.driverName || '').toLowerCase().includes(q) ||
          (e.regNo || '').toLowerCase().includes(q) ||
          (e.assetName || '').toLowerCase().includes(q) ||
          label.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [dateRange, deferredSearch, eventFilter, events, highlightEventId]);

  const censusTotal = filtered.length;
  const pageCount = Math.max(1, Math.ceil(censusTotal / EVENT_PAGE_SIZE) || 1);
  const visibleRows = filtered.slice(page * EVENT_PAGE_SIZE, page * EVENT_PAGE_SIZE + EVENT_PAGE_SIZE);

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
  }, [highlightEventId, filtered]);

  return (
    <div className="bpl-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 520, padding: 0 }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--cd-border)', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'var(--cd-text-soft, var(--cd-text-muted))' }} />
          <input
            type="text"
            placeholder="Search driver, vehicle, event..."
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
        {EVENT_FILTERS.map(f => {
          const active = eventFilter === f;
          const color = f === 'All' ? 'var(--bpl-blue)' : (EVENT_COLORS[f] || 'var(--bpl-blue)');
          return (
            <button
              key={f}
              onClick={() => setEventFilter(f)}
              style={{
                padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                border: active ? `0.5px solid ${color}55` : '0.5px solid var(--cd-border)',
                background: active ? `${color}15` : 'var(--cd-surface-2)',
                color: active ? color : 'var(--cd-text-muted)',
              }}
            >
              {f}
            </button>
          );
        })}
      </div>

      <div className="bpl-incident-list" style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {eventsLoading ? (
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
    </div>
  );
}

function ByDriverTab({ dateRange, events, eventsLoading }: { dateRange: DateRange; events: LogEntry[]; eventsLoading: boolean }) {
  const rows = useMemo(() => {
    const byDriver = new Map<string, {
    name: string;
    harshBraking: number;
    overspeeding: number;
    harshAcceleration: number;
    harshCornering: number;
    total: number;
    }>();

    events.forEach(event => {
      if (!getDateFilter(event, dateRange) || event.type === 'panic') return;
      const label = getLabel(event);
      if (HIDDEN_LABELS.includes(label) || !isKnownDriver(event.driverName)) return;
      const key = event.driverId || event.driverName!;
      const row = byDriver.get(key) || {
        name: event.driverName || 'N/A',
        harshBraking: 0,
        overspeeding: 0,
        harshAcceleration: 0,
        harshCornering: 0,
        total: 0,
      };
      if (label === 'Harsh Braking') row.harshBraking += 1;
      if (label === 'Harsh Acceleration') row.harshAcceleration += 1;
      if (label === 'Overspeeding' || label === 'Overspeed Tiered' || label === 'Road Speed Overspeeding') row.overspeeding += 1;
      if (label === 'Harsh Cornering') row.harshCornering += 1;
      row.total += 1;
      byDriver.set(key, row);
    });

    return Array.from(byDriver.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 30);
  }, [dateRange, events]);

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
          {eventsLoading ? (
            <tr><td colSpan={8} style={{ padding: 12 }}><SkelTable rows={8} /></td></tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--cd-text-muted)' }}>
                No driver event data available
              </td>
            </tr>
          ) : rows.map((d, i) => {
            const risk = d.total > 10 ? 'HIGH' : d.total > 5 ? 'MEDIUM' : 'LOW';
            const riskColor = risk === 'HIGH' ? '#CC0000' : risk === 'MEDIUM' ? '#d97706' : '#16a34a';
            return (
              <tr key={d.name}>
                <td style={{ fontWeight: 700, color: 'var(--cd-text-muted)' }}>#{i + 1}</td>
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
    </div>
  );
}

type TrackingSortKey = 'driver' | 'vehicle' | 'score';

function PatternsTab({
  events,
  eventsBusy,
  vehicles,
  selectedSites,
  dateRange,
}: {
  events: LogEntry[];
  eventsBusy: boolean;
  vehicles: ReturnType<typeof useFleet>['vehicles'];
  selectedSites: string[];
  dateRange: DriverPeriod;
}) {
  const { tripDrivers, loading: tripLoading } = usePeriodTripDrivers(dateRange, defaultDriverCustomRange());
  const [occurrences, setOccurrences] = useState<OccurrenceStore>(() => loadConsequenceOccurrences());
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const navigateTo = useNavigate();
  const busy = eventsBusy || tripLoading;

  const scopedTripDrivers = useMemo(
    () => selectedSites.length ? filterTripDriversByVehicles(tripDrivers, vehicles) : tripDrivers,
    [selectedSites.length, tripDrivers, vehicles],
  );

  const distanceByKey = useMemo(() => {
    return tripStatsByDriverKey(scopedTripDrivers);
  }, [scopedTripDrivers]);

  const trackingRows = useMemo(() => {
    const byDriver = new Map<string, { key: string; name: string; events: LogEntry[] }>();

    events.forEach(e => {
      if (e.type === 'panic') return;
      const label = getLabel(e);
      if (HIDDEN_LABELS.includes(label) || label === 'Unknown') return;
      if (!isActiveDriver(e.driverName, e.driverId)) return;
      const key = (e.driverId && isActiveDriverId(e.driverId)) ? e.driverId : e.driverName!;
      if (!byDriver.has(key)) byDriver.set(key, { key, name: e.driverName!, events: [] });
      byDriver.get(key)!.events.push(e);
    });

    // Also include trip drivers with distance even if no events in range (won't show — Green filtered out)
    scopedTripDrivers.forEach(t => {
      const key = (t.driverId && isActiveDriverId(t.driverId)) ? t.driverId : t.driverName;
      if (!byDriver.has(key)) byDriver.set(key, { key, name: t.driverName, events: [] });
    });

    return Array.from(byDriver.values())
      .map(row => {
        const trip = distanceByKey.get(row.key) || distanceByKey.get((row.name || '').trim());
        const distanceKm = trip?.km || 0;
        const preliminary = buildDriverConsequenceCard({ events: row.events, distanceKm });
        const occurrenceIndex = nextOccurrenceIndex(occurrences, row.key, preliminary.category);
        const consequence = buildDriverConsequenceCard({
          events: row.events,
          distanceKm,
          occurrenceIndex,
        });
        const loggedCount = getOccurrenceCount(occurrences, row.key, consequence.category);
        return { ...row, distanceKm, consequence, loggedCount };
      })
      .filter(r => r.consequence.category !== 'Green')
      .sort((a, b) => a.consequence.displayScore - b.consequence.displayScore);
  }, [events, scopedTripDrivers, distanceByKey, occurrences]);

  const goToCoaching = (driverKey: string) => {
    navigateTo(`/drivers/coaching?q=${encodeURIComponent(driverKey)}&open=${encodeURIComponent(driverKey)}`);
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

  const toggleExpanded = (key: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  return (
    <div>
      <div className="bpl-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <ClipboardCheck size={16} color="#0078D4" />
          <Link
            to="/consequence-management"
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
          Amber / Yellow / Red drivers by Consequence/Fatigue Management score (penalty points ÷ km/100).
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
            ) : sorted.map(row => {
              const { consequence } = row;
              const color = consequence.categoryColor;
              const open = expanded.has(row.key);
              return (
                <Fragment key={row.key}>
                  <tr onClick={() => toggleExpanded(row.key)} aria-expanded={open} style={{ cursor: 'pointer' }}>
                    <td style={{ color: 'var(--cd-text-muted)' }}>
                      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </td>
                    <td style={{ fontWeight: 600 }}>{displayDriverName(row.name)}</td>
                    <td>
                      <div>{Math.round(row.distanceKm).toLocaleString()} km</div>
                      <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>{consequence.counts.eventCount} scored events</div>
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
                        onClick={e => { e.stopPropagation(); goToCoaching(row.key); }}
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
      </div>
    </div>
  );
}

export default function IncidentIntelligence({ tab }: { tab: Tab }) {
  const [searchParams] = useSearchParams();
  const highlightEventId = searchParams.get('event');
  const querySearch = searchParams.get('q') ?? '';
  const rangeParam = searchParams.get('range');
  const initialDateRange: DateRange = rangeParam === 'today' || rangeParam === '7days' || rangeParam === '30days' || rangeParam === 'alltime'
    ? rangeParam
    : '7days';
  const [dateRange, setDateRange] = useState<DateRange>(initialDateRange);
  const { events, eventsLoading, vehicles, selectedSites } = useFleet();

  useEffect(() => {
    if (rangeParam === 'today' || rangeParam === '7days' || rangeParam === '30days' || rangeParam === 'alltime') {
      setDateRange(rangeParam);
    }
  }, [rangeParam]);

  useEffect(() => {
    if (!highlightEventId) return;
    const hit = events.find(e => e.eventId === highlightEventId);
    if (!hit) return;
    if (!getDateFilter(hit, dateRange)) setDateRange('alltime');
  }, [highlightEventId, events, dateRange]);

  const patternEvents = useMemo(
    () => events.filter(e => getDateFilter(e, dateRange)),
    [events, dateRange],
  );

  const summary = useMemo(
    () => summarizeEventsByLabel(patternEvents.filter(e => !HIDDEN_LABELS.includes(getLabel(e)))),
    [patternEvents],
  );

  const byLabel = summary.byLabel || {};
  const summaryKpis = [
    { label: 'Total Events', value: summary.incidentTotal ?? 0, color: 'var(--cd-text)' },
    { label: 'Harsh Braking', value: byLabel['Harsh Braking'] ?? 0, color: '#CC0000' },
    { label: 'Overspeeding', value: (byLabel['Overspeeding'] ?? 0) + (byLabel['Overspeed Tiered'] ?? 0) + (byLabel['Road Speed Overspeeding'] ?? 0), color: '#9333ea' },
    { label: 'Harsh Accel.', value: byLabel['Harsh Acceleration'] ?? 0, color: '#0078D4' },
  ];

  const TAB_TITLES: Record<Tab, string> = {
    'events': 'Event Explorer',
    'by-driver': 'By Driver',
    'patterns': 'Response Tracking',
  };

  return (
    <div>
      <div className="bpl-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="bpl-page-title">Incident Intelligence — {TAB_TITLES[tab]} <MockNamesBadge /></h1>
          <p className="bpl-page-subtitle">Investigate and understand safety events across the fleet</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['today', '7days', '30days', 'alltime'] as DateRange[]).map(r => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12,
                border: '1px solid',
                borderColor: dateRange === r ? 'var(--bpl-blue)' : 'var(--cd-border)',
                background: dateRange === r ? 'var(--bpl-blue-soft)' : 'var(--cd-surface)',
                color: dateRange === r ? 'var(--bpl-blue)' : 'var(--cd-text-muted)',
                cursor: 'pointer',
              }}
            >
              {r === 'today' ? 'Today' : r === '7days' ? '7 Days' : r === '30days' ? '30 Days' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {summaryKpis.map(s => (
          <div key={s.label} className="bpl-kpi-card">
            <div className="bpl-kpi-label">{s.label}</div>
            <div className="bpl-kpi-value" style={{ color: s.color, fontSize: 28 }}>
              {eventsLoading ? <SkelValue wide /> : s.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {tab === 'events' && <EventsTab dateRange={dateRange} highlightEventId={highlightEventId} initialSearch={querySearch} events={events} eventsLoading={eventsLoading} />}
      {tab === 'by-driver' && <ByDriverTab dateRange={dateRange} events={events} eventsLoading={eventsLoading} />}
      {tab === 'patterns' && (
        <PatternsTab
          events={patternEvents}
          eventsBusy={eventsLoading}
          vehicles={vehicles}
          selectedSites={selectedSites}
          dateRange={dateRange}
        />
      )}
    </div>
  );
}
