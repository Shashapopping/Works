import { useMemo, useRef } from 'react';
import type { FleetVehicle } from '../../context/FleetContext';
import { isUsablePlaceAddress, vehicleHasResolvedPlace, vehiclePlaceAddress } from '../../lib/placeAddress';
import { statusDisplayLabel } from '../../lib/metricDefinitions';
import { useVirtualWindow } from '../../hooks/useVirtualWindow';

const GRID_COLS = 'minmax(72px,1fr) minmax(80px,1.2fr) minmax(90px,1.8fr) minmax(72px,1fr) minmax(90px,1.4fr) minmax(72px,1fr)';
const ROW_HEIGHT = 46;
const ROW_GAP = 6;

function getStatusColor(status: string) {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    Moving: { bg: '#dcfce7', text: '#16a34a', border: '#86efac' },
    Idle: { bg: '#fef3c7', text: '#d97706', border: '#fde68a' },
    'Excessive Idle': { bg: '#fef9c3', text: '#b45309', border: '#fcd34d' },
    Stationary: { bg: '#f0fdfa', text: '#0d9488', border: '#99f6e4' },
    Parked: { bg: '#fff7ed', text: '#ea580c', border: '#fed7aa' },
    Offline: { bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0' },
    Inactive: { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
  };
  return map[status] ?? map.Offline;
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleString('en-GB', {
      timeZone: 'Africa/Lagos',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function placeLabel(v: FleetVehicle) {
  const raw = vehiclePlaceAddress(v as any) || (typeof v.address === 'string' ? v.address.trim() : '');
  if (isUsablePlaceAddress(raw)) return raw;
  if (v.position?.latitude != null && v.position?.longitude != null) return 'Locating…';
  return raw || '—';
}

function FleetRow({ v, gridCols }: { v: FleetVehicle; gridCols: string }) {
  const colors = getStatusColor(v.status);
  const isExcess = v.status === 'Excessive Idle';
  const rowBg = isExcess ? '#fefce8' : 'var(--cd-surface)';
  const loc = placeLabel(v);

  return (
    <div
      className="bpl-fleet-table-row"
      style={{
        gridTemplateColumns: gridCols,
        backgroundColor: rowBg,
        borderColor: isExcess ? '#fcd34d' : 'var(--cd-border)',
        minHeight: ROW_HEIGHT,
      }}
    >
      <div className="bpl-fleet-cell-reg">{v.regNo}</div>
      <div className="bpl-fleet-cell-transporter">
        <span className="bpl-fleet-dot" style={{ background: 'var(--bpl-blue)' }} />
        {v.transporter}
      </div>
      <div className="bpl-fleet-cell-asset">{v.assetName}</div>
      <div>
        <span
          className="bpl-fleet-status-badge"
          style={{ backgroundColor: colors.bg, color: colors.text, borderColor: colors.border }}
        >
          <span className="bpl-fleet-status-dot" style={{ backgroundColor: colors.text }} />
          {statusDisplayLabel(v.status)}
        </span>
      </div>
      <div className="bpl-fleet-cell-loc" title={loc}>{loc}</div>
      <div className="bpl-fleet-cell-date">{formatDate(v.date)}</div>
    </div>
  );
}

interface Props {
  vehicles: FleetVehicle[];
}

export default function FleetCompactTable({ vehicles }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => [...vehicles]
      .filter(v => vehicleHasResolvedPlace(v as any) || isUsablePlaceAddress(v.address))
      .sort((a, b) => {
        const aOk = vehicleHasResolvedPlace(a as any) || isUsablePlaceAddress(a.address);
        const bOk = vehicleHasResolvedPlace(b as any) || isUsablePlaceAddress(b.address);
        if (aOk !== bOk) return aOk ? -1 : 1;
        return 0;
      }),
    [vehicles],
  );

  const { start, end, paddingTop, paddingBottom } = useVirtualWindow({
    count: rows.length,
    rowHeight: ROW_HEIGHT,
    gap: ROW_GAP,
    containerRef: bodyRef,
  });

  if (!rows.length) {
    return <div className="bpl-fleet-table-empty">No vehicles with resolved location yet.</div>;
  }

  const visible = rows.slice(start, end);

  return (
    <div className="bpl-fleet-table-wrap">
      <div className="bpl-fleet-table-head" style={{ gridTemplateColumns: GRID_COLS }}>
        <div>Reg. No.</div>
        <div>Transporter</div>
        <div>Asset Name</div>
        <div>Status</div>
        <div>Location</div>
        <div>Date</div>
      </div>
      <div className="bpl-fleet-table-body" ref={bodyRef}>
        {paddingTop > 0 && <div style={{ height: paddingTop, flexShrink: 0 }} aria-hidden />}
        {visible.map(v => (
          <FleetRow key={v.id} v={v} gridCols={GRID_COLS} />
        ))}
        {paddingBottom > 0 && <div style={{ height: paddingBottom, flexShrink: 0 }} aria-hidden />}
      </div>
    </div>
  );
}
