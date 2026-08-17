import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  X, TrendingUp, TrendingDown, Minus, Check, Circle,
  Shield, Users, ArrowRight,
} from 'lucide-react';
import {
  CATEGORY_COLORS,
  loadConsequenceConfig,
  type ConsequenceScoreConfig,
} from '../lib/consequenceScore';
import {
  scoreBandColor,
  type FleetScoreConfig,
  DEFAULT_FLEET_SCORE_CONFIG,
} from '../lib/fleetSafetyScore';

interface Props {
  fleetScore: number;
  fleetDelta: number;
  totalIncidents: number;
  vehicleCount: number;
  /** Weighted IVMS points per 100 vehicles (30d). */
  actualWeightedRate?: number;
  scoreConfig?: FleetScoreConfig;
  consequenceConfig?: ConsequenceScoreConfig;
  onClose: () => void;
}

const SCORED_NOW = [
  'Overspeeding / Overspeed Tiered',
  'Harsh Braking',
  'Harsh Acceleration',
  'Harsh Cornering',
];

const NOT_YET = [
  'Fatigue (continuous / daily / weekly driving limits)',
  'Rest-break shortfall',
  'Unauthorized night driving (7pm–6am)',
];

const CONSEQUENCES = [
  { tier: 'Amber', first: 'Written Warning', second: 'Mandatory Driver Retraining', color: CATEGORY_COLORS.Amber },
  { tier: 'Yellow', first: 'Three-Day Suspension', second: 'One-Week Suspension', color: CATEGORY_COLORS.Yellow },
  { tier: 'Red', first: 'Two-Week Suspension', second: 'Driver Terminated', color: CATEGORY_COLORS.Red },
];

export default function ConsequenceExplainerModal({
  fleetScore,
  fleetDelta,
  totalIncidents,
  vehicleCount,
  actualWeightedRate,
  scoreConfig = DEFAULT_FLEET_SCORE_CONFIG,
  consequenceConfig,
  onClose,
}: Props) {
  const cm = consequenceConfig ?? loadConsequenceConfig();
  const color = scoreBandColor(fleetScore, scoreConfig);
  const rawRate = vehicleCount > 0 ? ((totalIncidents / vehicleCount) * 100).toFixed(1) : '—';
  const actualRateLabel = actualWeightedRate != null
    ? actualWeightedRate.toFixed(1)
    : rawRate;

  const fleetWeights = [
    { label: 'Harsh Braking', weight: scoreConfig.weights.harshBraking, color: '#e05c2a' },
    { label: 'Overspeeding', weight: scoreConfig.weights.overspeeding, color: '#d97706' },
    { label: 'Harsh Accel.', weight: scoreConfig.weights.harshAcceleration, color: '#f59e0b' },
    { label: 'Cornering', weight: scoreConfig.weights.harshCornering, color: '#8b5cf6' },
  ];

  const tiers: { category: keyof typeof CATEGORY_COLORS; band: string; meaning: string }[] = [
    { category: 'Green', band: `above ${cm.amberStart}`, meaning: 'Safe — no disciplinary action' },
    { category: 'Amber', band: `${cm.amberStart} to ${cm.yellowStart}`, meaning: 'Warning → Retraining' },
    { category: 'Yellow', band: `${cm.yellowStart} to ${cm.redStart}`, meaning: '3-day → 1-week suspension' },
    { category: 'Red', band: `${cm.redStart} and below`, meaning: '2-week suspension → Termination' },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consequence-explainer-title"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        className="bpl-card"
        style={{
          width: '100%', maxWidth: 920, maxHeight: '90vh', overflowY: 'auto',
          borderRadius: 16, border: '1px solid var(--cd-border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.25)', padding: 0,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          padding: '20px 24px', borderBottom: '1px solid var(--cd-border)',
          position: 'sticky', top: 0, background: 'var(--cd-surface)', zIndex: 1,
        }}>
          <div>
            <div id="consequence-explainer-title" style={{
              fontSize: 16, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)',
            }}>
              How safety scoring works
            </div>
            <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: '4px 0 0', lineHeight: 1.45 }}>
              Two scores, two jobs — fleet health overview vs driver Consequence Management.
              Tune values in Settings → Alert Thresholds.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 6,
              color: 'var(--cd-text-muted)', borderRadius: 8, display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderBottom: '1px solid var(--cd-border)' }}
          className="bpl-consequence-explainer-grid"
        >
          <div style={{ padding: '20px 24px', borderRight: '1px solid var(--cd-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Shield size={15} color="#0078D4" />
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)' }}>
                Fleet Safety Score
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 36, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>
                {fleetScore}
              </span>
              <span style={{ fontSize: 13, color: 'var(--cd-text-muted)', fontWeight: 600 }}>/100</span>
              <span style={{ fontSize: 12, marginLeft: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {fleetDelta > 0
                  ? <><TrendingUp size={12} color="#16a34a" /><span style={{ color: '#16a34a', fontWeight: 600 }}>+{fleetDelta}</span></>
                  : fleetDelta < 0
                  ? <><TrendingDown size={12} color="#CC0000" /><span style={{ color: '#CC0000', fontWeight: 600 }}>{fleetDelta}</span></>
                  : <><Minus size={12} color="var(--cd-text-muted)" /><span style={{ color: 'var(--cd-text-muted)' }}>0</span></>
                }
                <span style={{ color: 'var(--cd-text-muted)' }}>vs prior 30d</span>
              </span>
            </div>

            <p style={{ fontSize: 12, color: 'var(--cd-text)', lineHeight: 1.55, margin: '0 0 12px' }}>
              Compares your weighted IVMS rate <strong>per 100 vehicles</strong> (last 30 days) to what
              <strong> leading fleets in Nigeria-style heavy operations</strong> aim for. Match that target → 85; beat it → up to 100.
            </p>

            <div style={{
              fontSize: 11, fontFamily: 'var(--cd-font-mono, monospace)', color: 'var(--cd-text-muted)',
              background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)',
              borderRadius: 8, padding: '8px 10px', marginBottom: 12, lineHeight: 1.45,
            }}>
              Score = 85 × (leading rate ÷ your rate), capped at 100
              <div style={{ marginTop: 4, color: 'var(--cd-text)' }}>
                Leading aim ≤{scoreConfig.leadingRatePer100} · Your rate {actualRateLabel} → <strong style={{ color }}>{fleetScore}</strong>
              </div>
            </div>

            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Fleet score weights
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
              {fleetWeights.map(w => (
                <div key={w.label} style={{
                  background: `${w.color}12`, border: `1px solid ${w.color}30`,
                  borderRadius: 6, padding: '6px 8px',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: w.color }}>−{w.weight}</div>
                  <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>{w.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 12, flexWrap: 'wrap' }}>
              <span><strong style={{ color: 'var(--cd-text)' }}>{totalIncidents}</strong> incidents / 30d</span>
              <span><strong style={{ color: 'var(--cd-text)' }}>{actualRateLabel}</strong> weighted /100 veh</span>
              <span>Leading aim ≤<strong style={{ color: 'var(--cd-text)' }}>{scoreConfig.leadingRatePer100}</strong></span>
            </div>

            <div style={{
              fontSize: 11, color: '#0078D4', background: 'rgba(0,120,212,0.08)',
              border: '1px solid rgba(0,120,212,0.2)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.4,
            }}>
              This is <strong>not</strong> the driver consequence score. It does not use distance or flat −{cm.penaltyPerEvent} penalties.
            </div>
          </div>

          <div style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Users size={15} color={CATEGORY_COLORS.Amber} />
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)' }}>
                Driver Consequence Score
              </span>
            </div>

            <p style={{ fontSize: 12, color: 'var(--cd-text)', lineHeight: 1.55, margin: '0 0 10px' }}>
              Consequence Management. Every scored IVMS violation costs{' '}
              <strong>−{cm.penaltyPerEvent} points</strong> (no weighting). Totals are normalised by distance.
            </p>

            <div style={{
              fontSize: 11, fontFamily: 'var(--cd-font-mono, monospace)', color: 'var(--cd-text-muted)',
              background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)',
              borderRadius: 8, padding: '8px 10px', marginBottom: 12, lineHeight: 1.45,
            }}>
              Driver Score = Penalty points ÷ (Distance km ÷ 100)
              <div style={{ marginTop: 4, color: 'var(--cd-text)', fontWeight: 600 }}>
                Example: −68 pts ÷ (600 ÷ 100) = <span style={{ color: CATEGORY_COLORS.Yellow }}>−11.3 → Yellow</span>
              </div>
            </div>

            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Risk categories
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              {tiers.map(t => (
                <div key={t.category} style={{
                  display: 'grid', gridTemplateColumns: '64px 1fr 1fr', gap: 8, alignItems: 'center',
                  fontSize: 11, padding: '5px 8px', borderRadius: 6,
                  background: `${CATEGORY_COLORS[t.category]}10`,
                }}>
                  <span style={{ fontWeight: 700, color: CATEGORY_COLORS[t.category] }}>{t.category.toUpperCase()}</span>
                  <span style={{ color: 'var(--cd-text-muted)', fontFamily: 'var(--cd-font-mono, monospace)' }}>{t.band}</span>
                  <span style={{ color: 'var(--cd-text)' }}>{t.meaning}</span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Consequences (1st → 2nd occurrence)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
              {CONSEQUENCES.map(c => (
                <div key={c.tier} style={{ fontSize: 11, padding: '6px 8px', borderRadius: 6, border: `1px solid ${c.color}30` }}>
                  <span style={{ fontWeight: 700, color: c.color }}>{c.tier}</span>
                  <span style={{ color: 'var(--cd-text-muted)' }}> · </span>
                  <span style={{ color: 'var(--cd-text)' }}>{c.first}</span>
                  <span style={{ color: 'var(--cd-text-muted)' }}> → </span>
                  <span style={{ color: 'var(--cd-text)' }}>{c.second}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link
                to="/drivers"
                onClick={onClose}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: 'rgba(0,120,212,0.12)', color: '#0078D4', textDecoration: 'none',
                  border: '1px solid rgba(0,120,212,0.25)',
                }}
              >
                Driver scorecards <ArrowRight size={13} />
              </Link>
              <Link
                to="/incidents/response"
                onClick={onClose}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: 'var(--cd-surface-2)', color: 'var(--cd-text)', textDecoration: 'none',
                  border: '1px solid var(--cd-border)',
                }}
              >
                Response Tracking <ArrowRight size={13} />
              </Link>
              <Link
                to="/settings/thresholds"
                onClick={onClose}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: 'var(--cd-surface-2)', color: 'var(--cd-text-muted)', textDecoration: 'none',
                  border: '1px solid var(--cd-border)',
                }}
              >
                Edit values
              </Link>
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 24px 20px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)', marginBottom: 10 }}>
            What the fleet monitors
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}
            className="bpl-consequence-checklist-grid"
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', marginBottom: 6 }}>Scored in this dashboard</div>
              {SCORED_NOW.map(item => (
                <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--cd-text)', marginBottom: 4 }}>
                  <Check size={13} color="#16a34a" style={{ flexShrink: 0, marginTop: 2 }} />
                  {item}
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--cd-text-muted)', marginBottom: 6 }}>Not scored yet (no live feed)</div>
              {NOT_YET.map(item => (
                <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 4 }}>
                  <Circle size={11} color="var(--cd-text-muted)" style={{ flexShrink: 0, marginTop: 3 }} />
                  {item}
                </div>
              ))}
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: 0, lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--cd-text)' }}>Driver Management</strong> and{' '}
            <strong style={{ color: 'var(--cd-text)' }}>Response Tracking</strong> use Consequence Management.
            This Fleet Safety Score stays the operational overview on Home and Safety.
          </p>
        </div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .bpl-consequence-explainer-grid { grid-template-columns: 1fr !important; }
          .bpl-consequence-explainer-grid > div:first-child {
            border-right: none !important;
            border-bottom: 1px solid var(--cd-border);
          }
          .bpl-consequence-checklist-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
