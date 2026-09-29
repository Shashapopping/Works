import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFleet, authFetch, type LogEntry } from '../../context/FleetContext';
import { displayDriverName } from '../../lib/driverUtils';
import {
  CONSEQUENCE_CONFIG_EVENT,
  CONSEQUENCE_CONFIG_KEY,
  loadConsequenceConfig,
  type ConsequenceCategory,
  type ConsequenceScoreConfig,
} from '../../lib/consequenceScore';
import {
  assessDriversFromRisk,
  assessmentDriverKey,
  driverRiskUrl,
  pickHomeDriverMix,
  latestEventIso,
} from '../../lib/driverAssessment';
import { usePeriodTripDrivers } from '../../hooks/useAssessmentTripDrivers';
import { filterRiskDriversByAssignedSite, filterTripDriversByAssignedSite } from '../../lib/siteScope';
import { authCachedJson, cachePeek, CACHE_TTL } from '../../lib/apiCache';
import { scoreBandColor } from '../../lib/fleetSafetyScore';
import { SkelValue } from '../data/DataBusy';

type RiskRow = Parameters<typeof assessDriversFromRisk>[0][number];

const RISK_URL = driverRiskUrl('7days');

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
  const { events, vehicles, siteFilterActive, scoreConfig } = useFleet();
  // Same source as Driver Management's default view: calendar 7d SQL risk totals + 7d trip km.
  // The dashboard event feed is capped, so it is only used for "last seen" times.
  const { tripDrivers, loading: tripsLoading } = usePeriodTripDrivers('7days');
  const [riskRows, setRiskRows] = useState<RiskRow[]>(
    () => cachePeek<{ drivers?: RiskRow[] }>(RISK_URL)?.drivers ?? [],
  );
  const [riskLoading, setRiskLoading] = useState(() => !cachePeek(RISK_URL));

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      authCachedJson<{ drivers?: RiskRow[] }>(RISK_URL, authFetch, { ttlMs: CACHE_TTL.riskDrivers })
        .then(data => {
          if (!cancelled && data?.drivers) setRiskRows(data.drivers);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setRiskLoading(false);
        });
    };
    load();
    const timer = window.setInterval(load, CACHE_TTL.riskDrivers);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const scopedTrips = useMemo(
    () => (siteFilterActive ? filterTripDriversByAssignedSite(tripDrivers, vehicles) : tripDrivers),
    [siteFilterActive, tripDrivers, vehicles],
  );
  const scopedRiskRows = useMemo(
    () => (siteFilterActive ? filterRiskDriversByAssignedSite(riskRows, scopedTrips, vehicles) : riskRows),
    [riskRows, scopedTrips, siteFilterActive, vehicles],
  );
  const recentEventsByDriver = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    const add = (key: string, e: LogEntry) => {
      if (!key) return;
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    };
    for (const e of events) {
      const key = assessmentDriverKey(e.driverId, e.driverName);
      add(key, e);
      const name = (e.driverName || '').trim();
      if (name && name !== key) add(name, e);
    }
    return map;
  }, [events]);
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

  const rows = useMemo(() => {
    void consequenceConfig;
    const assessed = assessDriversFromRisk(scopedRiskRows, scopedTrips).map(d => ({
      ...d,
      events: recentEventsByDriver.get(d.key) ?? recentEventsByDriver.get(d.name.trim()) ?? [],
    }));
    return pickHomeDriverMix(assessed);
  }, [consequenceConfig, recentEventsByDriver, scopedRiskRows, scopedTrips]);

  const waiting = rows.length === 0 && (riskLoading || tripsLoading);

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
          // Colour follows the score; the consequence band only drives the label.
          const color = scoreBandColor(d.consequence.displayScore, scoreConfig);
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
