import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useFleet } from '../../context/FleetContext';
import {
  scoreBandColor,
  scoreBandLabel,
  ratePer100Km,
  totalSafetyPointsFromCensus,
  SCORE_DROP_PER_IVMS_UNIT,
  FLEET_SCORE_SCALE,
} from '../../lib/fleetSafetyScore';
import ConsequenceExplainerModal from '../ConsequenceExplainerModal';

/** Home safety card — uses FleetContext scoped exposure (no duplicate fetch). */
export default function FleetSafetyScore() {
  const {
    safetyScore: activeScore,
    safetyDelta: activeDelta,
    metadata,
    scoreConfig,
    safetyExposure: activeExposure,
    safetyExposureLoading,
    vehicles,
    selectedSites,
  } = useFleet();
  const [explainerOpen, setExplainerOpen] = useState(false);
  const siteFiltered = selectedSites.length > 0;

  const color = scoreBandColor(activeScore, scoreConfig);
  const label = scoreBandLabel(activeScore, scoreConfig);
  const refreshing = !activeExposure && safetyExposureLoading;

  const distanceKm = activeExposure?.distanceKm ?? 0;
  const points = totalSafetyPointsFromCensus(activeExposure ?? { distanceKm: 0, hosHeldMinutes: 0 }, scoreConfig);
  const weightedRate = ratePer100Km(points.ivms, distanceKm);
  const scoreDeduction = Math.min(
    FLEET_SCORE_SCALE,
    Math.max(0, Math.round(SCORE_DROP_PER_IVMS_UNIT * weightedRate)),
  );

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
                stroke={color} strokeWidth="5"
                strokeDasharray={`${2 * Math.PI * 24}`}
                strokeDashoffset={`${2 * Math.PI * 24 * (1 - activeScore / FLEET_SCORE_SCALE)}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="bpl-safety-gauge-center">
              <span className="bpl-safety-gauge-score" style={{ color }}>
                {activeScore}
              </span>
              <span className="bpl-safety-gauge-denom">/{FLEET_SCORE_SCALE}</span>
            </div>
          </div>
          <div className="bpl-safety-score-home-meta">
            <div className="bpl-safety-score-home-status" style={{ color }}>
              {label}
            </div>
            <div className="bpl-safety-score-home-delta">
              {activeDelta > 0 ? (
                <><TrendingUp size={13} color="#16a34a" /><span className="bpl-kpi-delta-up">+{activeDelta} pts</span></>
              ) : activeDelta < 0 ? (
                <><TrendingDown size={13} color="#CC0000" /><span className="bpl-kpi-delta-down">{activeDelta} pts</span></>
              ) : (
                <><Minus size={13} color="var(--cd-text-muted)" /><span className="bpl-safety-score-home-nochange">No change</span></>
              )}
            </div>
            <div className="bpl-safety-score-home-stats">
              <span><strong>{weightedRate.toFixed(1)}</strong> IVMS pts / 100 km</span>
              <span className="bpl-safety-score-home-dot" />
              <span>−{scoreDeduction} from 100</span>
              <span className="bpl-safety-score-home-dot" />
              <span>{Math.round(distanceKm).toLocaleString()} km tracked</span>
              {refreshing && (
                <>
                  <span className="bpl-safety-score-home-dot" />
                  <span>refreshing…</span>
                </>
              )}
            </div>
          </div>
        </button>
      </div>

      {explainerOpen && (
        <ConsequenceExplainerModal
          fleetScore={activeScore}
          fleetDelta={activeDelta}
          totalIncidents={activeExposure?.incidentTotal ?? 0}
          vehicleCount={siteFiltered ? vehicles.length : metadata.totalVehicles}
          actualWeightedRate={weightedRate}
          distanceKm={distanceKm}
          hosHeldMinutes={activeExposure?.hosHeldMinutes ?? 0}
          hosSlices={activeExposure?.hosSlices}
          scoreConfig={scoreConfig}
          onClose={() => setExplainerOpen(false)}
        />
      )}
    </>
  );
}
