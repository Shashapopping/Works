import { useState, useCallback } from 'react';
import type { StatusFilter, DistanceRange } from '../context/FleetContext';
import { useFleet } from '../context/FleetContext';
import FleetSafetyScore from '../components/home/FleetSafetyScore';
import StatusStatsRow from '../components/home/StatusStatsRow';
import FleetViewCard from '../components/home/FleetViewCard';
import FatigueWidget from '../components/home/FatigueWidget';
import AlertsWidget from '../components/home/AlertsWidget';
import DriverPerformanceWidget from '../components/home/DriverPerformanceWidget';
import AiInsightsWidget from '../components/home/AiInsightsWidget';
import { EnvironmentStrip } from '../components/home/EnvironmentStrip';
import { clientName } from '../lib/branding';
import { FATIGUE_ENABLED } from '../config/fatigue';
import { defaultPageCustomRange } from '../lib/pagePeriod';
import FuelChartWidget from '../components/home/FuelChartWidget';

export default function Dashboard() {
  const { setDistanceRange } = useFleet();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [metricPeriod, setMetricPeriod] = useState<DistanceRange>('week');
  const [metricCustom, setMetricCustom] = useState(defaultPageCustomRange);

  const handleMetricPeriodChange = useCallback((period: DistanceRange) => {
    setMetricPeriod(period);
    setDistanceRange(period, metricCustom);
  }, [setDistanceRange, metricCustom]);

  const handleMetricCustomChange = useCallback((custom: { from: string; to: string }) => {
    setMetricCustom(custom);
    if (metricPeriod === 'custom') setDistanceRange('custom', custom);
  }, [metricPeriod, setDistanceRange]);

  const midColsClass = FATIGUE_ENABLED
    ? 'bpl-home-mid-row--cols-3'
    : 'bpl-home-mid-row--cols-2';

  return (
    <div className="bpl-home-grid">
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Fleet Overview</h1>
        <p className="bpl-page-subtitle">{clientName()} — Real-time fleet intelligence</p>
      </div>

      <div className="bpl-home-score-row">
        <FleetSafetyScore />
        <StatusStatsRow
          statusFilter={statusFilter}
          onFilterChange={setStatusFilter}
          metricPeriod={metricPeriod}
          onMetricPeriodChange={handleMetricPeriodChange}
          metricCustom={metricCustom}
          onMetricCustomChange={handleMetricCustomChange}
          navigateOnStatusClick
        />
      </div>

      <div className={`bpl-home-mid-row ${midColsClass}`}>
        <FleetViewCard statusFilter={statusFilter} />
        {FATIGUE_ENABLED && <FatigueWidget />}
        <FuelChartWidget />
      </div>

      <div className="bpl-home-bottom-row">
        <AlertsWidget />
        <DriverPerformanceWidget />
        <AiInsightsWidget />
      </div>

      <EnvironmentStrip />
    </div>
  );
}
