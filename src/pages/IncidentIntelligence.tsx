import { useState, useMemo, useEffect, useCallback, useDeferredValue, Fragment } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, ClipboardCheck, ChevronDown, ChevronRight, X, ExternalLink } from 'lucide-react';
import { useFleet, authFetch } from '../context/FleetContext';
import type { LogEntry, TripDriver } from '../context/FleetContext';
import { useAuth } from '../context/AuthContext';
import { isKnownDriver, displayDriverName, isActiveDriver, isActiveDriverId } from '../lib/driverUtils';
import { sanitizeTripDriver } from '../lib/demoSanitize';
import {
  buildDriverConsequenceCard,
  loadConsequenceOccurrences,
  logConsequenceResponse,
  nextOccurrenceIndex,
  getOccurrenceCount,
  getResponseLogForDriver,
  addResponseLogEntry,
  type OccurrenceStore,
  type ConsequenceCategory,
} from '../lib/consequenceScore';
import { brandLabel, eventLocationLabel } from '../lib/branding';
import MockNamesBadge from '../components/MockNamesBadge';
import { SkelValue, SkelTable } from '../components/data/DataBusy';
import { useClientPagination } from '../hooks/useClientPagination';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTableSort } from '../hooks/useTableSort';

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

function getLabel(e: LogEntry) {
  return e.label || 'Unknown';
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

function EventsTab({ events, busy }: { events: LogEntry[]; busy: boolean }) {
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  const initialFilter: EventFilter =
    filterParam && (EVENT_FILTERS as string[]).includes(filterParam)
      ? (filterParam as EventFilter)
      : 'All';
  const [search, setSearch] = useState('');
  const [eventFilter, setEventFilter] = useState<EventFilter>(initialFilter);
  const debouncedSearch = useDebouncedValue(search, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);

  const filtered = events.filter(e => {
    if (e.type === 'panic') return false;
    const label = getLabel(e);
    if (HIDDEN_LABELS.includes(label)) return false;
    if (eventFilter !== 'All' && label !== eventFilter) return false;
    if (deferredSearch) {
      const s = deferredSearch.toLowerCase();
      return (
        (e.driverName || '').toLowerCase().includes(s) ||
        (e.regNo || '').toLowerCase().includes(s) ||
        (e.assetName || '').toLowerCase().includes(s) ||
        label.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const pagination = useClientPagination(filtered, 100);

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

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {busy ? (
          <div style={{ padding: 8 }}><SkelTable rows={8} /></div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cd-text-muted)', fontSize: 13 }}>
            No events match your filters
          </div>
        ) : pagination.pageRows.map((e, i) => {
          const label = getLabel(e);
          const color = EVENT_COLORS[label] || 'var(--cd-text-muted)';
          const location = eventLocationLabel(e);
          const hasDriver = isKnownDriver(e.driverName);
          return (
            <div key={i} style={{
              padding: '10px 12px', borderRadius: 8,
              border: `0.5px solid ${color}40`,
              backgroundColor: `${color}0d`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color }}>{label}</span>
                <span style={{ fontSize: 10, color: 'var(--cd-text-soft, var(--cd-text-muted))' }}>{formatTime(e.eventTime || e.timestamp)}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--cd-text)', marginBottom: 2 }}>{e.regNo || e.assetId}</div>
              {e.assetName && e.assetName !== 'N/A' && (
                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 2 }}>{e.assetName}</div>
              )}
              {e.transporter && e.transporter !== 'N/A' && (
                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 2 }}>{brandLabel(e.transporter)}</div>
              )}
              {hasDriver && (
                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: location ? 2 : 0 }}>
                  {displayDriverName(e.driverName)}
                </div>
              )}
              {location && <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{location}</div>}
            </div>
          );
        })}
      </div>

      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--cd-border)', fontSize: 11, color: 'var(--cd-text-muted)', textAlign: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>{pagination.total === 0 ? 'No events' : `Showing ${pagination.from}–${pagination.to} of ${pagination.total}`}</span>
          {pagination.pageCount > 1 && (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                disabled={!pagination.hasPrev}
                onClick={pagination.prev}
                style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 11, cursor: pagination.hasPrev ? 'pointer' : 'default',
                  border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)',
                  color: pagination.hasPrev ? 'var(--cd-text)' : 'var(--cd-text-soft, var(--cd-text-muted))',
                }}
              >
                Prev
              </button>
              <span>Page {pagination.page + 1} / {pagination.pageCount}</span>
              <button
                type="button"
                disabled={!pagination.hasNext}
                onClick={pagination.next}
                style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 11, cursor: pagination.hasNext ? 'pointer' : 'default',
                  border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)',
                  color: pagination.hasNext ? 'var(--cd-text)' : 'var(--cd-text-soft, var(--cd-text-muted))',
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

function ByDriverTab({ events, busy }: { events: LogEntry[]; busy: boolean }) {
  const driverMap = useMemo(() => {
    const m = new Map<string, { name: string; counts: Record<string, number>; total: number }>();
    events.forEach(e => {
      if (e.type === 'panic') return;
      const label = getLabel(e);
      if (HIDDEN_LABELS.includes(label)) return;
      if (!isKnownDriver(e.driverName)) return;
      const key = e.driverName!;
      if (!m.has(key)) m.set(key, { name: key, counts: {}, total: 0 });
      const d = m.get(key)!;
      d.counts[label] = (d.counts[label] || 0) + 1;
      d.total++;
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [events]);

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
          {busy ? (
            <tr><td colSpan={8} style={{ padding: 12 }}><SkelTable rows={8} /></td></tr>
          ) : driverMap.slice(0, 30).map((d, i) => {
            const risk = d.total > 10 ? 'HIGH' : d.total > 5 ? 'MEDIUM' : 'LOW';
            const riskColor = risk === 'HIGH' ? '#CC0000' : risk === 'MEDIUM' ? '#d97706' : '#16a34a';
            return (
              <tr key={d.name}>
                <td style={{ fontWeight: 700, color: 'var(--cd-text-muted)' }}>#{i + 1}</td>
                <td style={{ fontWeight: 600 }}>{d.name}</td>
                <td style={{ fontWeight: 600, color: (d.counts['Harsh Braking'] || 0) > 3 ? '#CC0000' : 'var(--cd-text)' }}>
                  {d.counts['Harsh Braking'] || 0}
                </td>
                <td>{(d.counts['Overspeeding'] || 0) + (d.counts['Overspeed Tiered'] || 0)}</td>
                <td>{d.counts['Harsh Acceleration'] || 0}</td>
                <td>{d.counts['Harsh Cornering'] || 0}</td>
                <td style={{ fontWeight: 700 }}>{d.total}</td>
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

function PatternsTab({ events, eventsBusy }: { events: LogEntry[]; eventsBusy: boolean }) {
  const { user } = useAuth();
  const loggedInAs = user?.name || user?.email || 'You';
  const [tripDrivers, setTripDrivers] = useState<TripDriver[]>([]);
  const [tripLoading, setTripLoading] = useState(true);
  const [occurrences, setOccurrences] = useState<OccurrenceStore>(() => loadConsequenceOccurrences());
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingLogKey, setPendingLogKey] = useState<string | null>(null);
  const [responseNote, setResponseNote] = useState('');
  const [, setLogRefreshTick] = useState(0);
  const busy = eventsBusy || tripLoading;

  useEffect(() => {
    let cancelled = false;
    setTripLoading(true);
    (async () => {
      try {
        const [cur, last] = await Promise.all([
          authFetch('/api/driver-distance?range=currentMonth'),
          authFetch('/api/driver-distance?range=lastMonth'),
        ]);
        const map = new Map<string, TripDriver>();
        for (const res of [cur, last]) {
          if (!res.ok) continue;
          const data = await res.json();
          for (const d of (data.drivers || []) as TripDriver[]) {
            if (!isActiveDriver(d.driverName, d.driverId)) continue;
            const key = d.driverId || d.driverName;
            if (!key) continue;
            const prev = map.get(key);
            if (!prev) map.set(key, sanitizeTripDriver({ ...d, totalDrivingTimeSeconds: d.totalDrivingTimeSeconds || 0 }));
            else {
              prev.totalDistanceKm += d.totalDistanceKm;
              prev.journeyCount += d.journeyCount;
              prev.totalDrivingTimeSeconds = (prev.totalDrivingTimeSeconds || 0) + (d.totalDrivingTimeSeconds || 0);
              prev.vehicles = Array.from(new Set([...prev.vehicles, ...d.vehicles]));
            }
          }
        }
        if (!cancelled) setTripDrivers(Array.from(map.values()));
      } catch { /* keep empty */ }
      finally {
        if (!cancelled) setTripLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const distanceByKey = useMemo(() => {
    const m = new Map<string, number>();
    tripDrivers.forEach(t => {
      const key = (t.driverId && isActiveDriverId(t.driverId)) ? t.driverId : t.driverName;
      m.set(key, (m.get(key) || 0) + (t.totalDistanceKm || 0));
    });
    return m;
  }, [tripDrivers]);

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
    tripDrivers.forEach(t => {
      const key = (t.driverId && isActiveDriverId(t.driverId)) ? t.driverId : t.driverName;
      if (!byDriver.has(key)) byDriver.set(key, { key, name: t.driverName, events: [] });
    });

    return Array.from(byDriver.values())
      .map(row => {
        const distanceKm = distanceByKey.get(row.key) || 0;
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
  }, [events, tripDrivers, distanceByKey, occurrences]);

  const openLogForm = (driverKey: string) => {
    setPendingLogKey(driverKey);
    setResponseNote('');
  };

  const cancelLogForm = () => {
    setPendingLogKey(null);
    setResponseNote('');
  };

  const confirmLogResponse = useCallback((
    driverKey: string,
    driverName: string,
    category: ConsequenceCategory,
    occurrenceIndex: number,
  ) => {
    const note = responseNote.trim();
    if (!note) return;
    setOccurrences(prev => logConsequenceResponse(prev, driverKey, category));
    addResponseLogEntry(driverKey, driverName, category, occurrenceIndex, note, loggedInAs);
    setPendingLogKey(null);
    setResponseNote('');
    setLogRefreshTick(t => t + 1);
  }, [responseNote, loggedInAs]);

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
            to="/settings/thresholds#consequence-bands"
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
          Amber / Yellow / Red drivers by Consequence Management score (penalty points ÷ km/100).
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
                      {pendingLogKey === row.key ? (
                        <button
                          type="button"
                          className="bpl-btn-secondary"
                          onClick={e => { e.stopPropagation(); cancelLogForm(); }}
                          style={{ fontSize: 11, padding: '4px 8px' }}
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="bpl-btn-secondary"
                          onClick={e => { e.stopPropagation(); openLogForm(row.key); }}
                          style={{ fontSize: 11, padding: '4px 8px' }}
                        >
                          Log response
                        </button>
                      )}
                    </td>
                  </tr>
                  {pendingLogKey === row.key && (
                    <tr>
                      <td colSpan={7} style={{ padding: '10px 16px 12px 48px', background: 'var(--cd-bg, var(--cd-surface))' }}>
                        <div
                          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', maxWidth: 720 }}
                          onClick={e => e.stopPropagation()}
                        >
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cd-text-muted)' }}>
                            What response was taken for {displayDriverName(row.name)}?
                          </span>
                          <input
                            type="text"
                            value={responseNote}
                            onChange={e => setResponseNote(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') confirmLogResponse(row.key, row.name, consequence.category, consequence.occurrenceIndex); }}
                            placeholder="e.g. Verbal warning given, driver acknowledged"
                            autoFocus
                            style={{
                              flex: '1 1 260px', padding: '7px 10px', borderRadius: 8,
                              border: '1px solid var(--cd-border)', background: 'var(--cd-surface)',
                              color: 'var(--cd-text)', fontSize: 13,
                            }}
                          />
                          <button
                            type="button"
                            className="bpl-btn-primary"
                            disabled={!responseNote.trim()}
                            onClick={() => confirmLogResponse(row.key, row.name, consequence.category, consequence.occurrenceIndex)}
                            style={{ fontSize: 12, padding: '7px 12px', opacity: responseNote.trim() ? 1 : 0.6 }}
                          >
                            Confirm log
                          </button>
                          <button
                            type="button"
                            className="bpl-btn-secondary"
                            onClick={cancelLogForm}
                            style={{ fontSize: 12, padding: '7px 12px' }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
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
  const [dateRange, setDateRange] = useState<DateRange>('7days');
  const { events, eventsLoading } = useFleet();

  const filtered = useMemo(
    () => events.filter(e => getDateFilter(e, dateRange)),
    [events, dateRange],
  );

  const summaryKpis = useMemo(() => {
    let total = 0;
    let harshBraking = 0;
    let overspeeding = 0;
    let harshAccel = 0;
    for (const e of filtered) {
      if (e.type === 'panic') continue;
      const label = getLabel(e);
      if (HIDDEN_LABELS.includes(label)) continue;
      total++;
      if (label === 'Harsh Braking') harshBraking++;
      else if (label === 'Overspeeding' || label === 'Overspeed Tiered') overspeeding++;
      else if (label === 'Harsh Acceleration') harshAccel++;
    }
    return [
      { label: 'Total Events', value: total, color: 'var(--cd-text)' },
      { label: 'Harsh Braking', value: harshBraking, color: '#CC0000' },
      { label: 'Overspeeding', value: overspeeding, color: '#9333ea' },
      { label: 'Harsh Accel.', value: harshAccel, color: '#0078D4' },
    ];
  }, [filtered]);

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
              {eventsLoading ? <SkelValue wide /> : s.value}
            </div>
          </div>
        ))}
      </div>

      {tab === 'events' && <EventsTab events={filtered} busy={eventsLoading} />}
      {tab === 'by-driver' && <ByDriverTab events={filtered} busy={eventsLoading} />}
      {tab === 'patterns' && <PatternsTab events={filtered} eventsBusy={eventsLoading} />}
    </div>
  );
}
