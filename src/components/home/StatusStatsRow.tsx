import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck, Navigation, Clock, MapPin, ParkingCircle, WifiOff, Ban, Fuel, Route, ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { useFleet, type StatusFilter, type DistanceRange } from '../../context/FleetContext';
import { useAuth } from '../../context/AuthContext';
import WidgetStatGraphic from './WidgetStatGraphic';
import InfoTip from '../InfoTip';
import PeriodSelect, { type PeriodValue } from './PeriodSelect';
import CustomDateTimeRange, { ensureCustomRangeDefaults } from '../CustomDateTimeRange';
import { SkelValue } from '../data/DataBusy';
import { STATUS_DEFINITIONS } from '../../lib/metricDefinitions';
import { useFuelConsumptionByDistanceRange } from '../../hooks/useFuelConsumption';
import { filterHosRecordsByAssignedSite } from '../../lib/siteScope';
import { isFeatureLocked } from '../../config/lockedFeatures';

export type MetricPeriod = DistanceRange;

type StatusCard = {
  kind: 'status';
  key: 'totalVehicles' | 'moving' | 'idle' | 'stationary' | 'parked' | 'offline' | 'inactive';
  label: string;
  filter: StatusFilter;
  color: string;
  icon: LucideIcon;
  tip: string;
  href: string;
};

type MetricCard = {
  kind: 'metric';
  key: 'distance' | 'hos' | 'fuel';
  label: string;
  color: string;
  icon: LucideIcon;
  tip: string;
  href: string;
};

/** Top row: Total · Moving · Idle · Stationary · Fleet Distance */
const TOP_CARDS: Array<StatusCard | MetricCard> = [
  {
    kind: 'status',
    key: 'totalVehicles',
    label: 'Total',
    filter: 'All',
    color: '#7c3aed',
    icon: Truck,
    tip: STATUS_DEFINITIONS.total,
    href: '/fleet',
  },
  {
    kind: 'status',
    key: 'moving',
    label: 'Moving',
    filter: 'Moving',
    color: '#16a34a',
    icon: Navigation,
    tip: STATUS_DEFINITIONS.moving,
    href: '/fleet?status=Moving',
  },
  {
    kind: 'status',
    key: 'idle',
    label: 'Idle',
    filter: 'Idle',
    color: '#d97706',
    icon: Clock,
    tip: STATUS_DEFINITIONS.idle,
    href: '/fleet?status=Idle',
  },
  {
    kind: 'status',
    key: 'stationary',
    label: 'Stationary',
    filter: 'Stationary',
    color: '#0d9488',
    icon: MapPin,
    tip: STATUS_DEFINITIONS.stationary,
    href: '/fleet?status=Stationary',
  },
  {
    kind: 'metric',
    key: 'distance',
    label: 'Fleet Distance',
    color: '#8b5cf6',
    icon: Route,
    tip: 'Total distance for the whole fleet in the selected period (all trips).',
    href: '/trips',
  },
];

/** Bottom row: Parked · Inactive · Non-operational · HOS · Fuel */
const BOTTOM_CARDS: Array<StatusCard | MetricCard> = [
  {
    kind: 'status',
    key: 'parked',
    label: 'Parked',
    filter: 'Parked',
    color: '#ea580c',
    icon: ParkingCircle,
    tip: STATUS_DEFINITIONS.parked,
    href: '/fleet?status=Parked',
  },
  {
    kind: 'status',
    key: 'offline',
    label: 'Inactive',
    filter: 'Offline',
    color: '#64748b',
    icon: WifiOff,
    tip: STATUS_DEFINITIONS.offline,
    href: '/fleet?status=Offline',
  },
  {
    kind: 'status',
    key: 'inactive',
    label: 'Non-operational',
    filter: 'Inactive',
    color: '#2563eb',
    icon: Ban,
    tip: STATUS_DEFINITIONS.nonOperational,
    href: '/fleet?status=Inactive',
  },
  {
    kind: 'metric',
    key: 'hos',
    label: 'HOS Violations',
    color: '#CC0000',
    icon: ShieldAlert,
    tip: 'Drivers currently over 4 hours continuous driving (hours of service). Clock resets after a ≥30 min rest (parked gap or engine-off).',
    href: '/drivers/fatigue',
  },
  {
    kind: 'metric',
    key: 'fuel',
    label: 'Fuel Used',
    color: '#f97316',
    icon: Fuel,
    tip: 'Total fuel used on quarry assets in the selected period (tank drop / trip fuel). Non-quarry sites show 0.',
    href: '/fuel/monitoring',
  },
];

const ALL_CARDS = [...TOP_CARDS, ...BOTTOM_CARDS];

interface Props {
  statusFilter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
  metricPeriod: MetricPeriod;
  onMetricPeriodChange: (p: MetricPeriod) => void;
  metricCustom: { from: string; to: string };
  onMetricCustomChange: (c: { from: string; to: string }) => void;
  /** When true (Dashboard/home), status cards navigate to Fleet with a status query. When false (Fleet page itself), they just set the local filter. */
  navigateOnStatusClick?: boolean;
}

export default function StatusStatsRow({
  statusFilter,
  onFilterChange,
  metricPeriod,
  onMetricPeriodChange,
  metricCustom,
  onMetricCustomChange,
  navigateOnStatusClick = false,
}: Props) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const showFuelConsumption = hasPermission('fuel-consumption') && !isFeatureLocked('fuel-consumption');
  const {
    metadata,
    totalDistanceKm,
    distanceLoading,
    vehiclesLoading,
    hosRecords,
    hosLoading,
    vehicles,
    scopedAssetIds,
    siteFilterActive,
  } = useFleet();
  const { data: fuelData, totalLiters: tripFuelLiters, loading: fuelLoading } = useFuelConsumptionByDistanceRange(
    metricPeriod,
    metricCustom,
    siteFilterActive ? scopedAssetIds : [],
    showFuelConsumption && (!siteFilterActive || scopedAssetIds.length > 0),
  );
  const scopedHosRecords = useMemo(
    () => filterHosRecordsByAssignedSite(hosRecords, vehicles, siteFilterActive),
    [hosRecords, vehicles, siteFilterActive],
  );
  const violationCount = scopedHosRecords.filter(r => r.status === 'violation').length;

  const fuelLiters = useMemo(() => {
    if (tripFuelLiters > 0) return tripFuelLiters;
    const assets = fuelData?.assets ?? [];
    const periodDrop = assets.reduce((s, a) => s + (a.periodFuelLiters || 0), 0);
    if (periodDrop > 0) return Math.round(periodDrop);
    return tripFuelLiters;
  }, [tripFuelLiters, fuelData]);

  const cards = useMemo(
    () => (showFuelConsumption ? ALL_CARDS : ALL_CARDS.filter(c => !(c.kind === 'metric' && c.key === 'fuel'))),
    [showFuelConsumption],
  );

  const statusCardsLoading = vehiclesLoading && metadata.totalVehicles === 0 && !metadata.lastUpdate;

  const getStatusValue = (key: StatusCard['key']) => {
    if (key === 'totalVehicles') return metadata.totalVehicles;
    return metadata[key];
  };

  const periodControl = (
    <div className="bpl-status-metric-period-wrap" onClick={e => e.stopPropagation()}>
      <PeriodSelect
        value={metricPeriod as PeriodValue}
        includeCustom
        onChange={p => {
          onMetricPeriodChange(p as MetricPeriod);
          if (p === 'custom') {
            ensureCustomRangeDefaults(metricCustom.from, metricCustom.to, f => onMetricCustomChange({ ...metricCustom, from: f }), t => onMetricCustomChange({ ...metricCustom, to: t }));
          }
        }}
      />
      {metricPeriod === 'custom' && (
        <CustomDateTimeRange
          from={metricCustom.from}
          to={metricCustom.to}
          onFromChange={f => onMetricCustomChange({ ...metricCustom, from: f })}
          onToChange={t => onMetricCustomChange({ ...metricCustom, to: t })}
          stacked
        />
      )}
    </div>
  );

  return (
    <div className="bpl-status-stats-layout">
      <div className="bpl-status-stats-grid">
        {cards.map(card => {
          const Icon = card.icon;

          if (card.kind === 'status') {
            const value = getStatusValue(card.key);
            const isActive = !navigateOnStatusClick && (
              card.filter === 'All' ? statusFilter === 'All' : statusFilter === card.filter
            );
            const pct = card.filter !== 'All' && metadata.totalVehicles > 0
              ? Math.round((value / metadata.totalVehicles) * 100)
              : null;

            return (
              <button
                key={card.key}
                type="button"
                className={`bpl-card bpl-status-stat${isActive ? ' active' : ''}`}
                aria-label={card.label}
                style={{
                  borderTopColor: card.color,
                  cursor: 'pointer',
                  background: isActive ? `${card.color}10` : undefined,
                  outline: isActive ? `1.5px solid ${card.color}40` : 'none',
                }}
                onClick={() => {
                  if (navigateOnStatusClick) { navigate(card.href); return; }
                  onFilterChange(card.filter);
                }}
              >
                <div className="bpl-status-stat-inner">
                  <div className="bpl-status-stat-copy">
                    <div className="bpl-status-stat-label-row">
                      <span className="bpl-status-stat-label">{card.label}</span>
                      <InfoTip text={card.tip} color={card.color} align="left" />
                    </div>
                    <div className="bpl-status-stat-value" style={{ color: card.color }}>
                      {statusCardsLoading ? <SkelValue /> : value}
                    </div>
                    <div className="bpl-status-stat-sub">
                      {pct !== null ? `${pct}% of fleet` : 'vehicles'}
                    </div>
                  </div>
                  <WidgetStatGraphic color={card.color} icon={Icon} />
                </div>
              </button>
            );
          }

          const busy = card.key === 'distance' ? distanceLoading
            : card.key === 'hos' ? hosLoading
            : fuelLoading;
          const valueNode = card.key === 'distance' ? (
            <>
              {totalDistanceKm.toLocaleString()}
              <span className="bpl-status-metric-unit">km</span>
            </>
          ) : card.key === 'hos' ? (
            violationCount
          ) : (
            <>
              {fuelLiters.toLocaleString()}
              <span className="bpl-status-metric-unit">L</span>
            </>
          );
          const sub = card.key === 'hos'
            ? 'violations'
            : periodControl;

          return (
            <button
              key={card.key}
              type="button"
              className="bpl-card bpl-status-stat bpl-status-metric-card"
              aria-label={card.label}
              style={{
                borderTopColor: card.color,
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
              onClick={() => navigate(card.href)}
            >
              <div className="bpl-status-stat-inner">
                <div className="bpl-status-stat-copy">
                  <div className="bpl-status-stat-label-row">
                    <span className="bpl-status-stat-label">{card.label}</span>
                    <InfoTip text={card.tip} color={card.color} align="right" />
                  </div>
                  <div
                    className={`bpl-status-stat-value${card.key === 'hos' && violationCount > 0 ? ' bpl-hos-violation-pulse' : ''}`}
                    style={{ color: card.color }}
                  >
                    {busy ? <SkelValue wide={card.key !== 'hos'} /> : valueNode}
                  </div>
                  <div className="bpl-status-stat-sub">{sub}</div>
                </div>
                <WidgetStatGraphic color={card.color} icon={Icon} size="xs" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
