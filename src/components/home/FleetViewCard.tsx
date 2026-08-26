import { useMemo, useState, type ElementType } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, Map as MapIcon, Table } from 'lucide-react';
import { useFleet, type StatusFilter } from '../../context/FleetContext';
import MapView from '../MapView';
import FleetGroupedCompact from './FleetGroupedCompact';
import FleetCompactTable from './FleetCompactTable';

type ViewMode = 'table' | 'map' | 'grouped';

interface Props {
  statusFilter: StatusFilter;
}

export default function FleetViewCard({ statusFilter }: Props) {
  const { vehicles, authFetch } = useFleet();
  const [viewMode, setViewMode] = useState<ViewMode>('map');

  const filtered = useMemo(() => {
    if (statusFilter === 'All') return vehicles;
    return vehicles.filter(v => v.status === statusFilter);
  }, [vehicles, statusFilter]);

  const handleAcknowledge = async (id: string) => {
    try {
      await authFetch('/api/acknowledged', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch { /* ignore */ }
  };

  const modes: { id: ViewMode; label: string; icon: ElementType }[] = [
    { id: 'table', label: 'Table', icon: Table },
    { id: 'grouped', label: 'Grouped', icon: LayoutGrid },
    { id: 'map', label: 'Map', icon: MapIcon },
  ];

  return (
    <div className="bpl-card bpl-live-fleet-card">
      <div className="bpl-live-fleet-header">
        <div className="bpl-live-fleet-header-left">
          <span className="bpl-live-fleet-title">Fleet</span>
        </div>
        <div className="bpl-live-fleet-header-right">
          <div className="bpl-live-fleet-tabs" role="tablist" aria-label="Fleet view">
            {modes.map(m => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === m.id}
                  className={`bpl-live-fleet-tab${viewMode === m.id ? ' active' : ''}`}
                  onClick={() => setViewMode(m.id)}
                >
                  <Icon size={12} />
                  {m.label}
                </button>
              );
            })}
          </div>
          <Link to="/fleet" className="bpl-card-link">View all</Link>
        </div>
      </div>

      <div className="bpl-live-fleet-body">
        {viewMode === 'table' && <FleetCompactTable vehicles={filtered} />}
        {viewMode === 'grouped' && <FleetGroupedCompact vehicles={filtered} />}
        {viewMode === 'map' && (
          <MapView
            compact
            authFetch={authFetch}
            statusFilter={statusFilter}
            onAcknowledge={handleAcknowledge}
          />
        )}
      </div>
    </div>
  );
}
