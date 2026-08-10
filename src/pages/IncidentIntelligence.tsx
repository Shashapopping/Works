import { useState, useMemo, useEffect, useCallback, useDeferredValue } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, ClipboardCheck } from 'lucide-react';
import { useFleet, authFetch } from '../context/FleetContext';
import type { LogEntry, TripDriver } from '../context/FleetContext';
import { isKnownDriver, displayDriverName, isActiveDriver, isActiveDriverId } from '../lib/driverUtils';
import {
  buildDriverConsequenceCard,
  loadConsequenceOccurrences,
  logConsequenceResponse,
  nextOccurrenceIndex,
  getOccurrenceCount,
  type OccurrenceStore,
  type ConsequenceCategory,
} from '../lib/consequenceScore';
import MixEventInsightsGrid from '../components/MixEventInsightsGrid';
import { brandLabel, eventLocationLabel } from '../lib/branding';
import { useClientPagination } from '../hooks/useClientPagination';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import PageControls from '../components/PageControls';

type Tab = 'events' | 'by-driver' | 'trends' | 'patterns';
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

function EventsTab({ events }: { events: LogEntry[] }) {
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
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--cd-text-muted)' }} />
          <input
            type="text"
            placeholder="Search driver, vehicle, event..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
              border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 13,
              background: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {EVENT_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setEventFilter(f)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                cursor: 'pointer', border: '1px solid',
                borderColor: eventFilter === f ? 'var(--bpl-blue)' : 'var(--cd-border)',
                background: eventFilter === f ? 'var(--bpl-blue-soft)' : 'var(--cd-surface)',
                color: eventFilter === f ? 'var(--bpl-blue)' : 'var(--cd-text-muted)',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 10 }}>
        {filtered.length} events
      </div>

      <div className="bpl-card" style={{ overflow: 'hidden' }}>
        <table className="bpl-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Driver</th>
              <th>Vehicle</th>
              <th>Transporter</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((e, i) => {
              const label = getLabel(e);
              const color = EVENT_COLORS[label] || 'var(--cd-text-muted)';
              return (
                <tr key={i}>
                  <td style={{ fontSize: 12, color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
                    {formatTime(e.eventTime || e.timestamp)}
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '2px 8px', borderRadius: 9999,
                      background: `${color}15`, color, border: `1px solid ${color}30`,
                      fontSize: 11, fontWeight: 600,
                    }}>
                      {label}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{displayDriverName(e.driverName)}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.regNo || e.assetId}</td>
                  <td style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>{brandLabel(e.transporter) || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--cd-text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={eventLocationLabel(e)}>
                    {eventLocationLabel(e)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>
            No events match your filters
          </div>
        )}
        <PageControls
          page={pagination.page}
          pageCount={pagination.pageCount}
          from={pagination.from}
          to={pagination.to}
          total={pagination.total}
          hasPrev={pagination.hasPrev}
          hasNext={pagination.hasNext}
          onPrev={pagination.prev}
          onNext={pagination.next}
          itemLabel="events"
        />
      </div>
    </div>
  );
}

function ByDriverTab({ events }: { events: LogEntry[] }) {
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
          {driverMap.slice(0, 30).map((d, i) => {
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

function TrendsTab({ events }: { events: LogEntry[] }) {
  return <MixEventInsightsGrid events={events} />;
}

function PatternsTab({ events }: { events: LogEntry[] }) {
  const [tripDrivers, setTripDrivers] = useState<TripDriver[]>([]);
  const [occurrences, setOccurrences] = useState<OccurrenceStore>(() => loadConsequenceOccurrences());

  useEffect(() => {
    let cancelled = false;
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
            if (!prev) map.set(key, { ...d, totalDrivingTimeSeconds: d.totalDrivingTimeSeconds || 0 });
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

  const handleLogResponse = useCallback((driverKey: string, category: ConsequenceCategory) => {
    setOccurrences(prev => logConsequenceResponse(prev, driverKey, category));
  }, []);

  return (
    <div>
      <div className="bpl-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <ClipboardCheck size={16} color="#0078D4" />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
            Consequence Response Tracking
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--cd-text-muted)', margin: 0 }}>
          Amber / Yellow / Red drivers by Consequence Management score (penalty points ÷ km/100).
          Log a response to advance 1st → 2nd occurrence consequences.
        </p>
      </div>

      {trackingRows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--cd-text-muted)', fontSize: 13 }}>
          No Amber, Yellow, or Red drivers in this date range
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {trackingRows.map(row => {
            const { consequence } = row;
            const color = consequence.categoryColor;
            return (
              <div key={row.key} className="bpl-card" style={{ padding: '16px 20px', borderLeft: `4px solid ${color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600, color: 'var(--cd-text)', marginBottom: 4 }}>{row.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>
                      {consequence.counts.eventCount} scored events · {Math.round(row.distanceKm).toLocaleString()} km
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>
                        {consequence.displayScore}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>/100</div>
                    </div>
                    <span style={{
                      padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                      background: `${color}15`, color,
                    }}>
                      {consequence.categoryLabel}
                    </span>
                  </div>
                </div>

                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 10, marginTop: 12,
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

                <div style={{
                  marginTop: 12, padding: '10px 12px', borderRadius: 8,
                  background: `${color}10`, border: `1px solid ${color}25`,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                }}>
                  <div style={{ fontSize: 12, color: 'var(--cd-text)', flex: 1 }}>
                    <span style={{ fontWeight: 700, color }}>Recommended · {consequence.occurrenceIndex === 1 ? '1st' : '2nd+'} occurrence: </span>
                    {consequence.recommendedConsequence}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleLogResponse(row.key, consequence.category)}
                    style={{
                      padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1px solid ${color}50`, background: color, color: '#fff', flexShrink: 0,
                    }}
                  >
                    Log response
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function IncidentIntelligence({ tab }: { tab: Tab }) {
  const [dateRange, setDateRange] = useState<DateRange>('7days');
  const { events } = useFleet();

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
    'trends': 'Trends',
    'patterns': 'Response Tracking',
  };

  return (
    <div>
      <div className="bpl-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="bpl-page-title">Incident Intelligence — {TAB_TITLES[tab]}</h1>
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
            <div className="bpl-kpi-value" style={{ color: s.color, fontSize: 28 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {tab === 'events' && <EventsTab events={filtered} />}
      {tab === 'by-driver' && <ByDriverTab events={filtered} />}
      {tab === 'trends' && <TrendsTab events={filtered} />}
      {tab === 'patterns' && <PatternsTab events={filtered} />}
    </div>
  );
}
