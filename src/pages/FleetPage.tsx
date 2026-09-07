import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutGrid, Map, Table } from 'lucide-react';
import { useFleet, type StatusFilter, type DistanceRange } from '../context/FleetContext';
import AnomaliesTable from '../components/AnomaliesTable';
import MapView from '../components/MapView';
import GroupedView from '../components/GroupedView';
import StatusStatsRow from '../components/home/StatusStatsRow';
import { defaultPageCustomRange } from '../lib/pagePeriod';

type ViewMode = 'table' | 'map' | 'grouped';

const VALID_STATUSES: StatusFilter[] = ['All', 'Moving', 'Idle', 'Excessive Idle', 'Stationary', 'Parked', 'Offline', 'Inactive'];

function parseStatusParam(value: string | null): StatusFilter {
  const match = VALID_STATUSES.find(s => s === value);
  return match || 'All';
}

export default function FleetPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => parseStatusParam(searchParams.get('status')));
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [metricPeriod, setMetricPeriod] = useState<DistanceRange>('week');
  const [metricCustom, setMetricCustom] = useState(defaultPageCustomRange);
  const { authFetch, metadata, vehicles, setDistanceRange } = useFleet();

  useEffect(() => {
    setStatusFilter(parseStatusParam(searchParams.get('status')));
  }, [searchParams]);

  const handleStatusFilterChange = useCallback((next: StatusFilter) => {
    setStatusFilter(next);
    if (next === 'All') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ status: next }, { replace: true });
    }
  }, [setSearchParams]);

  const handleMetricPeriodChange = useCallback((period: DistanceRange) => {
    setMetricPeriod(period);
    setDistanceRange(period, metricCustom);
  }, [setDistanceRange, metricCustom]);

  const handleMapAcknowledge = async (id: string) => {
    try {
      await authFetch('/api/acknowledged', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {}
  };

  const modes: { id: ViewMode; label: string; icon: typeof Table }[] = [
    { id: 'table', label: 'Table', icon: Table },
    { id: 'grouped', label: 'Grouped', icon: LayoutGrid },
    { id: 'map', label: 'Map', icon: Map },
  ];

  return (
    <div>
      <div className="bpl-page-header bpl-page-header-row">
        <div>
          <h1 className="bpl-page-title">Fleet</h1>
          <p className="bpl-page-subtitle">
            Live fleet monitor — {vehicles.length} vehicles
            {metadata.moving ? ` · ${metadata.moving} moving` : ''}
            {metadata.lastUpdate ? ` · updated ${new Date(metadata.lastUpdate).toLocaleTimeString('en-GB')}` : ''}
          </p>
        </div>
        <div className="bpl-reports-view-toggle">
          {modes.map(m => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                className={`bpl-reports-view-btn${viewMode === m.id ? ' active' : ''}`}
                onClick={() => setViewMode(m.id)}
                aria-label={`${m.label} view`}
              >
                <Icon size={14} />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      <StatusStatsRow
        statusFilter={statusFilter}
        onFilterChange={handleStatusFilterChange}
        metricPeriod={metricPeriod}
        onMetricPeriodChange={handleMetricPeriodChange}
        metricCustom={metricCustom}
        onMetricCustomChange={custom => {
          setMetricCustom(custom);
          if (metricPeriod === 'custom') setDistanceRange('custom', custom);
        }}
      />

      <div className="bpl-card" style={{ marginTop: 16, padding: viewMode === 'table' ? 0 : 12, overflow: 'hidden' }}>
        {viewMode === 'table' && (
          <AnomaliesTable
            statusFilter={statusFilter}
            onFilterChange={f => handleStatusFilterChange(f as StatusFilter)}
            authFetch={authFetch}
          />
        )}
        {viewMode === 'grouped' && (
          <GroupedView statusFilter={statusFilter} authFetch={authFetch} />
        )}
        {viewMode === 'map' && (
          <MapView
            authFetch={authFetch}
            statusFilter={statusFilter}
            onAcknowledge={handleMapAcknowledge}
          />
        )}
      </div>
    </div>
  );
}
