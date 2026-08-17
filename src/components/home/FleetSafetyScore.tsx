import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { useFleet } from '../../context/FleetContext';
import { scoreBandColor, scoreBandLabel, ratePer100Vehicles } from '../../lib/fleetSafetyScore';
import ConsequenceExplainerModal from '../ConsequenceExplainerModal';
import { SkelValue } from '../data/DataBusy';

export default function FleetSafetyScore() {
  const { safetyScore, safetyDelta, events, eventsLoading, metadata, scoreConfig } = useFleet();
  const [explainerOpen, setExplainerOpen] = useState(false);

  const color = scoreBandColor(safetyScore, scoreConfig);
  const label = scoreBandLabel(safetyScore, scoreConfig);

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = events.filter(e => new Date(e.eventTime || e.timestamp).getTime() >= thirtyDaysAgo);
  const totalIncidents = recent.length;
  const vehicleCount = metadata.totalVehicles;
  const weightedRate = ratePer100Vehicles(recent, vehicleCount, scoreConfig);

  return (
    <>
      <div className="bpl-card bpl-safety-score-card bpl-safety-score-card--home">
        <div className="bpl-safety-score-home-head">
          <span className="bpl-safety-score-label">Fleet Safety Score</span>
          <Link to="/safety" className="bpl-card-link" onClick={e => e.stopPropagation()}>See all</Link>
        </div>
        <button
          type="button"
          onClick={() => setExplainerOpen(true)}
          aria-label="How fleet safety score works"
          className="bpl-safety-score-home-body"
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          <div className="bpl-safety-gauge bpl-safety-gauge-compact bpl-safety-gauge--home">
            <svg width="72" height="72" viewBox="0 0 60 60" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="30" cy="30" r="24" fill="none" stroke="var(--cd-border)" strokeWidth="5" />
              <circle
                cx="30" cy="30" r="24" fill="none"
                stroke={eventsLoading ? 'var(--cd-border)' : color} strokeWidth="5"
                strokeDasharray={`${2 * Math.PI * 24}`}
                strokeDashoffset={`${2 * Math.PI * 24 * (1 - (eventsLoading ? 0 : safetyScore) / 100)}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="bpl-safety-gauge-center">
              <span className="bpl-safety-gauge-score" style={{ color: eventsLoading ? 'var(--cd-text-muted)' : color }}>
                {eventsLoading ? <SkelValue /> : safetyScore}
              </span>
              {!eventsLoading && <span className="bpl-safety-gauge-denom">/100</span>}
            </div>
          </div>
          <div className="bpl-safety-score-home-meta">
            <div className="bpl-safety-score-home-status" style={{ color: eventsLoading ? 'var(--cd-text-muted)' : color }}>
              {eventsLoading ? <SkelValue wide /> : label}
            </div>
            <div className="bpl-safety-score-home-delta">
              {eventsLoading ? (
                <SkelValue wide />
              ) : safetyDelta > 0 ? (
                <><TrendingUp size={13} color="#16a34a" /><span className="bpl-kpi-delta-up">+{safetyDelta} pts</span></>
              ) : safetyDelta < 0 ? (
                <><TrendingDown size={13} color="#CC0000" /><span className="bpl-kpi-delta-down">{safetyDelta} pts</span></>
              ) : (
                <><Minus size={13} color="var(--cd-text-muted)" /><span className="bpl-safety-score-home-nochange">No change</span></>
              )}
            </div>
            <div className="bpl-safety-score-home-stats">
              {eventsLoading ? (
                <SkelValue wide />
              ) : (
                <>
                  <span><strong>{weightedRate.toFixed(1)}</strong> wt/100</span>
                  <span className="bpl-safety-score-home-dot" />
                  <span>aim ≤<strong>{scoreConfig.leadingRatePer100}</strong></span>
                </>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 4 }}>
              Aim = 85 · beat aim → 100 · click for detail
            </div>
          </div>
        </button>
      </div>

      {explainerOpen && (
        <ConsequenceExplainerModal
          fleetScore={safetyScore}
          fleetDelta={safetyDelta}
          totalIncidents={totalIncidents}
          vehicleCount={vehicleCount}
          actualWeightedRate={weightedRate}
          scoreConfig={scoreConfig}
          onClose={() => setExplainerOpen(false)}
        />
      )}
    </>
  );
}
