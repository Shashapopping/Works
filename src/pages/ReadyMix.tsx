import { useMemo, useState, useEffect } from 'react';
import {
  Timer, Truck, Factory, MapPin, Navigation, AlertCircle, Droplets,
  ChevronDown, ChevronUp, LayoutGrid, Rows3,
} from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import type { Vehicle } from '../context/FleetContext';
import { KpiCard } from '../components/KpiCard';
import {
  segmentVehicles, readyMixPlant, readyMixDispatchState, locationLabel,
  deriveReadyMixPlantPins, openTripAssetIdsFromSession,
  STATUS_COLOR,
} from '../lib/segmentMetrics';
import { authFetch } from '../context/FleetContext';

const DISPATCH_META = {
  transit: { label: 'In transit', color: '#d97706', short: 'Transit' },
  plant: { label: 'At plant', color: '#16a34a', short: 'Plant' },
  jobsite: { label: 'On jobsite', color: '#7c3aed', short: 'Jobsite' },
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

function StatusChips({ vehicles }: { vehicles: Vehicle[] }) {
  const counts: Record<string, number> = {};
  for (const v of vehicles) counts[v.status] = (counts[v.status] ?? 0) + 1;
  const order = ['Moving', 'Idle', 'Excessive Idle', 'Stationary', 'Parked', 'Offline', 'Inactive'];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {order.filter(s => counts[s]).map(s => {
        const color = STATUS_COLOR[s] ?? '#6B7A8D';
        return (
          <span key={s} style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
            background: `${color}18`, color,
            border: `1px solid ${color}25`,
          }}>
            {counts[s]} {s === 'Excessive Idle' ? 'Exc. Idle' : s}
          </span>
        );
      })}
    </div>
  );
}

type DispatchOpts = Parameters<typeof readyMixDispatchState>[1];

function DispatchChips({ vehicles, opts }: { vehicles: Vehicle[]; opts?: DispatchOpts }) {
  const counts: Partial<Record<keyof typeof DISPATCH_META, number>> = {};
  for (const v of vehicles) {
    const s = readyMixDispatchState(v, opts);
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
      {(Object.keys(DISPATCH_META) as (keyof typeof DISPATCH_META)[]).filter(k => counts[k]).map(k => {
        const m = DISPATCH_META[k];
        return (
          <span key={k} style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
            background: `${m.color}14`, color: m.color, border: `1px solid ${m.color}30`,
          }}>
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
    <div className="gv-card" style={{ borderTop: `3px solid ${meta.color}` }}>
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
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(90px, 110px) minmax(70px, 90px) minmax(70px, 90px) 1fr auto',
      gap: 10, alignItems: 'center',
      padding: '8px 12px',
      borderBottom: '1px solid var(--cd-border)',
      background: 'var(--cd-surface)',
    }}>
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
          {/* Quick info always visible when collapsed */}
          <StatusChips vehicles={vehicles} />
          <DispatchChips vehicles={vehicles} opts={opts} />
        </div>
        <div style={{ flexShrink: 0, color: 'var(--cd-text-muted)', marginLeft: 8 }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && (
        density === 'cards' ? (
          <div className="gv-grid">
            {vehicles.map(v => <MixerCard key={v.id} v={v} opts={opts} />)}
          </div>
        ) : (
          <div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(90px, 110px) minmax(70px, 90px) minmax(70px, 90px) 1fr auto',
              gap: 10, padding: '6px 12px',
              fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--cd-text-muted)', background: 'var(--cd-surface-2)',
              borderBottom: '1px solid var(--cd-border)',
            }}>
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
  const { vehicles } = useFleet();
  const [filter, setFilter] = useState<DispatchFilter>('all');
  const [allOpen, setAllOpen] = useState(true);
  const [density, setDensity] = useState<BoardDensity>('cards');
  const [openTripAssetIds, setOpenTripAssetIds] = useState<Set<string>>(() => new Set());

  const fleet = useMemo(() => segmentVehicles(vehicles, 'readyMix'), [vehicles]);
  const plantPins = useMemo(() => deriveReadyMixPlantPins(fleet), [fleet]);
  const dispatchOpts = useMemo(
    () => ({ plantPins, openTripAssetIds }),
    [plantPins, openTripAssetIds],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/trips/session');
        if (!res.ok) return;
        const trips = await res.json();
        if (!cancelled && Array.isArray(trips)) {
          setOpenTripAssetIds(openTripAssetIdsFromSession(trips));
        }
      } catch {
        /* trips optional — GPS geofence still works */
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
    { id: 'jobsite', label: 'Jobsite', count: buckets.jobsite.length, color: DISPATCH_META.jobsite.color },
    { id: 'parked', label: 'Parked', count: buckets.parked.length, color: DISPATCH_META.parked.color },
    { id: 'offline', label: 'Offline', count: buckets.offline.length, color: DISPATCH_META.offline.color },
  ];

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Ready Mix Dispatch</h1>
        <p className="bpl-page-subtitle">
          Lagos, Abuja & Port Harcourt — “At plant” confirmed by GPS (±1.5 km) and true idle (speed under 5 km/h), with open trips backing jobsite.
        </p>
      </div>

      <div className="bpl-kpi-grid">
        <KpiCard
          label="In Transit"
          value={buckets.transit.length}
          sub="Moving or speed ≥ 5 km/h"
          color="#d97706"
          icon={Truck}
          tip="Live MiX status Moving, or GPS speed still ≥ 5 km/h (filters stale Parked/Idle while rolling)."
        />
        <KpiCard
          label="At Plant"
          value={buckets.plant.length}
          sub="Stopped inside plant geofence"
          color="#16a34a"
          icon={Factory}
          tip="Truly stopped (Idle/Stationary/Parked + speed under 5 km/h) and within 1.5 km of a Ready Mix plant pin (seed hubs + live clusters from idle plant-site mixers)."
        />
        <KpiCard
          label="On Jobsite"
          value={buckets.jobsite.length}
          sub="Stopped away from plant"
          color="#7c3aed"
          icon={Timer}
          tip="Truly stopped outside plant geofence. Open MiX trips (no TripEnd) strengthen jobsite vs parked."
        />
        <KpiCard
          label="Mixer Fleet"
          value={fleet.length}
          sub={`${plants} hubs · ${buckets.offline.length} offline`}
          color="#7c3aed"
          icon={Droplets}
          tip="All Ready Mix segment assets. Sub-line = distinct plant hubs inferred from MiX site names, plus Offline/Inactive count."
        />
      </div>

      {(buckets.jobsite.length > 0 || buckets.transit.length > 3) && (
        <div className="bpl-card" style={{
          padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(124,58,237,0.08)', borderColor: 'rgba(124,58,237,0.3)',
        }}>
          <AlertCircle size={18} color="#7c3aed" />
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>
            <strong style={{ color: '#7c3aed' }}>{buckets.transit.length + buckets.jobsite.length} time-critical loads</strong>
            {' '}need dispatch attention — confirm ETAs and jobsite readiness before concrete sets (~90–120 min window).
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
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                className="gv-btn-ghost"
                onClick={() => setDensity(d => d === 'cards' ? 'compact' : 'cards')}
                title={density === 'cards' ? 'Switch to compact rows' : 'Switch to cards'}
              >
                {density === 'cards' ? <><Rows3 size={13} /> Compact</> : <><LayoutGrid size={13} /> Cards</>}
              </button>
              <button type="button" className="gv-btn-ghost" onClick={() => setAllOpen(o => !o)}>
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          </div>

          {byMixSite.length === 0 ? (
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
