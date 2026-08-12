import { useState, useCallback } from 'react';
import type { StatusFilter, DistanceRange } from '../context/FleetContext';
import { useFleet } from '../context/FleetContext';
import FleetSafetyScore from '../components/home/FleetSafetyScore';
import StatusStatsRow from '../components/home/StatusStatsRow';
import FleetViewCard from '../components/home/FleetViewCard';
import AlertsWidget from '../components/home/AlertsWidget';
import FuelChartWidget from '../components/home/FuelChartWidget';
import DriverPerformanceWidget from '../components/home/DriverPerformanceWidget';
import AiInsightsWidget from '../components/home/AiInsightsWidget';
import { EnvironmentStrip } from '../components/home/EnvironmentStrip';
import { clientName } from '../lib/branding';

export default function Dashboard() {
  const { setDistanceRange } = useFleet();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [metricPeriod, setMetricPeriod] = useState<DistanceRange>('24h');

  const handleMetricPeriodChange = useCallback((period: DistanceRange) => {
    setMetricPeriod(period);
    setDistanceRange(period);
  }, [setDistanceRange]);

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
          navigateOnStatusClick
        />
      </div>

      <div className="bpl-home-mid-row bpl-home-mid-row--cols-2">
        <FleetViewCard statusFilter={statusFilter} />
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
