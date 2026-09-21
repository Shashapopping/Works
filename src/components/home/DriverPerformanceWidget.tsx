import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFleet } from '../../context/FleetContext';
import { displayDriverName } from '../../lib/driverUtils';
import {
  CATEGORY_COLORS,
  CONSEQUENCE_CONFIG_EVENT,
  CONSEQUENCE_CONFIG_KEY,
  loadConsequenceConfig,
  type ConsequenceCategory,
  type ConsequenceScoreConfig,
} from '../../lib/consequenceScore';
import { assessDrivers, pickHomeDriverMix, latestEventIso } from '../../lib/driverAssessment';
import { useAssessmentTripDrivers } from '../../hooks/useAssessmentTripDrivers';
import { filterTripDriversByAssignedSite } from '../../lib/siteScope';
import { SkelValue } from '../data/DataBusy';

const BAND_LABEL: Record<ConsequenceCategory, string> = {
  Green: 'On track',
  Amber: 'Needs coaching',
  Yellow: 'Suspension review',
  Red: 'Critical',
};

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function DriverPerformanceWidget() {
  const { events, eventsLoading, vehicles, siteFilterActive } = useFleet();
  // Full trip roster, then HOS-style client filter by driver SiteId (not trip assetIds).
  const { tripDrivers, loading: tripsLoading } = useAssessmentTripDrivers([], true);
  const scopedTrips = useMemo(
    () => (siteFilterActive ? filterTripDriversByAssignedSite(tripDrivers, vehicles) : tripDrivers),
    [siteFilterActive, tripDrivers, vehicles],
  );
  const [consequenceConfig, setConsequenceConfig] = useState<ConsequenceScoreConfig>(() => loadConsequenceConfig());

  useEffect(() => {
    const onConfig = (event: Event) => {
      setConsequenceConfig((event as CustomEvent<ConsequenceScoreConfig>).detail ?? loadConsequenceConfig());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CONSEQUENCE_CONFIG_KEY) setConsequenceConfig(loadConsequenceConfig());
    };
    window.addEventListener(CONSEQUENCE_CONFIG_EVENT, onConfig);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CONSEQUENCE_CONFIG_EVENT, onConfig);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const rows = useMemo(
    () => pickHomeDriverMix(assessDrivers(events, scopedTrips, consequenceConfig)),
    [consequenceConfig, events, scopedTrips],
  );

  const waiting = rows.length === 0 && (eventsLoading || tripsLoading);

  return (
    <div className="bpl-card bpl-home-panel-card bpl-home-drivers-panel">
      <div className="bpl-card-header">
        <span className="bpl-card-title">Driver Performance</span>
        <Link to="/drivers" className="bpl-card-link">See all</Link>
      </div>
      <div className="bpl-card-body bpl-home-panel-scroll bpl-driver-list">
        {waiting ? (
          <div style={{ fontSize: 13, color: 'var(--cd-text-muted)', padding: '12px 0' }}>
            <SkelValue wide />
          </div>
        ) : rows.length === 0 ? (
          <div className="bpl-driver-empty">No driver data yet</div>
        ) : rows.map(d => {
          const color = CATEGORY_COLORS[d.consequence.category] ?? CATEGORY_COLORS.Green;
          const last = latestEventIso(d);
          const meta = [
            d.harshBraking > 0 ? `${d.harshBraking} brake` : null,
            d.overspeeding > 0 ? `${d.overspeeding} speed` : null,
          ].filter(Boolean).join(' · ');
          return (
            <Link
              key={d.key}
              to={`/drivers?q=${encodeURIComponent(d.name)}`}
              className="bpl-driver-card"
              style={{ '--driver-accent': color } as React.CSSProperties}
            >
              <div className="bpl-driver-card-body">
                <div className="bpl-driver-card-top">
                  <span className="bpl-driver-band">{BAND_LABEL[d.consequence.category]}</span>
                  {last && <span className="bpl-driver-time">{timeAgo(last)}</span>}
                </div>
                <div className="bpl-driver-name">{displayDriverName(d.name)}</div>
                <div className="bpl-driver-meta">
                  {d.total} incident{d.total === 1 ? '' : 's'}
                  {meta ? ` · ${meta}` : ''}
                </div>
              </div>
              <div className="bpl-driver-score">
                <span className="bpl-driver-score-value">{d.consequence.displayScore}</span>
                <span className="bpl-driver-score-unit">score</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
