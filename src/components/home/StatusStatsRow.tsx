import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck, Navigation, Clock, MapPin, ParkingCircle, WifiOff, Ban, Fuel, Route, ShieldAlert,
} from 'lucide-react';
import { useFleet, type StatusFilter, type DistanceRange } from '../../context/FleetContext';
import WidgetStatGraphic from './WidgetStatGraphic';
import InfoTip from '../InfoTip';
import { STATUS_DEFINITIONS } from '../../lib/metricDefinitions';
import { useFuelConsumptionByDistanceRange } from '../../hooks/useFuelConsumption';
import { useHosRecords } from '../../hooks/useHosRecords';
import { SkelValue } from '../data/DataBusy';
import { FATIGUE_ENABLED } from '../../config/fatigue';

export type MetricPeriod = DistanceRange;

const DISTANCE_PERIOD_LABELS: Record<DistanceRange, string> = {
  '24h': 'Today',
  currentMonth: 'This Month',
  lastMonth: 'Last Month',
};

const STATUS_STATS = [
  { key: 'totalVehicles' as const, label: 'Total', filter: 'All' as StatusFilter, color: '#7c3aed', icon: Truck, tip: STATUS_DEFINITIONS.total, href: '/fleet' },
  { key: 'moving' as const, label: 'Moving', filter: 'Moving' as StatusFilter, color: '#16a34a', icon: Navigation, tip: STATUS_DEFINITIONS.moving, href: '/fleet?status=Moving' },
  { key: 'idle' as const, label: 'Idle', filter: 'Idle' as StatusFilter, color: '#d97706', icon: Clock, tip: STATUS_DEFINITIONS.idle, href: '/fleet?status=Idle' },
  { key: 'stationary' as const, label: 'Stationary', filter: 'Stationary' as StatusFilter, color: '#0d9488', icon: MapPin, tip: STATUS_DEFINITIONS.stationary, href: '/fleet?status=Stationary' },
  { key: 'parked' as const, label: 'Parked', filter: 'Parked' as StatusFilter, color: '#ea580c', icon: ParkingCircle, tip: STATUS_DEFINITIONS.parked, href: '/fleet?status=Parked' },
  { key: 'offline' as const, label: 'Offline', filter: 'Offline' as StatusFilter, color: '#64748b', icon: WifiOff, tip: STATUS_DEFINITIONS.offline, href: '/fleet?status=Offline' },
  { key: 'inactive' as const, label: 'Non-Operational', filter: 'Inactive' as StatusFilter, color: '#2563eb', icon: Ban, tip: STATUS_DEFINITIONS.nonOperational, href: '/fleet?status=Inactive' },
];

interface Props {
  statusFilter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
  metricPeriod: MetricPeriod;
  onMetricPeriodChange: (p: MetricPeriod) => void;
  /** When true (Dashboard/home), status cards navigate to Fleet with a status query. When false (Fleet page itself), they just set the local filter. */
  navigateOnStatusClick?: boolean;
}

export default function StatusStatsRow({
  statusFilter,
  onFilterChange,
  metricPeriod,
  onMetricPeriodChange,
  navigateOnStatusClick = false,
}: Props) {
  const navigate = useNavigate();
  const { metadata, totalDistanceKm, distanceLoading, vehiclesLoading } = useFleet();
  const { data: fuelData, totalLiters: tripFuelLiters, loading: fuelLoading } = useFuelConsumptionByDistanceRange(metricPeriod);
  const { violationCount: hosViolations, loading: hosLoading } = useHosRecords();

  const quarryFuelLiters = useMemo(() => {
    if (tripFuelLiters > 0) return tripFuelLiters;
    const assets = fuelData?.assets ?? [];
    const periodDrop = assets.reduce((s, a) => s + (a.periodFuelLiters || 0), 0);
    if (periodDrop > 0) return Math.round(periodDrop);
    return tripFuelLiters;
  }, [tripFuelLiters, fuelData]);

  const fuelDistanceKm = useMemo(() => {
    return Math.round((fuelData?.assets ?? []).reduce((s, a) => s + (a.totalDistanceKm || 0), 0));
  }, [fuelData]);

  const getValue = (key: typeof STATUS_STATS[number]['key']) => {
    if (key === 'totalVehicles') return metadata.totalVehicles;
    return metadata[key];
  };

  const getStatusCardClass = (key: typeof STATUS_STATS[number]['key']) => {
    switch (key) {
      case 'inactive':
        return 'bpl-status-stat--status-compact';
      default:
        return 'bpl-status-stat--status-regular';
    }
  };

  return (
    <div className="bpl-status-stats-layout">
      <div className="bpl-status-stats-grid">
        {STATUS_STATS.map(stat => {
          const Icon = stat.icon;
          const value = getValue(stat.key);
          const isActive = !navigateOnStatusClick && (stat.filter === 'All' ? statusFilter === 'All' : statusFilter === stat.filter);
          const pct = stat.filter !== 'All' && metadata.totalVehicles > 0
            ? Math.round((value / metadata.totalVehicles) * 100)
            : null;

          return (
            <button
              key={stat.key}
              type="button"
              className={`bpl-card bpl-status-stat ${getStatusCardClass(stat.key)}${isActive ? ' active' : ''}`}
              style={{
                borderTopColor: stat.color,
                cursor: 'pointer',
                background: isActive ? `${stat.color}10` : undefined,
                outline: isActive ? `1.5px solid ${stat.color}40` : 'none',
              }}
              onClick={() => {
                if (navigateOnStatusClick) { navigate(stat.href); return; }
                onFilterChange(stat.filter);
              }}
            >
              <div className="bpl-status-stat-inner">
                <div className="bpl-status-stat-copy">
                  {stat.key === 'inactive' ? (
                    <span className="bpl-status-stat-label bpl-status-stat-label--stacked">
                      <span>Non-</span>
                      <span>Operational</span>
                    </span>
                  ) : (
                    <span className="bpl-status-stat-label" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {stat.label}
                      <InfoTip text={stat.tip} label={stat.label} />
                    </span>
                  )}
                  <div className="bpl-status-stat-value" style={{ color: stat.color }}>
                    {vehiclesLoading ? <SkelValue /> : value}
                  </div>
                  <div className="bpl-status-stat-sub">
                    {pct !== null ? `${pct}% of fleet` : 'vehicles'}
                  </div>
                </div>
                <WidgetStatGraphic color={stat.color} icon={Icon} />
              </div>
            </button>
          );
        })}
      </div>

      <div className="bpl-status-metrics-col">
        <div className="bpl-status-metrics-stack">
          <button
            type="button"
            className="bpl-card bpl-status-stat bpl-status-metric-card bpl-status-stat--metric-regular"
            style={{ borderTopColor: '#8b5cf6', cursor: 'pointer', textAlign: 'left', width: '100%' }}
            title="Open trips"
            onClick={() => navigate('/trips')}
          >
            <div className="bpl-status-stat-inner">
              <div className="bpl-status-stat-copy">
                <span className="bpl-status-stat-label bpl-status-stat-label--stacked">
                  <span>Fleet</span>
                  <span>Distance</span>
                </span>
                <div className="bpl-status-stat-value" style={{ color: '#8b5cf6' }}>
                  {distanceLoading ? <SkelValue wide /> : (
                    <>
                      {totalDistanceKm.toLocaleString()}
                      <span className="bpl-status-metric-unit">km</span>
                    </>
                  )}
                </div>
                <div className="bpl-status-stat-sub">
                  <select
                    className="bpl-status-period-select"
                    value={metricPeriod}
                    onChange={e => onMetricPeriodChange(e.target.value as MetricPeriod)}
                    onClick={e => e.stopPropagation()}
                    aria-label="Distance time period"
                  >
                    {(Object.keys(DISTANCE_PERIOD_LABELS) as DistanceRange[]).map(p => (
                      <option key={p} value={p}>{DISTANCE_PERIOD_LABELS[p]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <WidgetStatGraphic color="#8b5cf6" icon={Route} size="xs" />
            </div>
          </button>

          <button
            type="button"
            className="bpl-card bpl-status-stat bpl-status-metric-card bpl-status-stat--metric-compact"
            style={{ borderTopColor: '#CC0000', cursor: FATIGUE_ENABLED ? 'pointer' : 'default', textAlign: 'left', width: '100%' }}
            title="Open hours-of-service tracking"
            onClick={() => {
              if (!FATIGUE_ENABLED) return;
              navigate('/drivers/fatigue');
            }}
          >
            <div className="bpl-status-stat-inner">
              <div className="bpl-status-stat-copy">
                <span className="bpl-status-stat-label-wrap">
                  <span className="bpl-status-stat-label bpl-status-stat-label--stacked">
                    <span>HOS</span>
                    <span>Violations</span>
                  </span>
                  <InfoTip text="Drivers with an active HOS breach: over 4h continuous (resets after 30+ min rest), over 8h continuous in a rolling 24h cycle, or missing ≥24h continuous rest in the last 7 days." label="HOS Violations" />
                </span>
                <div
                  className="bpl-status-stat-value"
                  style={{ color: '#CC0000', animation: !hosLoading && hosViolations > 0 ? 'pulse 1.5s infinite' : 'none' }}
                >
                  {hosLoading ? <SkelValue /> : hosViolations}
                </div>
                <div className="bpl-status-stat-sub">4h / 8h / weekly rest</div>
              </div>
              <WidgetStatGraphic color="#CC0000" icon={ShieldAlert} size="xs" />
            </div>
          </button>
        </div>

        <div className="bpl-status-metrics-stack">
          <button
            type="button"
            className="bpl-card bpl-status-stat bpl-status-metric-card bpl-status-stat--metric-regular"
            style={{ borderTopColor: '#0891b2', cursor: 'pointer', textAlign: 'left', width: '100%' }}
            title="Open fuel consumption"
            onClick={() => navigate('/fuel/consumption')}
          >
            <div className="bpl-status-stat-inner">
              <div className="bpl-status-stat-copy">
                <span className="bpl-status-stat-label bpl-status-stat-label--stacked">
                  <span>Fuel</span>
                  <span>Distance</span>
                </span>
                <InfoTip text="Distance covered only by vehicles that reported fuel probe data in this period — pair with Fuel Used for a fair L/km." label="Fuel Distance" />
                <div className="bpl-status-stat-value" style={{ color: '#0891b2' }}>
                  {fuelLoading ? <SkelValue wide /> : (
                    <>
                      {fuelDistanceKm.toLocaleString()}
                      <span className="bpl-status-metric-unit">km</span>
                    </>
                  )}
                </div>
                <div className="bpl-status-stat-sub">
                  <select
                    className="bpl-status-period-select"
                    value={metricPeriod}
                    onChange={e => onMetricPeriodChange(e.target.value as MetricPeriod)}
                    onClick={e => e.stopPropagation()}
                    aria-label="Fuel time period"
                  >
                    {(Object.keys(DISTANCE_PERIOD_LABELS) as DistanceRange[]).map(p => (
                      <option key={p} value={p}>{DISTANCE_PERIOD_LABELS[p]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <WidgetStatGraphic color="#0891b2" icon={Route} size="xs" />
            </div>
          </button>

          <button
            type="button"
            className="bpl-card bpl-status-stat bpl-status-metric-card bpl-status-stat--metric-compact"
            style={{ borderTopColor: '#f97316', cursor: 'pointer', textAlign: 'left', width: '100%' }}
            title="Open quarry fuel consumption"
            onClick={() => navigate('/fuel/consumption')}
          >
            <div className="bpl-status-stat-inner">
              <div className="bpl-status-stat-copy">
                <span className="bpl-status-stat-label bpl-status-stat-label--stacked">
                  <span>Fuel</span>
                  <span>Used</span>
                </span>
                <div className="bpl-status-stat-value" style={{ color: '#f97316' }}>
                  {fuelLoading ? <SkelValue wide /> : (
                    <>
                      {quarryFuelLiters.toLocaleString()}
                      <span className="bpl-status-metric-unit">L</span>
                    </>
                  )}
                </div>
                <div className="bpl-status-stat-sub">
                  <select
                    className="bpl-status-period-select"
                    value={metricPeriod}
                    onChange={e => onMetricPeriodChange(e.target.value as MetricPeriod)}
                    onClick={e => e.stopPropagation()}
                    aria-label="Fuel time period"
                  >
                    {(Object.keys(DISTANCE_PERIOD_LABELS) as DistanceRange[]).map(p => (
                      <option key={p} value={p}>{DISTANCE_PERIOD_LABELS[p]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <WidgetStatGraphic color="#f97316" icon={Fuel} size="xs" />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
