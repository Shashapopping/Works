import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import type { FleetVehicle } from '../../context/FleetContext';

const STATUS_META: Record<string, { label: string; color: string; dot: string; bg: string }> = {
  Moving: { label: 'Moving', color: '#16a34a', dot: '#16a34a', bg: 'rgba(22,163,74,0.12)' },
  Idle: { label: 'Idle', color: '#d97706', dot: '#d97706', bg: 'rgba(217,119,6,0.12)' },
  'Excessive Idle': { label: 'Excess Idle', color: '#b45309', dot: '#b45309', bg: 'rgba(180,83,9,0.12)' },
  Stationary: { label: 'Stationary', color: '#0d9488', dot: '#0d9488', bg: 'rgba(13,148,136,0.12)' },
  Parked: { label: 'Parked', color: '#7c3aed', dot: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
  Inactive: { label: 'Inactive', color: '#2563eb', dot: '#2563eb', bg: 'rgba(37,99,235,0.12)' },
  Offline: { label: 'Offline', color: '#64748b', dot: '#64748b', bg: 'rgba(100,116,139,0.12)' },
};

function StatusChips({ vehicles }: { vehicles: FleetVehicle[] }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    vehicles.forEach(v => map.set(v.status, (map.get(v.status) ?? 0) + 1));
    return [...map.entries()];
  }, [vehicles]);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {counts.map(([status, count]) => {
        const meta = STATUS_META[status] ?? STATUS_META.Offline;
        return (
          <span
            key={status}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
              background: meta.bg,
              color: meta.color,
              border: `1px solid color-mix(in srgb, ${meta.color} 25%, transparent)`,
            }}
          >
            {meta.label} {count}
          </span>
        );
      })}
    </div>
  );
}

function VehicleCard({ vehicle }: { vehicle: FleetVehicle }) {
  const meta = STATUS_META[vehicle.status] ?? STATUS_META.Offline;

  return (
    <div className="gv-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.dot }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: meta.color }}>
            {meta.label}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--cd-font-display)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {vehicle.regNo}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {vehicle.assetName}
      </div>
      {vehicle.address && vehicle.address !== '—' && (
        <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid rgba(128,128,128,0.12)', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          <MapPin size={9} style={{ color: 'var(--cd-text-muted)', flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--cd-text-muted)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {vehicle.address}
          </span>
        </div>
      )}
    </div>
  );
}

function ZoneSection({ siteName, vehicles, startOpen }: { siteName: string; vehicles: FleetVehicle[]; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);

  useEffect(() => {
    setOpen(startOpen);
  }, [startOpen]);

  return (
    <div className="gv-zone">
      <button type="button" className="gv-zone-header" onClick={() => setOpen(o => !o)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--cd-font-display)' }}>{siteName}</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: 'rgba(128,128,128,0.1)', color: 'var(--cd-text-muted)' }}>
              {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''}
            </span>
          </div>
          <StatusChips vehicles={vehicles} />
        </div>
        <div style={{ flexShrink: 0, color: 'var(--cd-text-muted)', marginLeft: 8 }}>
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

interface Props {
  vehicles: FleetVehicle[];
}

export default function FleetGroupedCompact({ vehicles }: Props) {
  const [allOpen, setAllOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, FleetVehicle[]>();
    vehicles.forEach(v => {
      const key = v.site || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    });
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [vehicles]);

  if (!groups.length) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>No vehicles match this filter.</div>;
  }

  return (
    <div className="gv-scene gv-scene-compact">
      <div className="gv-wrap">
        <div className="gv-compact-toolbar">
          <button type="button" className="gv-btn-ghost" onClick={() => setAllOpen(o => !o)}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
        <div className="gv-zones-grid gv-zones-compact">
          {groups.map(([siteName, vs]) => (
            <ZoneSection key={siteName} siteName={siteName} vehicles={vs} startOpen={allOpen} />
          ))}
        </div>
      </div>
    </div>
  );
}
