import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { useFleet, authFetch } from '../context/FleetContext';
import type { LogEntry, TripDriver } from '../context/FleetContext';
import { isActiveDriver, isActiveDriverId, displayDriverName } from '../lib/driverUtils';
import { sanitizeTripDriver } from '../lib/demoSanitize';
import MockNamesBadge from '../components/MockNamesBadge';
import {
  buildDriverConsequenceCard,
  type ConsequenceCard,
  type ConsequenceCategory,
} from '../lib/consequenceScore';
import { useClientPagination } from '../hooks/useClientPagination';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import PageControls from '../components/PageControls';
import { brandLabel } from '../lib/branding';
import { DEMO_BRANDING, demoPhoneLabel } from '../config/demoBranding';

const HIDDEN_LABELS = ['Possible Power Tamper', 'Battery Disconnection', 'Battery Disconnected', 'Front Panel Tamper', 'Back Panel Tamper', 'No Blue Key'];

type DateRange = 'today' | '7days' | '30days' | 'alltime';

interface DriverProfile {
  key: string;
  name: string;
  phone: string;
  assetName: string;
  regNo: string;
  transporter: string;
  harshBraking: number;
  harshAccel: number;
  overspeeding: number;
  cornering: number;
  total: number;
  distanceKm: number;
  drivingTimeSeconds: number;
  journeyCount: number;
  consequence: ConsequenceCard;
  events: LogEntry[];
}

function emptyProfile(key: string, name: string, phone = 'N/A'): Omit<DriverProfile, 'consequence'> & { consequence?: ConsequenceCard } {
  return {
    key, name, phone,
    assetName: '—', regNo: '—', transporter: '—',
    harshBraking: 0, harshAccel: 0, overspeeding: 0, cornering: 0, total: 0,
    distanceKm: 0,
    drivingTimeSeconds: 0,
    journeyCount: 0,
    events: [],
  };
}

function fmtDistanceKm(km: number) {
  if (km <= 0) return '0';
  if (km < 10) return km.toFixed(1);
  return Math.round(km).toLocaleString();
}

const HOS_WINDOW_TIP = 'Total drive time this month and last month from telematics drive segments. Short GPS blips are ignored. Gaps in the feed can split one real journey into several pieces — this is drive time, not a trip count.';

function fmtHosHours(seconds: number, journeyCount: number) {
  if (seconds <= 0 && journeyCount <= 0) return '—';
  const h = seconds / 3600;
  if (h <= 0) return '<0.1h';
  if (h < 10) return `${h.toFixed(1)}h`;
  return `${Math.round(h)}h`;
}

function applyEvent(d: { harshBraking: number; harshAccel: number; overspeeding: number; cornering: number; total: number; events: LogEntry[]; assetName: string; regNo: string; transporter: string; phone: string }, e: LogEntry, label: string) {
  if (e.type === 'panic') return;
  d.events.push(e);
  if (label === 'Harsh Braking') { d.harshBraking++; d.total++; }
  else if (label === 'Harsh Acceleration') { d.harshAccel++; d.total++; }
  else if (label === 'Overspeeding' || label === 'Overspeed Tiered') { d.overspeeding++; d.total++; }
  else if (label === 'Harsh Cornering') { d.cornering++; d.total++; }
  if (e.assetName && e.assetName !== 'N/A') d.assetName = e.assetName;
  if (e.regNo && e.regNo !== 'N/A') d.regNo = e.regNo;
  if (e.transporter && e.transporter !== 'N/A') d.transporter = e.transporter;
  if (e.driverPhone && e.driverPhone !== 'N/A') d.phone = e.driverPhone;
}

function scoreBarColor(category: ConsequenceCategory) {
  if (category === 'Green') return '#16a34a';
  if (category === 'Amber') return '#f59e0b';
  if (category === 'Yellow') return '#d97706';
  return '#CC0000';
}

function ScoreBar({ score, category }: { score: number; category: ConsequenceCategory }) {
  const color = scoreBarColor(category);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--cd-border)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color, minWidth: 30 }}>{score}</span>
    </div>
  );
}

function DriverCard({ driver, expanded, onToggle }: { driver: DriverProfile; expanded: boolean; onToggle: () => void }) {
  const { consequence } = driver;
  const color = consequence.categoryColor;
  const recentEvents = driver.events.slice(0, 10);
  const infractions = driver.total;
  const distanceLabel = fmtDistanceKm(driver.distanceKm);
  const hosLabel = fmtHosHours(driver.drivingTimeSeconds, driver.journeyCount);
  const hosHasData = driver.drivingTimeSeconds > 0 || driver.journeyCount > 0;

  return (
    <div className="bpl-card" style={{ overflow: 'hidden', borderLeft: `4px solid ${color}` }}>
      <div
        onClick={onToggle}
        style={{
          padding: '14px 20px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: `${color}20`, border: `2px solid ${color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 700, color,
        }}>
          {displayDriverName(driver.name).charAt(0) || '?'}
        </div>

        <div style={{ flex: '1 1 160px', minWidth: 140 }}>
          <div style={{ fontWeight: 600, color: 'var(--cd-text)', fontSize: 14 }}>{displayDriverName(driver.name)}</div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
            <span>{driver.regNo}</span>
            <span>·</span>
            <span>{brandLabel(driver.assetName)}</span>
            {driver.phone && driver.phone !== 'N/A' && (
              <><span>·</span><span>{DEMO_BRANDING ? demoPhoneLabel(driver.phone) : driver.phone}</span></>
            )}
          </div>
          <div style={{ width: 140, marginTop: 8 }}>
            <ScoreBar score={consequence.displayScore} category={consequence.category} />
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(72px, 1fr))',
          gap: 8,
          flex: '1 1 280px',
          minWidth: 240,
        }}>
          {[
            {
              label: 'Infractions',
              value: infractions,
              sub: infractions === 1 ? 'event' : 'events',
              valueColor: infractions > 0 ? '#CC0000' : 'var(--cd-text)',
            },
            {
              label: 'Distance',
              value: distanceLabel,
              sub: 'km',
              valueColor: 'var(--cd-text)',
            },
            {
              label: 'HOS',
              value: hosLabel,
              sub: hosHasData ? 'drive time' : 'no drive data',
              valueColor: hosHasData ? 'var(--cd-text)' : 'var(--cd-text-muted)',
              tip: HOS_WINDOW_TIP,
            },
          ].map(m => (
            <div
              key={m.label}
              title={m.tip}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: 'var(--cd-surface-2)',
                border: '1px solid var(--cd-border)',
                textAlign: 'center',
                minWidth: 0,
                cursor: m.tip ? 'help' : undefined,
              }}
            >
              <div style={{
                fontSize: 10, fontWeight: 700, color: 'var(--cd-text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2,
              }}>
                {m.label}
              </div>
              <div style={{
                fontSize: 20, fontWeight: 700, color: m.valueColor,
                fontFamily: 'var(--cd-font-display)', lineHeight: 1.1,
              }}>
                {m.value}
              </div>
              <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 2 }}>{m.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 'auto' }}>
          <span style={{
            padding: '3px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 700,
            background: `${color}15`, color,
          }}>
            {consequence.categoryLabel}
          </span>
          {expanded ? <ChevronUp size={16} color="var(--cd-text-muted)" /> : <ChevronDown size={16} color="var(--cd-text-muted)" />}
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)' }}>
          <div style={{
            margin: '12px 20px', padding: '10px 14px', borderRadius: 8,
            background: `${color}10`, border: `1px solid ${color}30`,
            fontSize: 12, color: 'var(--cd-text)',
          }}>
            <div style={{ fontWeight: 700, color, marginBottom: 4 }}>Recommended consequence</div>
            {consequence.recommendedConsequence}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, padding: '0 20px 12px' }}>
            {[
              { label: 'Penalty points', value: consequence.penaltyPoints },
              { label: 'Distance (km)', value: Math.round(consequence.distanceKm).toLocaleString() },
              { label: 'HOS (hours)', value: hosHasData ? (driver.drivingTimeSeconds / 3600).toFixed(1) : '—', tip: HOS_WINDOW_TIP },
              { label: 'Score / 100 km', value: consequence.driverScore.toFixed(1) },
            ].map(s => (
              <div key={s.label} title={s.tip} style={{ textAlign: 'center', padding: '10px 8px', background: 'var(--cd-surface)', borderRadius: 8, border: '1px solid var(--cd-border)', cursor: s.tip ? 'help' : undefined }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, padding: '0 20px 12px' }}>
            {[
              { label: 'Harsh Brake', value: driver.harshBraking, color: '#CC0000' },
              { label: 'Harsh Accel.', value: driver.harshAccel, color: '#0078D4' },
              { label: 'Overspeeding', value: driver.overspeeding, color: '#9333ea' },
              { label: 'Cornering', value: driver.cornering, color: '#d97706' },
              { label: 'Total', value: driver.total, color: 'var(--cd-text)' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center', padding: '10px 8px', background: 'var(--cd-surface)', borderRadius: 8, border: '1px solid var(--cd-border)' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: 'var(--cd-font-display)' }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {recentEvents.length > 0 && (
            <div style={{ padding: '0 20px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Recent Events
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recentEvents.map((e, i) => {
                  const label = e.label || 'Unknown';
                  const c = label === 'Harsh Braking' ? '#CC0000' : 'var(--cd-text-muted)';
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', gap: 8 }}>
                      <span style={{ color: c, fontWeight: 600 }}>{label}</span>
                      <span style={{ color: 'var(--cd-text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.address || '—'}</span>
                      <span style={{ color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
                        {e.eventTime ? new Date(e.eventTime).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DriverManagement() {
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [dateRange, setDateRange] = useState<DateRange>('30days');
  const [expandedDrivers, setExpandedDrivers] = useState<Set<string>>(new Set());
  const [tripDrivers, setTripDrivers] = useState<TripDriver[]>([]);
  const { events } = useFleet();

  useEffect(() => {
    const q = searchParams.get('q');
    if (!q) return;
    setSearch(q);
    setExpandedDrivers(new Set([q]));
    setDateRange('alltime');
  }, []);

  // Seed population + distance from trip activity (current + last month retention)
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
    })();
    return () => { cancelled = true; };
  }, []);

  const statsEvents = useMemo(() => {
    const now = Date.now();
    return events.filter(e => {
      const ts = new Date(e.eventTime || e.timestamp).getTime();
      if (dateRange === 'today') { const s = new Date(); s.setHours(0,0,0,0); return ts >= s.getTime(); }
      if (dateRange === '7days') return ts >= now - 7 * 24 * 60 * 60 * 1000;
      if (dateRange === '30days') return ts >= now - 30 * 24 * 60 * 60 * 1000;
      return true;
    });
  }, [events, dateRange]);

  const drivers: DriverProfile[] = useMemo(() => {
    const map = new Map<string, ReturnType<typeof emptyProfile>>();
    const distanceByKey = new Map<string, number>();
    const drivingByKey = new Map<string, number>();
    const journeysByKey = new Map<string, number>();

    const ensure = (key: string, name: string, phone?: string) => {
      if (!map.has(key)) map.set(key, emptyProfile(key, name, phone || 'N/A'));
      return map.get(key)!;
    };

    tripDrivers.forEach(t => {
      if (!isActiveDriver(t.driverName, t.driverId)) return;
      const key = (t.driverId && isActiveDriverId(t.driverId)) ? t.driverId : t.driverName;
      const d = ensure(key, t.driverName, t.driverPhone);
      if (t.vehicles?.[0]) d.regNo = t.vehicles[0];
      distanceByKey.set(key, (distanceByKey.get(key) || 0) + (t.totalDistanceKm || 0));
      drivingByKey.set(key, (drivingByKey.get(key) || 0) + (t.totalDrivingTimeSeconds || 0));
      journeysByKey.set(key, (journeysByKey.get(key) || 0) + (t.journeyCount || 0));
    });

    events.forEach(e => {
      if (e.type === 'panic') return;
      const label = e.label || '';
      if (HIDDEN_LABELS.includes(label)) return;
      if (!isActiveDriver(e.driverName, e.driverId)) return;
      const key = (e.driverId && isActiveDriverId(e.driverId)) ? e.driverId : e.driverName!;
      const d = ensure(key, e.driverName!, e.driverPhone);
      if (e.assetName && e.assetName !== 'N/A') d.assetName = e.assetName;
      if (e.regNo && e.regNo !== 'N/A') d.regNo = e.regNo;
      if (e.transporter && e.transporter !== 'N/A') d.transporter = e.transporter;
    });

    statsEvents.forEach(e => {
      if (e.type === 'panic') return;
      const label = e.label || '';
      if (HIDDEN_LABELS.includes(label)) return;
      if (!isActiveDriver(e.driverName, e.driverId)) return;
      const key = (e.driverId && isActiveDriverId(e.driverId)) ? e.driverId : e.driverName!;
      const d = map.get(key);
      if (!d) return;
      applyEvent(d, e, label);
    });

    return Array.from(map.values())
      .map(d => {
        const distanceKm = distanceByKey.get(d.key) || 0;
        const drivingTimeSeconds = drivingByKey.get(d.key) || 0;
        const journeyCount = journeysByKey.get(d.key) || 0;
        const consequence = buildDriverConsequenceCard({
          events: d.events,
          distanceKm,
        });
        return {
          ...d,
          distanceKm,
          drivingTimeSeconds,
          journeyCount,
          harshBraking: consequence.counts.harshBraking,
          harshAccel: consequence.counts.harshAccel,
          overspeeding: consequence.counts.overspeeding,
          cornering: consequence.counts.cornering,
          total: consequence.counts.eventCount,
          consequence,
        } as DriverProfile;
      })
      .sort((a, b) => a.consequence.displayScore - b.consequence.displayScore || a.consequence.driverScore - b.consequence.driverScore);
  }, [events, statsEvents, tripDrivers]);

  const debouncedSearch = useDebouncedValue(search, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const visible = deferredSearch
    ? drivers.filter(d => d.name.toLowerCase().includes(deferredSearch.toLowerCase()) || d.regNo.toLowerCase().includes(deferredSearch.toLowerCase()))
    : drivers;

  const pagination = useClientPagination(visible, 50);

  const toggle = (name: string) => setExpandedDrivers(prev => {
    const n = new Set(prev);
    n.has(name) ? n.delete(name) : n.add(name);
    return n;
  });

  const redCount = drivers.filter(d => d.consequence.category === 'Red').length;
  const needsAction = drivers.filter(d => d.consequence.category !== 'Green').length;
  const greenCount = drivers.filter(d => d.consequence.category === 'Green').length;

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Driver Management <MockNamesBadge /></h1>
        <p className="bpl-page-subtitle">Consequence Management scorecards — penalty points normalized per 100 km</p>
      </div>

      <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div className="bpl-kpi-card">
          <div className="bpl-kpi-label">Total Drivers</div>
          <div className="bpl-kpi-value">{drivers.length}</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '3px solid #CC0000' }}>
          <div className="bpl-kpi-label">High Risk</div>
          <div className="bpl-kpi-value" style={{ color: '#CC0000' }}>{redCount}</div>
          <div className="bpl-kpi-sub">Red tier</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '3px solid #d97706' }}>
          <div className="bpl-kpi-label">Needs Action</div>
          <div className="bpl-kpi-value" style={{ color: '#d97706' }}>{needsAction}</div>
          <div className="bpl-kpi-sub">Amber + Yellow + Red</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '3px solid #16a34a' }}>
          <div className="bpl-kpi-label">Low Risk</div>
          <div className="bpl-kpi-value" style={{ color: '#16a34a' }}>{greenCount}</div>
          <div className="bpl-kpi-sub">Green tier</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--cd-text-muted)' }} />
          <input
            type="text"
            placeholder="Search driver or vehicle..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
              border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 13,
              background: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none',
            }}
          />
        </div>
        {(['today', '7days', '30days', 'alltime'] as DateRange[]).map(r => (
          <button key={r}
            onClick={() => setDateRange(r)}
            style={{
              padding: '7px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              border: '1px solid',
              borderColor: dateRange === r ? 'var(--bpl-blue)' : 'var(--cd-border)',
              background: dateRange === r ? 'var(--bpl-blue-soft)' : 'var(--cd-surface)',
              color: dateRange === r ? 'var(--bpl-blue)' : 'var(--cd-text-muted)',
            }}
          >
            {r === 'today' ? 'Today' : r === '7days' ? '7 Days' : r === '30days' ? '30 Days' : 'All Time'}
          </button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>{visible.length} drivers</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--cd-text-muted)' }}>
            No driver data available
          </div>
        ) : pagination.pageRows.map(d => (
          <DriverCard
            key={d.key}
            driver={d}
            expanded={expandedDrivers.has(d.name) || expandedDrivers.has(d.key)}
            onToggle={() => toggle(d.name)}
          />
        ))}
      </div>

      {visible.length > 0 && (
        <div className="bpl-card" style={{ marginTop: 10, padding: 0 }}>
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
            itemLabel="drivers"
          />
        </div>
      )}
    </div>
  );
}
