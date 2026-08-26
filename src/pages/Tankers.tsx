import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Shield, Truck, Gauge, OctagonAlert, Navigation, AlertTriangle,
  TrendingUp, TrendingDown, Minus, Info, ArrowUp, ArrowDown,
} from 'lucide-react';
import { useFleet, authFetch, type LogEntry } from '../context/FleetContext';
import { displayDriverName, isKnownDriver } from '../lib/driverUtils';
import {
  scoreFromEvents,
  scoreBandColor,
  scoreBandLabel,
  computeFleetScore,
  type FleetSafetyExposure,
} from '../lib/fleetSafetyScore';
import { KpiCard } from '../components/KpiCard';
import SegmentPeriodBar from '../components/SegmentPeriodBar';
import { useSegmentPeriod, useDriverDistancePeriod } from '../hooks/useDriverDistancePeriod';
import {
  eventsInPeriod,
  previousPeriodBounds,
  segmentPeriodBounds,
} from '../lib/segmentPeriod';
import { toLocalDateValue } from '../lib/dateRange';
import {
  segmentVehicles, segmentTripAssets, segmentEvents,
  tankerCorridor, utilizationPct, STATUS_COLOR,
} from '../lib/segmentMetrics';
import { useTableSort } from '../hooks/useTableSort';
import { SkelValue, SkelTable } from '../components/data/DataBusy';
import { authCachedJson, CACHE_TTL } from '../lib/apiCache';

type TankerSortKey = 'corridor' | 'regNo' | 'driver' | 'distanceKm' | 'avgSpeedKph' | 'status';

type TankerRow = {
  assetId: string;
  corridor: string;
  regNo: string;
  driver: string;
  distanceKm: number;
  avgSpeedKph: number | null;
  status: string;
};

const TANKER_COLS: { key: TankerSortKey; label: string; numeric?: boolean }[] = [
  { key: 'corridor', label: 'Corridor' },
  { key: 'regNo', label: 'Reg No' },
  { key: 'driver', label: 'Driver' },
  { key: 'distanceKm', label: 'Distance', numeric: true },
  { key: 'avgSpeedKph', label: 'Avg Speed', numeric: true },
  { key: 'status', label: 'Status' },
];

function fmtEventTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function latestDriverByAsset(events: LogEntry[]) {
  const map = new Map<string, { name: string; t: number }>();
  for (const e of events) {
    if (!e.assetId || !isKnownDriver(e.driverName)) continue;
    const t = new Date(e.eventTime || e.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    const id = String(e.assetId);
    const prev = map.get(id);
    if (!prev || t > prev.t) map.set(id, { name: e.driverName!, t });
  }
  return map;
}

function censusUrl(fromIso: string, toIso: string, assetIds: string[]) {
  const ids = encodeURIComponent(assetIds.join(','));
  return `/api/safety/summary?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&assetIds=${ids}`;
}

function useTankerCensus(assetIds: string[], fromIso: string, toIso: string, prevFromIso: string, prevToIso: string) {
  const [current, setCurrent] = useState<FleetSafetyExposure | null>(null);
  const [previous, setPrevious] = useState<FleetSafetyExposure | null>(null);

  const idKey = assetIds.join(',');

  const load = useCallback(async () => {
    if (!assetIds.length) {
      setCurrent(null);
      setPrevious(null);
      return;
    }
    try {
      const [cur, prev] = await Promise.all([
        authCachedJson<FleetSafetyExposure>(censusUrl(fromIso, toIso, assetIds), authFetch, {
          ttlMs: CACHE_TTL.safetySummary,
        }),
        authCachedJson<FleetSafetyExposure>(censusUrl(prevFromIso, prevToIso, assetIds), authFetch, {
          ttlMs: CACHE_TTL.safetySummary,
        }),
      ]);
      if (cur) setCurrent(cur);
      if (prev) setPrevious(prev);
    } catch {
      /* keep prior / fall back to event score */
    }
  }, [assetIds, idKey, fromIso, toIso, prevFromIso, prevToIso]);

  useEffect(() => { void load(); }, [load]);

  return { current, previous };
}

export default function Tankers() {
  const { vehicles, events, eventsLoading, scoreConfig } = useFleet();
  const {
    period, setPeriod, customRange, setCustomRange,
    assets: periodAssets, loading: distanceLoading, label: periodLabel,
  } = useSegmentPeriod('today');
  const fleet = useMemo(() => segmentVehicles(vehicles, 'tankers'), [vehicles]);
  const segEvents = useMemo(() => segmentEvents(fleet, events), [fleet, events]);
  const assets = useMemo(() => segmentTripAssets(fleet, periodAssets), [fleet, periodAssets]);

  const periodBounds = useMemo(() => segmentPeriodBounds(period, customRange), [period, customRange]);
  const prevBounds = useMemo(() => previousPeriodBounds(period, customRange), [period, customRange]);
  const prevCustom = useMemo(() => ({
    from: toLocalDateValue(new Date(prevBounds.fromMs)),
    to: toLocalDateValue(new Date(Math.max(prevBounds.toMs - 1, prevBounds.fromMs))),
  }), [prevBounds.fromMs, prevBounds.toMs]);
  const { assets: prevPeriodAssets } = useDriverDistancePeriod('custom', prevCustom);

  const recent = useMemo(
    () => eventsInPeriod(segEvents, period, customRange),
    [segEvents, period, customRange],
  );
  const prev = useMemo(() => {
    return segEvents.filter(e => {
      const t = new Date(e.eventTime || e.timestamp).getTime();
      return t >= prevBounds.fromMs && t < prevBounds.toMs;
    });
  }, [segEvents, prevBounds.fromMs, prevBounds.toMs]);

  const util = utilizationPct(fleet);
  const distanceKm = Math.round(assets.reduce((s, a) => s + a.totalDistanceKm, 0));
  const prevDistanceKm = Math.round(
    segmentTripAssets(fleet, prevPeriodAssets).reduce((s, a) => s + a.totalDistanceKm, 0),
  );

  const tankerIds = useMemo(
    () => fleet.map(v => v.id).filter(Boolean).map(String),
    [fleet],
  );
  const census = useTankerCensus(
    tankerIds,
    periodBounds.fromIso,
    periodBounds.toIso,
    new Date(prevBounds.fromMs).toISOString(),
    new Date(Math.max(prevBounds.toMs - 1, prevBounds.fromMs)).toISOString(),
  );

  const { score, delta } = useMemo(() => {
    if (census.current) {
      return computeFleetScore(census.current, census.previous, scoreConfig);
    }
    const now = scoreFromEvents(recent, distanceKm, scoreConfig);
    const was = scoreFromEvents(prev, prevDistanceKm, scoreConfig);
    return { score: now, delta: now - was };
  }, [census.current, census.previous, scoreConfig, recent, distanceKm, prev, prevDistanceKm]);

  const scoreColor = scoreBandColor(score, scoreConfig);
  const scoreLabel = scoreBandLabel(score, scoreConfig);

  const overspeeds = recent.filter(e => e.label === 'Overspeeding' || e.label === 'Overspeed Tiered').length;
  const harshBrakes = recent.filter(e => e.label === 'Harsh Braking').length;

  const corridors = useMemo(() => {
    const east: typeof fleet = [];
    const west: typeof fleet = [];
    const other: typeof fleet = [];
    for (const v of fleet) {
      const c = tankerCorridor(v.zone);
      if (c === 'East') east.push(v);
      else if (c === 'West') west.push(v);
      else other.push(v);
    }
    return { east, west, other };
  }, [fleet]);

  const eventDrivers = useMemo(() => latestDriverByAsset(recent), [recent]);
  const assetById = useMemo(() => {
    const map = new Map(assets.map(a => [a.assetId?.toString(), a]));
    return map;
  }, [assets]);

  const tankerRows = useMemo<TankerRow[]>(() => {
    return fleet.map(v => {
      const id = v.id?.toString() || '';
      const trip = assetById.get(id);
      const tripDriver = trip?.drivers?.find(d => isKnownDriver(d));
      const eventDriver = eventDrivers.get(id)?.name;
      return {
        assetId: id || v.regNo,
        corridor: tankerCorridor(v.zone),
        regNo: v.regNo,
        driver: displayDriverName(tripDriver || eventDriver),
        distanceKm: trip?.totalDistanceKm ?? 0,
        avgSpeedKph: trip?.avgSpeedKph ?? null,
        status: v.status,
      };
    });
  }, [fleet, assetById, eventDrivers]);

  const getSortValue = useCallback((row: TankerRow, key: TankerSortKey) => {
    if (key === 'avgSpeedKph') return row.avgSpeedKph;
    return row[key];
  }, []);

  const { sorted, sort, toggle, ariaSort } = useTableSort<TankerRow, TankerSortKey>(tankerRows, getSortValue, {
    initial: { key: 'distanceKm', dir: 'desc' },
    persist: true,
    defaultDirForKey: key => (key === 'distanceKm' || key === 'avgSpeedKph' ? 'desc' : 'asc'),
  });

  const recentIncidents = recent.filter(e => e.type !== 'panic').slice(0, 8);
  const scoreTip = `Same Fleet Safety Score engine (100 − 5 × weighted IVMS+HOS harm per 100 km), scoped to bulk-tanker assets only. Uses tanker incidents, tanker kilometres, and tanker HOS for ${periodLabel} vs the prior window. Settings weights apply.`;

  return (
    <div>
      <div className="bpl-page-header bpl-page-header-row">
        <div>
          <h1 className="bpl-page-title">Bulk Tankers</h1>
          <p className="bpl-page-subtitle">
            East & West pneumatic bulk cement — long-haul safety, utilization, and corridor performance.
          </p>
        </div>
        <SegmentPeriodBar
          period={period}
          customRange={customRange}
          onPeriod={setPeriod}
          onCustomRange={setCustomRange}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14, marginBottom: 20 }}>
        <div className="bpl-card" style={{ padding: '22px 24px' }} title={scoreTip}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)' }}>
              Tanker HSE Score
            </div>
            <span
              title={scoreTip}
              aria-label="Score explanation"
              style={{
                display: 'inline-flex', width: 14, height: 14, borderRadius: '50%',
                border: '1px solid var(--cd-border)', color: 'var(--cd-text-muted)',
                alignItems: 'center', justifyContent: 'center', cursor: 'help',
              }}
            >
              <Info size={9} strokeWidth={2.5} />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
              <svg width="80" height="80" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--cd-border)" strokeWidth="6" />
                <circle cx="40" cy="40" r="34" fill="none" stroke={eventsLoading ? 'var(--cd-border)' : scoreColor} strokeWidth="6"
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  strokeDashoffset={`${2 * Math.PI * 34 * (1 - (eventsLoading ? 0 : score) / 100)}`}
                  strokeLinecap="round" />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: eventsLoading ? 'var(--cd-text-muted)' : scoreColor, fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>
                  {eventsLoading ? <SkelValue /> : score}
                </span>
                {!eventsLoading && <span style={{ fontSize: 9, color: 'var(--cd-text-muted)' }}>/100</span>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: eventsLoading ? 'var(--cd-text-muted)' : scoreColor, fontFamily: 'var(--cd-font-display)' }}>
                {eventsLoading ? <SkelValue wide /> : scoreLabel}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, marginTop: 4 }}>
                {eventsLoading ? (
                  <SkelValue wide />
                ) : delta > 0
                  ? <><TrendingUp size={12} color="#16a34a" /><span style={{ color: '#16a34a', fontWeight: 600 }}>+{delta} vs prior period</span></>
                  : delta < 0
                  ? <><TrendingDown size={12} color="#CC0000" /><span style={{ color: '#CC0000', fontWeight: 600 }}>{delta} vs prior period</span></>
                  : <><Minus size={12} color="var(--cd-text-muted)" /><span style={{ color: 'var(--cd-text-muted)' }}>No change</span></>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 8 }}>
                {eventsLoading ? <SkelValue wide /> : `${recent.length} tanker incidents ${periodLabel} · ${overspeeds} overspeed`}
              </div>
            </div>
          </div>
        </div>

        <div className="bpl-kpi-grid" style={{ marginBottom: 0 }}>
          <KpiCard
            label="Utilization"
            value={`${util}%`}
            sub={`${fleet.filter(v => v.status === 'Moving').length} tankers moving`}
            color="#0078D4"
            icon={Truck}
            tip="Share of bulk-tanker vehicles currently Moving. Formula: Moving ÷ tanker fleet size × 100."
          />
          <KpiCard
            label="Fleet Size"
            value={fleet.length}
            sub="East & West bulk tankers"
            color="#0284c7"
            icon={Truck}
            tip="Count of MiX assets whose zone matches Bulk Tankers (East/West pneumatic bulk)."
          />
          <KpiCard
            label={`Distance ${periodLabel}`}
            value={distanceLoading ? <SkelValue wide /> : `${distanceKm.toLocaleString()} km`}
            sub="Long-haul total"
            color="#0369a1"
            icon={Navigation}
            tip={`Sum of MiX trip distance ${periodLabel} for bulk-tanker assets only.`}
          />
          <KpiCard
            label={`Overspeed (${periodLabel})`}
            value={eventsLoading ? <SkelValue /> : overspeeds}
            sub={eventsLoading ? '—' : `${harshBrakes} harsh braking events`}
            color={overspeeds > 5 ? '#CC0000' : '#d97706'}
            icon={Gauge}
            tip={`Count of overspeed events on tanker assets ${periodLabel} (MiX events filtered to this segment). Sub-line = harsh braking in the same window.`}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        {([
          { label: 'East Corridor', list: corridors.east, color: '#0078D4' },
          { label: 'West Corridor', list: corridors.west, color: '#0284c7' },
        ] as const).map(({ label, list, color }) => {
          const corridorAssets = segmentTripAssets(list, periodAssets);
          const km = Math.round(corridorAssets.reduce((s, a) => s + a.totalDistanceKm, 0));
          const moving = list.filter(v => v.status === 'Moving').length;
          return (
            <div key={label} className="bpl-card" style={{ padding: 20, borderTop: `3px solid ${color}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', marginBottom: 12, fontFamily: 'var(--cd-font-display)' }}>{label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, textAlign: 'center' }}>
                <div><div style={{ fontSize: 22, fontWeight: 700, color }}>{list.length}</div><div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>Tankers</div></div>
                <div><div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{moving}</div><div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>Moving</div></div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color }}>
                    {distanceLoading ? <SkelValue /> : km.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>km {periodLabel}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(280px, 0.75fr)', gap: 14 }}>
        <div className="bpl-card tk-roster">
          <div className="tk-roster-head">
            <div>
              <div className="tk-roster-title">Tanker roster</div>
              <div className="tk-roster-sub">
                All bulk tankers · {periodLabel} · click a column to sort
              </div>
            </div>
            <span className="tk-roster-count">
              {distanceLoading ? <SkelValue /> : `${sorted.length} tankers`}
            </span>
          </div>
          <div className="tk-roster-scroll">
            <table className="tk-roster-table">
              <thead>
                <tr>
                  {TANKER_COLS.map(col => {
                    const active = sort.key === col.key;
                    return (
                      <th
                        key={col.key}
                        aria-sort={ariaSort(col.key)}
                      >
                        <button
                          type="button"
                          className={`tk-sort${active ? ' is-on' : ''}${col.numeric ? ' is-num' : ''}`}
                          onClick={() => toggle(col.key)}
                        >
                          <span>{col.label}</span>
                          {active
                            ? (sort.dir === 'desc' ? <ArrowDown size={11} strokeWidth={2.5} /> : <ArrowUp size={11} strokeWidth={2.5} />)
                            : <span className="tk-sort-idle" aria-hidden>⇅</span>}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {distanceLoading ? (
                  <tr><td colSpan={6} style={{ padding: 12 }}><SkelTable rows={8} /></td></tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="tk-roster-empty">No bulk tankers in this fleet</td>
                  </tr>
                ) : sorted.map((row, i) => {
                  const color = STATUS_COLOR[row.status] ?? '#6B7A8D';
                  return (
                    <tr key={row.assetId} className={i % 2 ? 'is-alt' : undefined}>
                      <td>{row.corridor}</td>
                      <td className="tk-reg">{row.regNo}</td>
                      <td className="tk-driver" title={row.driver}>{row.driver}</td>
                      <td className={`tk-num${sort.key === 'distanceKm' ? ' is-sorted' : ''}`}>
                        {row.distanceKm > 0 ? `${Math.round(row.distanceKm).toLocaleString()} km` : '—'}
                      </td>
                      <td className="tk-num">
                        {row.avgSpeedKph != null ? `${Math.round(row.avgSpeedKph)} km/h` : '—'}
                      </td>
                      <td>
                        <span className="tk-status" style={{ background: `${color}18`, color }}>
                          {row.status || '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bpl-card">
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--cd-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={16} color="#CC0000" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>Recent HSE Events</div>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>Bulk tanker incidents — {periodLabel}</div>
            </div>
          </div>
          {eventsLoading ? (
            <div style={{ padding: 12 }}><SkelTable rows={5} /></div>
          ) : recentIncidents.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>No recent incidents</div>
          ) : recentIncidents.map((e, i) => (
            <div key={i} style={{
              padding: '11px 18px', borderBottom: i < recentIncidents.length - 1 ? '1px solid var(--cd-border)' : 'none',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              {e.label === 'Harsh Braking' || e.label?.includes('Overspeed')
                ? <OctagonAlert size={14} color="#CC0000" style={{ flexShrink: 0, marginTop: 2 }} />
                : <AlertTriangle size={14} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cd-text)' }}>
                  {e.label}{displayDriverName(e.driverName) !== '—' ? ` — ${displayDriverName(e.driverName)}` : ''}
                </div>
                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{e.regNo} · {e.address || '—'}</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {fmtEventTime(e.eventTime || e.timestamp)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
