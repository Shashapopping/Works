import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, WifiOff, MapPin } from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import { SkelValue, SkelTable } from './data/DataBusy';
import { isUsablePlaceAddress, vehicleHasResolvedPlace } from '../lib/placeAddress';
import { makeScopedVehicleIdSet } from '../lib/siteScope';
import { cachePeek, CACHE_KEYS } from '../lib/apiCache';

interface Warning { eventId: string; label: string; timestamp: string; eventTime: string; }

interface Vehicle {
  id: string;
  regNo: string;
  transporter: string;
  site: string;
  zone: string;
  siteId: string | null;
  assetName: string;
  make: string;
  model: string;
  status: StatusType;
  date: string;
  panic: boolean;
  warnings?: Warning[];
  position?: { latitude: number; longitude: number; speed: number; heading: number; address: string };
  activeEvents: number;
}

type StatusType = 'Moving' | 'Idle' | 'Excessive Idle' | 'Stationary' | 'Parked' | 'Inactive' | 'Offline';
type StatusFilter = 'All' | StatusType;

const GROUP_ORDER = ['Alternative', 'Bulk Tankers', 'Cement', 'Inbound', 'LH Customer Assets', 'LH Quarry', 'Ready Mix'];

const GROUP_COLORS: Record<string, string> = {
  'Alternative': '#0d9488',
  'Bulk Tankers': '#0078D4',
  'Cement':      '#c2410c',
  'Inbound':     '#7C3AED',
  'LH Customer Assets': '#d97706',
  'LH Quarry':   '#16a34a',
  'Ready Mix':   '#e11d48',
  'Other':       '#6B7A8D',
};

function getGroup(zone: string): string {
  const z = (zone || '').toUpperCase();
  if (/BULK\s*TANKERS?/.test(z))                                               return 'Bulk Tankers';
  if (/QUARRY/.test(z))                                                          return 'LH Quarry';
  if (/INBOUND/.test(z))                                                         return 'Inbound';
  if (/READY.?MIX|RDYMIX/.test(z))                                              return 'Ready Mix';
  if (/DEPOT|CUSTOMER|AJAH|OREGUN|\bADO\b|\bAKURE\b|\bISEYIN\b/.test(z))       return 'LH Customer Assets';
  if (/CEMENT|LH\s*-\s*(NORTH|EAST|WEST)|\bMDD\b|\bDD\b|SPOT.?HIRE/.test(z)) return 'Cement';
  if (/ALTERNATIVE|ALT/.test(z))                                                return 'Alternative';
  return 'Other';
}

interface Props {
  statusFilter: StatusFilter;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

const STATUS: Record<StatusType, { color: string; bg: string; dot: string; label: string }> = {
  'Moving':         { color: '#16a34a', bg: 'rgba(22,163,74,0.12)',  dot: '#16a34a', label: 'Moving' },
  'Idle':           { color: '#A07830', bg: 'rgba(160,120,48,0.12)', dot: '#A07830', label: 'Idle' },
  'Excessive Idle': { color: '#B06230', bg: 'rgba(176,98,48,0.12)',  dot: '#B06230', label: 'Exc. Idle' },
  'Stationary':     { color: '#4D7FA0', bg: 'rgba(77,127,160,0.12)', dot: '#4D7FA0', label: 'Stationary' },
  'Parked':         { color: '#7C3AED', bg: 'rgba(124,58,237,0.12)', dot: '#7C3AED', label: 'Parked' },
  'Offline':        { color: '#6B7A8D', bg: 'rgba(107,122,141,0.1)', dot: '#6B7A8D', label: 'Inactive' },
  'Inactive':       { color: '#6878A0', bg: 'rgba(104,120,160,0.1)', dot: '#6878A0', label: 'Non-Operational' },
};

const STATUS_PRIORITY: Record<StatusType, number> = {
  'Moving': 7, 'Idle': 6, 'Excessive Idle': 5, 'Stationary': 4, 'Parked': 3, 'Offline': 2, 'Inactive': 1,
};


const STALE_MS = 60_000;
const WARNING_CLEAR_MS = 60_000;

function timeAgo(dateStr: string): string {
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
  const counts: Partial<Record<StatusType, number>> = {};
  vehicles.forEach(v => { counts[v.status] = (counts[v.status] ?? 0) + 1; });
  const order: StatusType[] = ['Moving', 'Idle', 'Excessive Idle', 'Stationary', 'Parked', 'Offline', 'Inactive'];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
      {order.filter(s => counts[s]).map(s => (
        <span key={s} style={{
          fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '999px',
          background: STATUS[s].bg, color: STATUS[s].color,
          border: `1px solid ${STATUS[s].color}25`,
          backdropFilter: 'var(--cd-glass-blur)',
        }}>
          {counts[s]} {STATUS[s].label}
        </span>
      ))}
    </div>
  );
}

function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const s = STATUS[vehicle.status] ?? STATUS['Offline'];
  const uniqueWarnings = [...new Set((vehicle.warnings ?? []).map(w => w.label))];
  const address = vehicle.position?.address && isUsablePlaceAddress(vehicle.position.address)
    ? vehicle.position.address : null;

  return (
    <div className="gv-card">
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
            background: s.dot,
            boxShadow: `0 0 0 2px ${s.bg}`,
          }} />
          <span style={{
            fontSize: '11px', fontWeight: '600', color: s.color,
            letterSpacing: '0.03em',
          }}>
            {s.label}
          </span>
        </div>
        <span style={{
          fontSize: '10px', color: 'var(--cd-text-soft)',
          fontVariantNumeric: 'tabular-nums' as const,
        }}>
          {timeAgo(vehicle.date)}
        </span>
      </div>

      {/* Reg number */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
        <span style={{
          fontSize: '16px', fontWeight: '700', color: 'var(--cd-text)',
          fontFamily: 'var(--cd-font-display)', letterSpacing: '-0.01em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {vehicle.regNo}
        </span>
      </div>

      {/* Asset name */}
      <div style={{
        fontSize: '12px', color: 'var(--cd-text-muted)', marginBottom: uniqueWarnings.length ? '8px' : '0',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {vehicle.assetName}
      </div>

      {/* Warning tags */}
      {uniqueWarnings.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
          {uniqueWarnings.slice(0, 2).map((lbl, i) => (
            <span key={i} style={{
              fontSize: '9px', fontWeight: '700', padding: '2px 7px', borderRadius: '999px',
              background: 'rgba(234,179,8,0.15)', color: '#a16207',
              border: '1px solid rgba(234,179,8,0.3)', letterSpacing: '0.02em',
            }}>{lbl}</span>
          ))}
          {uniqueWarnings.length > 2 && (
            <span style={{
              fontSize: '9px', fontWeight: '700', padding: '2px 7px', borderRadius: '999px',
              background: 'rgba(234,179,8,0.15)', color: '#a16207',
              border: '1px solid rgba(234,179,8,0.3)',
            }}>+{uniqueWarnings.length - 2}</span>
          )}
        </div>
      )}

      {/* Address footer */}
      {address && (
        <div style={{
          marginTop: '8px', paddingTop: '8px',
          borderTop: '1px solid rgba(128,128,128,0.12)',
          display: 'flex', alignItems: 'flex-start', gap: '4px',
        }}>
          <MapPin size={9} style={{ color: 'var(--cd-text-soft)', flexShrink: 0, marginTop: '1px' }} />
          <span style={{
            fontSize: '10px', color: 'var(--cd-text-soft)', lineHeight: '1.4',
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
          }}>
            {address}
          </span>
        </div>
      )}
    </div>
  );
}

interface ZoneSectionProps {
  siteName: string;
  vehicles: Vehicle[];
  startOpen: boolean;
}

function ZoneSection({ siteName, vehicles, startOpen }: ZoneSectionProps) {
  const [open, setOpen] = useState(startOpen);

  useEffect(() => { setOpen(startOpen); }, [startOpen]);

  return (
    <div className="gv-zone">
      <button
        className="gv-zone-header"
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '15px', fontWeight: '700', color: 'var(--cd-text)',
              fontFamily: 'var(--cd-font-display)', letterSpacing: '-0.01em',
            }}>
              {siteName}
            </span>
            <span style={{
              fontSize: '11px', fontWeight: '600', padding: '2px 9px', borderRadius: '999px',
              background: 'rgba(128,128,128,0.1)',
              color: 'var(--cd-text-muted)',
              border: '1px solid rgba(128,128,128,0.12)',
            }}>
              {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''}
            </span>
          </div>
          <StatusChips vehicles={vehicles} />
        </div>
        <div style={{ flexShrink: 0, color: 'var(--cd-text-muted)', marginLeft: '8px' }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && (
        <div className="gv-grid">
          {vehicles.map(v => <VehicleCard key={v.id} vehicle={v} />)}
        </div>
      )}
    </div>
  );
}

interface GroupSectionProps {
  groupName: string;
  siteGroups: [string, Vehicle[]][];
  startOpen: boolean;
}

function GroupSection({ groupName, siteGroups, startOpen }: GroupSectionProps) {
  const [open, setOpen] = useState(startOpen);
  const color = GROUP_COLORS[groupName] ?? GROUP_COLORS.Other;
  const total = siteGroups.reduce((n, [, vs]) => n + vs.length, 0);
  const allVehicles = siteGroups.flatMap(([, vs]) => vs);

  useEffect(() => { setOpen(startOpen); }, [startOpen]);

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '11px 16px',
          background: open ? `${color}14` : `${color}08`,
          border: `1px solid ${color}30`,
          borderRadius: open ? '10px 10px 0 0' : 10,
          cursor: 'pointer', textAlign: 'left',
          transition: 'all 0.15s',
        }}
      >
        <div style={{ width: 4, height: 22, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', flex: 1 }}>
          {groupName}
        </span>
        <StatusChips vehicles={allVehicles} />
        <span style={{ fontSize: 11, fontWeight: 600, color, marginLeft: 4, whiteSpace: 'nowrap' }}>
          {total} vehicle{total !== 1 ? 's' : ''}
        </span>
        <div style={{ color: 'var(--cd-text-muted)', flexShrink: 0, marginLeft: 4 }}>
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
      </button>

      {open && (
        <div style={{
          border: `1px solid ${color}25`, borderTop: 'none',
          borderRadius: '0 0 10px 10px', padding: '6px 8px 8px',
          background: `${color}04`,
        }}>
          {siteGroups.map(([site, vs]) => (
            <ZoneSection key={site} siteName={site} vehicles={vs} startOpen={false} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function GroupedView({ statusFilter, authFetch }: Props) {
  const { vehicles: scopedFleet, vehiclesLoading, selectedSites } = useFleet();
  void authFetch;
  const [vehicles, setVehicles] = useState<Vehicle[]>(() =>
    cachePeek<Vehicle[]>(CACHE_KEYS.fleetData) ?? [],
  );
  const loading = vehiclesLoading && vehicles.length === 0;
  const [isStale, setIsStale] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('All');
  const [allOpen, setAllOpen] = useState(false);

  const displayVehicles = useMemo(() => {
    if (!scopedFleet.length) {
      return selectedSites.length > 0 ? [] : vehicles;
    }
    const ids = makeScopedVehicleIdSet(scopedFleet);
    return vehicles.filter(v => ids.has(String(v.id)));
  }, [vehicles, scopedFleet, selectedSites]);

  // Count vehicles per major group for tab badges
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { All: displayVehicles.length };
    GROUP_ORDER.forEach(g => { counts[g] = 0; });
    displayVehicles.forEach(v => {
      const g = getGroup(v.zone);
      if (counts[g] !== undefined) counts[g]++;
      else counts[g] = 1;
    });
    return counts;
  }, [displayVehicles]);
  const warningTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastSuccess = useRef<number>(Date.now());

  const scheduleWarningClear = (id: string) => {
    if (warningTimers.current.has(id)) clearTimeout(warningTimers.current.get(id)!);
    const t = setTimeout(() => {
      setVehicles(prev => prev.map(v => v.id === id ? { ...v, warnings: [] } : v));
      warningTimers.current.delete(id);
    }, WARNING_CLEAR_MS);
    warningTimers.current.set(id, t);
  };

  useEffect(() => {
    const fresh = scopedFleet as unknown as Vehicle[];
    if (!fresh.length) return;
    lastSuccess.current = Date.now();
    setIsStale(false);
    setVehicles(prev => {
      const prevMap = new Map(prev.map(v => [v.id, v]));
      return fresh.map(v => {
        const old = prevMap.get(v.id);
        let mergedWarnings: Warning[] = [];
        if (v.warnings?.length) {
          v.warnings.forEach(w => {
            if (!old?.warnings?.some(ow => ow.eventId === w.eventId)) scheduleWarningClear(v.id);
          });
          mergedWarnings = v.warnings;
        } else if (old?.warnings?.length) {
          mergedWarnings = old.warnings;
        }
        return { ...v, warnings: mergedWarnings };
      });
    });
  }, [scopedFleet]);

  useEffect(() => {
    const iv = setInterval(() => {
      if (Date.now() - lastSuccess.current > STALE_MS) setIsStale(true);
    }, 10_000);
    return () => clearInterval(iv);
  }, []);

  const sortSites = (entries: [string, Vehicle[]][]): [string, Vehicle[]][] => {
    entries.forEach(([, vs], i) => {
      entries[i][1] = [...vs].sort((a, b) => {
        const aResolved = vehicleHasResolvedPlace(a);
        const bResolved = vehicleHasResolvedPlace(b);
        if (aResolved !== bResolved) return aResolved ? -1 : 1;
        const aw = a.warnings?.length ?? 0, bw = b.warnings?.length ?? 0;
        if (aw !== bw) return bw - aw;
        return STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status];
      });
    });
    return entries.sort(([, a], [, b]) => {
      const aw = a.filter(v => v.warnings?.length).length, bw = b.filter(v => v.warnings?.length).length;
      if (aw !== bw) return bw - aw;
      return b.length - a.length;
    });
  };

  // When a specific group is selected: flat site list for that group
  // When All: grouped by major group → site
  const { flatGroups, treeGroups } = useMemo(() => {
    const q = search.toLowerCase().trim();
    const hasSearch = q.length > 0;

    const filtered = displayVehicles.filter(v => {
      if (statusFilter !== 'All' && v.status !== statusFilter) return false;
      if (selectedGroup !== 'All' && getGroup(v.zone) !== selectedGroup) return false;
      if (!hasSearch && !vehicleHasResolvedPlace(v)) return false;
      if (!hasSearch) return true;
      return (
        v.regNo.toLowerCase().includes(q) ||
        v.assetName.toLowerCase().includes(q) ||
        v.site?.toLowerCase().includes(q) ||
        v.transporter?.toLowerCase().includes(q)
      );
    });

    // Flat: site → vehicles (used when a specific group is selected)
    const siteMap = new Map<string, Vehicle[]>();
    filtered.forEach(v => {
      const key = v.site || 'Unknown';
      if (!siteMap.has(key)) siteMap.set(key, []);
      siteMap.get(key)!.push(v);
    });
    const flat = sortSites([...siteMap.entries()]);

    // Tree: major group → site → vehicles (used when All)
    const tree = new Map<string, Map<string, Vehicle[]>>();
    GROUP_ORDER.forEach(g => tree.set(g, new Map()));
    tree.set('Other', new Map());
    filtered.forEach(v => {
      const g = getGroup(v.zone);
      const gMap = tree.get(g) ?? tree.get('Other')!;
      const site = v.site || 'Unknown';
      if (!gMap.has(site)) gMap.set(site, []);
      gMap.get(site)!.push(v);
    });

    const treeArr: [string, [string, Vehicle[]][]][] = [];
    [...GROUP_ORDER, 'Other'].forEach(g => {
      const gMap = tree.get(g);
      if (!gMap || gMap.size === 0) return;
      treeArr.push([g, sortSites([...gMap.entries()])]);
    });

    return { flatGroups: flat, treeGroups: treeArr };
  }, [displayVehicles, statusFilter, search, selectedGroup]);

  const totalShown = selectedGroup === 'All'
    ? treeGroups.reduce((n, [, sites]) => n + sites.reduce((m, [, vs]) => m + vs.length, 0), 0)
    : flatGroups.reduce((n, [, vs]) => n + vs.length, 0);

  const isEmpty = !loading && (selectedGroup === 'All' ? treeGroups.length === 0 : flatGroups.length === 0);

  return (
    <div className="gv-scene">
      <div className="gv-wrap">

        {/* Group tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          {['All', ...GROUP_ORDER].map(g => {
            const active = selectedGroup === g;
            const color = g === 'All' ? '#6B7A8D' : (GROUP_COLORS[g] ?? '#6B7A8D');
            const count = groupCounts[g] ?? 0;
            return (
              <button
                key={g}
                onClick={() => setSelectedGroup(g)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--cd-font-body)', fontSize: 12, fontWeight: active ? 700 : 500,
                  background: active ? `${color}18` : 'var(--cd-surface-2)',
                  color: active ? color : 'var(--cd-text-muted)',
                  outline: active ? `1.5px solid ${color}40` : '1.5px solid transparent',
                  transition: 'all 0.12s',
                }}
              >
                {g}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 999,
                  background: active ? `${color}22` : 'rgba(128,128,128,0.1)',
                  color: active ? color : 'var(--cd-text-muted)',
                }}>
                  {loading ? '—' : count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search + controls bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1', minWidth: '180px', maxWidth: '300px' }}>
            <Search size={13} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--cd-text-muted)', pointerEvents: 'none' }} />
            <input
              className="gv-search-input"
              type="text"
              placeholder="Search reg, name, site…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
            {isStale && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: '#d97706', fontWeight: '500' }}>
                <WifiOff size={12} /> Paused
              </span>
            )}
            <span style={{ fontSize: '12px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
              {loading ? <SkelValue /> : `${totalShown} vehicles`}
            </span>
            <button className="gv-btn-ghost" onClick={() => setAllOpen(o => !o)}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        </div>

        {/* Vehicle list */}
        {loading ? (
          <div style={{ padding: 12 }}><SkelTable rows={8} /></div>
        ) : isEmpty ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: 'var(--cd-text-muted)', gap: '12px' }}>
            <WifiOff size={28} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '14px' }}>No vehicles match the current filter</span>
          </div>
        ) : selectedGroup === 'All' ? (
          <div className="gv-zones-grid">
            {treeGroups.map(([groupName, sites]) => (
              <GroupSection key={groupName} groupName={groupName} siteGroups={sites} startOpen={allOpen} />
            ))}
          </div>
        ) : (
          <div className="gv-zones-grid">
            {flatGroups.map(([siteName, vs]) => (
              <ZoneSection key={siteName} siteName={siteName} vehicles={vs} startOpen={allOpen} />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
