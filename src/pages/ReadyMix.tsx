import { useMemo, useState, useEffect } from 'react';
import {
  Timer, Truck, Factory, MapPin, Navigation, AlertCircle, Droplets,
  ChevronDown, ChevronUp, LayoutGrid, Rows3,
} from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import type { Vehicle } from '../context/FleetContext';
import { KpiCard } from '../components/KpiCard';
import SegmentPeriodBar from '../components/SegmentPeriodBar';
import ReadyMixPlantMap from '../components/ReadyMixPlantMap';
import { useSegmentPeriod } from '../hooks/useDriverDistancePeriod';
import {
  segmentVehicles, readyMixPlant, readyMixDispatchState, locationLabel,
  deriveReadyMixPlantPins, openTripAssetIdsFromSession, segmentTripAssets,
  STATUS_COLOR,
} from '../lib/segmentMetrics';
import { authFetch } from '../context/FleetContext';
import { authCachedJson, cachePeek, CACHE_TTL } from '../lib/apiCache';
import { SkelValue, SkelTable } from '../components/data/DataBusy';

const DISPATCH_META = {
  transit: { label: 'In transit', color: '#d97706', short: 'Transit' },
  plant: { label: 'At plant', color: '#16a34a', short: 'Plant' },
  /** Internal key kept as jobsite; UI says “Away from plant” — GPS stop outside geofence, not a verified pour site. */
  jobsite: { label: 'Away from plant', color: '#7c3aed', short: 'Away' },
  parked: { label: 'Parked', color: '#6B7A8D', short: 'Parked' },
  offline: { label: 'Offline', color: '#6878A0', short: 'Offline' },
} as const;

type DispatchFilter = 'all' | keyof typeof DISPATCH_META;
type BoardDensity = 'cards' | 'compact';

function timeAgo(dateStr?: string): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff) || diff < 0) return '—';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type DispatchOpts = Parameters<typeof readyMixDispatchState>[1];

const ALWAYS_ON_DISPATCH: (keyof typeof DISPATCH_META)[] = ['transit', 'plant', 'jobsite'];
const OPTIONAL_DISPATCH: (keyof typeof DISPATCH_META)[] = ['parked', 'offline'];

function countDispatch(vehicles: Vehicle[], opts?: DispatchOpts) {
  const counts: Record<keyof typeof DISPATCH_META, number> = {
    transit: 0, plant: 0, jobsite: 0, parked: 0, offline: 0,
  };
  for (const v of vehicles) counts[readyMixDispatchState(v, opts)] += 1;
  return counts;
}

/** Total + Transit/Plant/Away always shown (0 = balance). Parked/Offline only when &gt; 0. */
function DispatchSummaryStrip({ vehicles, opts }: { vehicles: Vehicle[]; opts?: DispatchOpts }) {
  const counts = countDispatch(vehicles, opts);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6, alignItems: 'center' }}>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
        background: 'rgba(128,128,128,0.12)', color: 'var(--cd-text)',
        border: '1px solid rgba(128,128,128,0.18)',
      }}>
        {vehicles.length} Total
      </span>
      {ALWAYS_ON_DISPATCH.map(k => {
        const m = DISPATCH_META[k];
        const n = counts[k];
        const empty = n === 0;
        return (
          <span
            key={k}
            style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
              background: empty ? 'rgba(128,128,128,0.06)' : `${m.color}14`,
              color: empty ? 'var(--cd-text-muted)' : m.color,
              border: `1px solid ${empty ? 'rgba(128,128,128,0.12)' : `${m.color}30`}`,
            }}
          >
            {n} {m.short}
          </span>
        );
      })}
      {OPTIONAL_DISPATCH.filter(k => counts[k] > 0).map(k => {
        const m = DISPATCH_META[k];
        return (
          <span
            key={k}
            style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
              background: `${m.color}14`, color: m.color, border: `1px solid ${m.color}30`,
            }}
          >
            {counts[k]} {m.short}
          </span>
        );
      })}
    </div>
  );
}

/** Full card — same visual language as dashboard GroupedView `gv-card`. */
function MixerCard({ v, opts }: { v: Vehicle; opts?: DispatchOpts }) {
  const state = readyMixDispatchState(v, opts);
  const meta = DISPATCH_META[state];
  const statusColor = STATUS_COLOR[v.status] ?? '#6B7A8D';
  const loc = locationLabel(v);
  const speed = (v.position as { speed?: number } | undefined)?.speed;
  const showSpeed = speed != null && speed > 0;

  return (
    <div className="gv-card rmx-mixer-card" style={{ borderTop: `3px solid ${meta.color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: statusColor, boxShadow: `0 0 0 2px ${statusColor}22`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, letterSpacing: '0.03em' }}>
            {v.status}
          </span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--cd-text-soft)', fontVariantNumeric: 'tabular-nums' }}>
          {timeAgo(v.date)}
        </span>
      </div>

      <div style={{
        fontSize: 16, fontWeight: 700, color: 'var(--cd-text)',
        fontFamily: 'var(--cd-font-display)', letterSpacing: '-0.01em',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3,
      }}>
        {v.regNo}
      </div>

      <div style={{
        fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 8,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {v.assetName?.trim() || readyMixPlant(v)}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
          background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}30`,
        }}>
          {meta.label}
        </span>
        {showSpeed && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
            background: 'rgba(217,119,6,0.12)', color: '#d97706',
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>
            <Navigation size={9} /> {Math.round(speed!)} km/h
          </span>
        )}
      </div>

      <div style={{
        marginTop: 'auto', paddingTop: 8,
        borderTop: '1px solid rgba(128,128,128,0.12)',
        display: 'flex', alignItems: 'flex-start', gap: 4,
      }}>
        <MapPin size={9} style={{ color: 'var(--cd-text-soft)', flexShrink: 0, marginTop: 1 }} />
        <span style={{
          fontSize: 10, color: 'var(--cd-text-soft)', lineHeight: 1.4,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {loc}
        </span>
      </div>
    </div>
  );
}

/** Compact row — quick info when density is compact. */
function MixerRow({ v, opts }: { v: Vehicle; opts?: DispatchOpts }) {
  const state = readyMixDispatchState(v, opts);
  const meta = DISPATCH_META[state];
  const statusColor = STATUS_COLOR[v.status] ?? '#6B7A8D';
  const loc = locationLabel(v);

  return (
    <div className="rmx-compact-row">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--cd-font-display)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.regNo}
        </div>
        <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.assetName?.trim() || '—'}
        </div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
        {v.status === 'Excessive Idle' ? 'Exc. Idle' : v.status}
      </span>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, width: 'fit-content',
        background: `${meta.color}18`, color: meta.color,
      }}>
        {meta.short}
      </span>
      <span style={{ fontSize: 11, color: 'var(--cd-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={loc}>
        {loc}
      </span>
      <span style={{ fontSize: 10, color: 'var(--cd-text-soft)', whiteSpace: 'nowrap' }}>{timeAgo(v.date)}</span>
    </div>
  );
}

function SiteSection({
  siteName, vehicles, startOpen, density, opts,
}: {
  siteName: string; vehicles: Vehicle[]; startOpen: boolean; density: BoardDensity; opts?: DispatchOpts;
}) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => { setOpen(startOpen); }, [startOpen]);

  const hub = readyMixPlant(vehicles[0]);
  const critical = vehicles.filter(v => {
    const s = readyMixDispatchState(v, opts);
    return s === 'transit' || s === 'jobsite';
  }).length;

  return (
    <div className="gv-zone">
      <button type="button" className="gv-zone-header" onClick={() => setOpen(o => !o)} style={{ borderTopColor: critical > 0 ? '#7c3aed' : '#e11d48' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 15, fontWeight: 700, color: 'var(--cd-text)',
              fontFamily: 'var(--cd-font-display)', letterSpacing: '-0.01em',
            }}>
              {siteName}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999,
              background: 'rgba(128,128,128,0.1)', color: 'var(--cd-text-muted)',
              border: '1px solid rgba(128,128,128,0.12)',
            }}>
              {vehicles.length} mixer{vehicles.length !== 1 ? 's' : ''}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
              background: 'rgba(225,29,72,0.1)', color: '#e11d48',
            }}>
              {hub}
            </span>
            {critical > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                background: 'rgba(124,58,237,0.12)', color: '#7c3aed',
              }}>
                {critical} time-critical
              </span>
            )}
          </div>
          {/* Always-on dispatch balance: Total + Transit/Plant/Away (0 shown); Parked/Offline if any */}
          <DispatchSummaryStrip vehicles={vehicles} opts={opts} />
        </div>
        <div style={{ flexShrink: 0, color: 'var(--cd-text-muted)', marginLeft: 8 }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && (
        density === 'cards' ? (
          <div className="rmx-mixer-grid">
            {vehicles.map(v => <MixerCard key={v.id} v={v} opts={opts} />)}
          </div>
        ) : (
          <div className="rmx-compact-list">
            <div className="rmx-compact-head">
              <span>Reg</span><span>Status</span><span>Dispatch</span><span>Location</span><span>Updated</span>
            </div>
            {vehicles.map(v => <MixerRow key={v.id} v={v} opts={opts} />)}
          </div>
        )
      )}
    </div>
  );
}

export default function ReadyMix() {
  const { vehicles, vehiclesLoading, scopedAssetIds, siteFilterActive } = useFleet();
  const {
    period, setPeriod, customRange, setCustomRange,
    assets: periodAssets, loading: distanceLoading, label: periodLabel,
  } = useSegmentPeriod('today', {
    assetIds: siteFilterActive ? scopedAssetIds : [],
    enabled: !siteFilterActive || scopedAssetIds.length > 0,
  });
  const [filter, setFilter] = useState<DispatchFilter>('all');
  const [allOpen, setAllOpen] = useState(true);
  const [density, setDensity] = useState<BoardDensity>('cards');
  const TRIPS_SESSION_URL = '/api/trips/session';
  type SessionTrip = { AssetId?: string | null; assetId?: string | null; TripEnd?: string | null; tripEnd?: string | null };
  const [openTripAssetIds, setOpenTripAssetIds] = useState<Set<string>>(() => {
    const cached = cachePeek<SessionTrip[]>(TRIPS_SESSION_URL);
    return Array.isArray(cached) ? openTripAssetIdsFromSession(cached) : new Set();
  });
  const [tripsLoading, setTripsLoading] = useState(() => !cachePeek(TRIPS_SESSION_URL));

  const fleet = useMemo(() => segmentVehicles(vehicles, 'readyMix'), [vehicles]);
  const tripAssets = useMemo(() => segmentTripAssets(fleet, periodAssets), [fleet, periodAssets]);
  const periodKm = Math.round(tripAssets.reduce((s, a) => s + a.totalDistanceKm, 0));
  const periodJourneys = tripAssets.reduce((s, a) => s + (a.journeyCount || 0), 0);
  const plantPins = useMemo(() => deriveReadyMixPlantPins(fleet), [fleet]);
  const dispatchOpts = useMemo(
    () => ({ plantPins, openTripAssetIds }),
    [plantPins, openTripAssetIds],
  );
  const dispatchBusy = vehiclesLoading || tripsLoading;

  useEffect(() => {
    let cancelled = false;
    const cached = cachePeek<SessionTrip[]>(TRIPS_SESSION_URL);
    if (Array.isArray(cached)) {
      setOpenTripAssetIds(openTripAssetIdsFromSession(cached));
      setTripsLoading(false);
    } else {
      setTripsLoading(true);
    }
    (async () => {
      try {
        const trips = await authCachedJson<SessionTrip[]>(TRIPS_SESSION_URL, authFetch, {
          ttlMs: CACHE_TTL.pageRollup,
        });
        if (!cancelled && Array.isArray(trips)) {
          setOpenTripAssetIds(openTripAssetIdsFromSession(trips));
        }
      } catch {
        /* trips optional — GPS geofence still works */
      } finally {
        if (!cancelled) setTripsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const buckets = useMemo(() => {
    const out: Record<keyof typeof DISPATCH_META, Vehicle[]> = {
      transit: [], plant: [], jobsite: [], parked: [], offline: [],
    };
    for (const v of fleet) out[readyMixDispatchState(v, dispatchOpts)].push(v);
    return out;
  }, [fleet, dispatchOpts]);

  const filtered = useMemo(() => {
    if (filter === 'all') return fleet;
    return fleet.filter(v => readyMixDispatchState(v, dispatchOpts) === filter);
  }, [fleet, filter, dispatchOpts]);

  const byMixSite = useMemo(() => {
    const map: Record<string, Vehicle[]> = {};
    for (const v of filtered) {
      const key = (v.site || 'Unassigned').trim();
      if (!map[key]) map[key] = [];
      map[key].push(v);
    }
    return Object.entries(map).sort((a, b) => {
      const crit = (list: Vehicle[]) => list.filter(v => {
        const s = readyMixDispatchState(v, dispatchOpts);
        return s === 'transit' || s === 'jobsite';
      }).length;
      const c = crit(b[1]) - crit(a[1]);
      return c !== 0 ? c : b[1].length - a[1].length;
    });
  }, [filtered, dispatchOpts]);

  const plants = useMemo(() => {
    const map: Record<string, number> = {};
    for (const v of fleet) {
      const p = readyMixPlant(v);
      map[p] = (map[p] ?? 0) + 1;
    }
    return Object.keys(map).length;
  }, [fleet]);

  const filterTabs: { id: DispatchFilter; label: string; count: number; color: string }[] = [
    { id: 'all', label: 'All', count: fleet.length, color: '#7c3aed' },
    { id: 'transit', label: 'In transit', count: buckets.transit.length, color: DISPATCH_META.transit.color },
    { id: 'plant', label: 'At plant', count: buckets.plant.length, color: DISPATCH_META.plant.color },
    { id: 'jobsite', label: 'Away from plant', count: buckets.jobsite.length, color: DISPATCH_META.jobsite.color },
    { id: 'parked', label: 'Parked', count: buckets.parked.length, color: DISPATCH_META.parked.color },
    { id: 'offline', label: 'Offline', count: buckets.offline.length, color: DISPATCH_META.offline.color },
  ];

  return (
    <div>
      <div className="bpl-page-header bpl-page-header-row">
        <div>
          <h1 className="bpl-page-title">Ready Mix Dispatch</h1>
          <p className="bpl-page-subtitle">
            “At plant” = stopped inside a ±1.5 km GPS plant geofence. “Away from plant” = stopped outside it (not a confirmed customer jobsite).
          </p>
        </div>
        <SegmentPeriodBar
          period={period}
          customRange={customRange}
          onPeriod={setPeriod}
          onCustomRange={setCustomRange}
        />
      </div>

      <div className="bpl-kpi-grid">
        <KpiCard
          label="In Transit"
          value={dispatchBusy ? <SkelValue /> : buckets.transit.length}
          sub="Moving or speed ≥ 5 km/h"
          color="#d97706"
          icon={Truck}
          tip="Live MiX status Moving, or GPS speed still ≥ 5 km/h (filters stale Parked/Idle while rolling)."
        />
        <KpiCard
          label="At Plant"
          value={dispatchBusy ? <SkelValue /> : buckets.plant.length}
          sub="Stopped inside plant geofence"
          color="#16a34a"
          icon={Factory}
          tip="Truly stopped (Idle/Stationary/Parked + speed under 5 km/h) and within 1.5 km of a Ready Mix plant pin. See the cluster map below for proof."
        />
        <KpiCard
          label="Away from plant"
          value={dispatchBusy ? <SkelValue /> : buckets.jobsite.length}
          sub="Stopped outside plant geofence"
          color="#7c3aed"
          icon={Timer}
          tip="Truly stopped outside the plant geofence. This is not a verified pour/jobsite — it can include roadside waits, fuel stops, or other off-yard stops. Parked with no open trip is counted separately as Parked."
        />
        <KpiCard
          label="Mixer Fleet"
          value={vehiclesLoading ? <SkelValue /> : fleet.length}
          sub={vehiclesLoading ? '—' : `${plants} hubs · ${buckets.offline.length} offline`}
          color="#7c3aed"
          icon={Droplets}
          tip="All Ready Mix segment assets. Sub-line = distinct plant hubs inferred from MiX site names, plus Offline/Inactive count."
        />
      </div>

      <div className="bpl-card" style={{
        padding: '12px 16px', marginBottom: 16,
        display: 'flex', flexWrap: 'wrap', gap: '10px 28px', alignItems: 'center',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)' }}>
          Trips {periodLabel}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#7c3aed', fontFamily: 'var(--cd-font-display)' }}>
            {distanceLoading ? <SkelValue /> : `${periodKm.toLocaleString()} km`}
          </div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>Distance</div>
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
            {distanceLoading ? <SkelValue /> : periodJourneys}
          </div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>Journeys</div>
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
            {distanceLoading ? <SkelValue /> : tripAssets.length}
          </div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>Mixers with trips</div>
        </div>
      </div>

      <ReadyMixPlantMap plantPins={plantPins} atPlantVehicles={buckets.plant} />

      {(buckets.jobsite.length > 0 || buckets.transit.length > 3) && !dispatchBusy && (
        <div className="bpl-card" style={{
          padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(124,58,237,0.08)', borderColor: 'rgba(124,58,237,0.3)',
        }}>
          <AlertCircle size={18} color="#7c3aed" />
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>
            <strong style={{ color: '#7c3aed' }}>{buckets.transit.length + buckets.jobsite.length} mixers in motion or stopped off-plant</strong>
            {' '}— worth a dispatch check while loads are still live (~90–120 min window). Off-plant stops are not confirmed jobsites.
          </div>
        </div>
      )}

      <div className="gv-scene" style={{ marginTop: 4 }}>
        <div className="gv-wrap">
          {/* Toolbar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            flexWrap: 'wrap', marginBottom: 12,
          }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {filterTabs.map(t => {
                const active = filter === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFilter(t.id)}
                    className="bpl-btn-secondary"
                    style={{
                      padding: '5px 11px', fontSize: 12,
                      background: active ? `${t.color}18` : undefined,
                      borderColor: active ? t.color : undefined,
                      color: active ? t.color : undefined,
                    }}
                  >
                    {t.label}
                    <span style={{
                      marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
                      background: active ? `${t.color}22` : 'var(--cd-surface-2)',
                    }}>
                      {dispatchBusy ? '—' : t.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div className="rmx-density" role="group" aria-label="Board density">
                <button
                  type="button"
                  className={`rmx-density-btn${density === 'cards' ? ' is-on' : ''}`}
                  aria-pressed={density === 'cards'}
                  onClick={() => { setDensity('cards'); setAllOpen(true); }}
                >
                  <LayoutGrid size={13} /> Cards
                </button>
                <button
                  type="button"
                  className={`rmx-density-btn${density === 'compact' ? ' is-on' : ''}`}
                  aria-pressed={density === 'compact'}
                  onClick={() => { setDensity('compact'); setAllOpen(true); }}
                >
                  <Rows3 size={13} /> Compact
                </button>
              </div>
              <button type="button" className="gv-btn-ghost" onClick={() => setAllOpen(o => !o)}>
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          </div>

          {dispatchBusy ? (
            <div className="bpl-card" style={{ padding: 16 }}><SkelTable rows={6} /></div>
          ) : byMixSite.length === 0 ? (
            <div className="bpl-card" style={{ padding: 32, textAlign: 'center', color: 'var(--cd-text-muted)' }}>
              No mixers match this filter
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {byMixSite.map(([site, list]) => (
                <SiteSection
                  key={site}
                  siteName={site}
                  vehicles={list}
                  startOpen={allOpen}
                  density={density}
                  opts={dispatchOpts}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
