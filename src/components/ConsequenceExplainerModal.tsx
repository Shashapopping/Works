import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  X, TrendingUp, TrendingDown, Minus, Check, Circle,
  Shield, Users, ArrowRight,
} from 'lucide-react';
import {
  CATEGORY_COLORS,
  categoryPlainLabel,
  categorizeDriverScore,
  loadConsequenceConfig,
  type ConsequenceScoreConfig,
} from '../lib/consequenceScore';
import {
  SCORE_DROP_PER_IVMS_UNIT,
  FLEET_SCORE_SCALE,
  hosPointsFromHeldMinutes,
  hosSlicesFromMinutes,
  scoreBandColor,
  scoreBandLabel,
  type FleetScoreConfig,
  DEFAULT_FLEET_SCORE_CONFIG,
} from '../lib/fleetSafetyScore';

interface Props {
  fleetScore: number;
  fleetDelta: number;
  totalIncidents: number;
  vehicleCount: number;
  /** Weighted IVMS points per 100 km. */
  actualWeightedRate?: number;
  distanceKm?: number;
  hosHeldMinutes?: number;
  hosSlices?: number;
  scoreConfig?: FleetScoreConfig;
  consequenceConfig?: ConsequenceScoreConfig;
  onClose: () => void;
}

const SCORED_NOW = [
  { title: 'Overspeeding', note: 'Includes Overspeed Tiered and road-speed overspeed' },
  { title: 'Harsh Braking' },
  { title: 'Harsh Acceleration' },
  { title: 'Harsh Cornering' },
];

const FATIGUE_RULES = [
  { title: '4-hour continuous', note: '30-minute rest resets the block after 4h driving' },
  { title: 'Daily rest', note: 'Max 8h continuous driving in a rolling 24h window' },
  { title: 'Weekly rest', note: '≥24h continuous off-duty rest in every 7-day week' },
];

function StepNum({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: 20, height: 20, borderRadius: 99, flexShrink: 0,
        background: 'var(--cd-text)', color: 'var(--cd-surface)',
        fontSize: 11, fontWeight: 700, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--cd-font-display)',
      }}
    >
      {n}
    </span>
  );
}

export default function ConsequenceExplainerModal({
  fleetScore,
  fleetDelta,
  totalIncidents,
  vehicleCount,
  actualWeightedRate,
  distanceKm,
  hosHeldMinutes = 0,
  hosSlices,
  scoreConfig = DEFAULT_FLEET_SCORE_CONFIG,
  consequenceConfig,
  onClose,
}: Props) {
  const cm = consequenceConfig ?? loadConsequenceConfig();
  const color = scoreBandColor(fleetScore, scoreConfig);
  const band = scoreBandLabel(fleetScore, scoreConfig);
  const rateLabel = actualWeightedRate != null ? actualWeightedRate.toFixed(2) : '—';
  const km = Math.round(distanceKm ?? 0);
  const drop = SCORE_DROP_PER_IVMS_UNIT;
  const goodAt = Math.round((100 - scoreConfig.bandGood) / drop);
  const deduction = (actualWeightedRate ?? 0) * drop;
  const rawScore = FLEET_SCORE_SCALE - deduction;
  const rawScoreClamped = rawScore < 0 || rawScore > FLEET_SCORE_SCALE;
  const deductionLabel = deduction.toFixed(2);
  const rawScoreLabel = rawScore.toFixed(2);
  const activeHosSlices = hosSlices ?? hosSlicesFromMinutes(hosHeldMinutes, scoreConfig);
  const hosPoints = hosPointsFromHeldMinutes(hosHeldMinutes, scoreConfig);
  const hosWeightLabel = `+${scoreConfig.hosPointsPer10Min} / ${scoreConfig.hosSliceMinutes} min`;

  const fleetWeights = [
    { label: 'Harsh Braking', weight: scoreConfig.weights.harshBraking, color: '#e05c2a', title: undefined },
    { label: 'Overspeeding', weight: scoreConfig.weights.overspeeding, color: '#d97706', title: undefined },
    { label: 'Harsh Accel.', weight: scoreConfig.weights.harshAcceleration, color: '#f59e0b', title: undefined },
    { label: 'Cornering', weight: scoreConfig.weights.harshCornering, color: '#8b5cf6', title: undefined },
    { label: 'HOS', weight: hosWeightLabel, color: '#0d9488', title: undefined },
  ];

  const fleetBands = [
    { label: 'Good Standing', cut: `≥ ${scoreConfig.bandGood}`, color: '#16a34a' },
    { label: 'Needs Attention', cut: `≥ ${scoreConfig.bandAttention}`, color: '#d97706' },
    { label: 'Below Average', cut: `≥ ${scoreConfig.bandBelow}`, color: '#e05c2a' },
    { label: 'Poor', cut: `< ${scoreConfig.bandBelow}`, color: '#CC0000' },
  ];

  const driverBands: { category: 'Green' | 'Amber' | 'Yellow' | 'Red'; range: string; first: string; second: string }[] = [
    { category: 'Green', range: `above ${cm.amberStart}`, first: 'None', second: '—' },
    { category: 'Amber', range: `${cm.amberStart} to ${cm.yellowStart}`, first: 'Written warning', second: 'Retraining' },
    { category: 'Yellow', range: `${cm.yellowStart} to ${cm.redStart}`, first: '3-day suspension', second: '1-week suspension' },
    { category: 'Red', range: `${cm.redStart} and below`, first: '2-week suspension', second: 'Terminated' },
  ];

  const exampleEvents = 34;
  const exampleKm = 600;
  const examplePenalty = -(exampleEvents * cm.penaltyPerEvent);
  const exampleScore = examplePenalty / Math.max(exampleKm / 100, 1);
  const exampleCat = categorizeDriverScore(exampleScore, cm);
  const exampleScoreLabel = exampleScore.toFixed(1);

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
          width: '100%', maxWidth: 880, maxHeight: '90vh', overflowY: 'auto',
          borderRadius: 16, border: '1px solid var(--cd-border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.25)', padding: 0,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          padding: '18px 24px 14px', borderBottom: '1px solid var(--cd-border)',
          position: 'sticky', top: 0, background: 'var(--cd-surface)', zIndex: 1,
        }}>
          <div>
            <h2 id="consequence-explainer-title" style={{
              fontSize: 16, fontWeight: 700, color: 'var(--cd-text)',
              fontFamily: 'var(--cd-font-display)', margin: 0,
            }}>
              How safety scoring works
            </h2>
            <p style={{ fontSize: 13, color: 'var(--cd-text)', margin: '6px 0 0', lineHeight: 1.4, fontWeight: 600 }}>
              Two scores. Two jobs. Not the same number.
            </p>
            <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: '2px 0 0' }}>
              Last 30 days · values from Settings → Alert Thresholds
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 10,
              minWidth: 44, minHeight: 44, color: 'var(--cd-text-muted)',
              borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Glance: two jobs */}
        <div
          className="bpl-consequence-explainer-grid"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderBottom: '1px solid var(--cd-border)' }}
        >
          <section style={{ padding: '16px 20px 18px', borderRight: '1px solid var(--cd-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Shield size={15} color="#0078D4" />
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)' }}>
                Fleet health
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 36, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>
                {fleetScore}
              </span>
              <span style={{ fontSize: 13, color: 'var(--cd-text-muted)', fontWeight: 600 }}>/{FLEET_SCORE_SCALE}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color }}>{band}</span>
              <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--cd-text-muted)' }}>
                {fleetDelta > 0
                  ? <><TrendingUp size={12} color="#16a34a" /><span style={{ color: '#16a34a', fontWeight: 600 }}>+{fleetDelta}</span></>
                  : fleetDelta < 0
                  ? <><TrendingDown size={12} color="#CC0000" /><span style={{ color: '#CC0000', fontWeight: 600 }}>{fleetDelta}</span></>
                  : <><Minus size={12} /><span>0</span></>
                }
                vs last month
              </span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--cd-text)', lineHeight: 1.45, margin: '10px 0 0' }}>
              Whole-fleet IVMS overview. Starts at <strong>100</strong> when there are no scored incidents. Fatigue / HOS is separate.
            </p>
            <div style={{
              marginTop: 10, fontSize: 13, fontWeight: 600, color: 'var(--cd-text)',
              background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)',
              borderRadius: 8, padding: '8px 10px', lineHeight: 1.4,
            }}>
              100 − {drop} × {rateLabel} IVMS pts/100 km = <span style={{ color }}>{fleetScore}</span>
            </div>
          </section>

          <section style={{ padding: '16px 20px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Users size={15} color={CATEGORY_COLORS.Amber} />
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)' }}>
                One driver
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>
                −{cm.penaltyPerEvent}
              </span>
              <span style={{ fontSize: 13, color: 'var(--cd-text-muted)', fontWeight: 600 }}>pts per event</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--cd-text)', lineHeight: 1.45, margin: '10px 0 0' }}>
              Consequence/Fatigue Management. Every scored event costs the same. Then divide by km so distance is fair.
            </p>
            <div style={{
              marginTop: 10, fontSize: 13, fontWeight: 600, color: 'var(--cd-text)',
              background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)',
              borderRadius: 8, padding: '8px 10px', lineHeight: 1.4,
            }}>
              penalty ÷ (km ÷ 100)
              <span style={{ fontWeight: 500, color: 'var(--cd-text-muted)' }}> · 0 is perfect, more negative is worse</span>
            </div>
          </section>
        </div>

        {/* 10-second recipe */}
        <div style={{ padding: '16px 20px 8px', borderBottom: '1px solid var(--cd-border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)', marginBottom: 12 }}>
            How the fleet number is made
          </div>
          <div
            className="bpl-score-steps"
            style={{
              display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr',
              gap: 8, alignItems: 'stretch',
            }}
          >
            <div style={{ background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <StepNum n={1} />
                <strong style={{ fontSize: 13, color: 'var(--cd-text)' }}>Add IVMS points</strong>
              </div>
              <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: '0 0 8px', lineHeight: 1.4 }}>
                Each scored IVMS incident adds weighted points. Heavier events count more.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {fleetWeights.map(w => (
                  <span key={w.label} style={{
                    fontSize: 11, fontWeight: 700, color: w.color,
                    background: `${w.color}14`, border: `1px solid ${w.color}33`,
                    borderRadius: 999, padding: '2px 8px',
                  }} title={w.title}>
                    {`${w.label} +${w.weight}`}
                  </span>
                ))}
              </div>
            </div>
            <div aria-hidden style={{ display: 'flex', alignItems: 'center', color: 'var(--cd-text-muted)' }}>
              <ArrowRight size={16} />
            </div>
            <div style={{ background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <StepNum n={2} />
                <strong style={{ fontSize: 13, color: 'var(--cd-text)' }}>Per 100 km</strong>
              </div>
              <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: 0, lineHeight: 1.4 }}>
                Weighted IVMS points ÷ (km ÷ 100). More kilometres = the same events look milder.
              </p>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', margin: '10px 0 0' }}>
                {rateLabel} <span style={{ fontWeight: 500, color: 'var(--cd-text-muted)' }}>pts / 100 km now</span>
              </p>
            </div>
            <div aria-hidden style={{ display: 'flex', alignItems: 'center', color: 'var(--cd-text-muted)' }}>
              <ArrowRight size={16} />
            </div>
            <div style={{ background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <StepNum n={3} />
                <strong style={{ fontSize: 13, color: 'var(--cd-text)' }}>Turn into 0–{FLEET_SCORE_SCALE}</strong>
              </div>
              <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: 0, lineHeight: 1.4 }}>
                Every 1 weighted IVMS point per 100 km takes <strong style={{ color: 'var(--cd-text)' }}>{drop}</strong> off the score. Clamped 0–{FLEET_SCORE_SCALE}.
              </p>
              {actualWeightedRate != null ? (
                <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: '10px 0 0', lineHeight: 1.6 }}>
                  <div>
                    <strong style={{ color: 'var(--cd-text)' }}>{rateLabel}</strong> pts/100 km × <strong style={{ color: 'var(--cd-text)' }}>{drop}</strong> = <strong style={{ color: 'var(--cd-text)' }}>{deductionLabel}</strong>
                  </div>
                  <div>
                    100 − <strong style={{ color: 'var(--cd-text)' }}>{deductionLabel}</strong> = <strong style={{ color: 'var(--cd-text)' }}>{rawScoreLabel}</strong>
                    {' → '}
                    <strong style={{ color }}>{fleetScore}</strong>
                    {rawScoreClamped ? ` (clamped to 0–${FLEET_SCORE_SCALE})` : ' (rounded)'}
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: '10px 0 0', lineHeight: 1.4 }}>
                  Zero IVMS points → 100. ~{goodAt} pts / 100 km → {scoreConfig.bandGood} ({fleetBands[0].label}).
                </p>
              )}
            </div>
          </div>

          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 12,
            fontSize: 12, color: 'var(--cd-text-muted)',
          }}>
            <span><strong style={{ color: 'var(--cd-text)' }}>{totalIncidents}</strong> incidents</span>
            <span><strong style={{ color: 'var(--cd-text)' }}>{km.toLocaleString()}</strong> km</span>
            <span>
              <strong style={{ color: 'var(--cd-text)' }}>{activeHosSlices.toLocaleString()}</strong> HOS slices
            </span>
            <span>{vehicleCount} vehicles</span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {fleetBands.map(b => (
              <span key={b.label} style={{
                fontSize: 11, fontWeight: 600, color: b.color,
                background: `${b.color}12`, border: `1px solid ${b.color}33`,
                borderRadius: 999, padding: '3px 8px',
              }}>
                {b.label} {b.cut}
              </span>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--cd-text-muted)', margin: '8px 0 8px', lineHeight: 1.4 }}>
            HOS/fatigue adds {hosWeightLabel} from held over-limit minutes; current HOS impact is {hosPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })} pts.
          </p>
        </div>

        {/* Driver ladder */}
        <div style={{ padding: '16px 20px 8px', borderBottom: '1px solid var(--cd-border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)', marginBottom: 6 }}>
            What happens to a driver
          </div>
          <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: '0 0 10px', lineHeight: 1.45 }}>
            Same events, no extra weighting. 1 event in 50 km looks worse than 1 in 500 km.
            Example: {exampleEvents} events × −{cm.penaltyPerEvent} = {examplePenalty} pts ÷ {exampleKm / 100} blocks of 100 km ={' '}
            <strong style={{ color: CATEGORY_COLORS[exampleCat] }}>{exampleScoreLabel} → {categoryPlainLabel(exampleCat)}</strong>.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }} className="bpl-driver-band-grid">
            {driverBands.map(b => {
              const c = CATEGORY_COLORS[b.category];
              return (
                <div key={b.category} style={{
                  border: `1px solid ${c}40`, background: `${c}10`, borderRadius: 10, padding: '10px 10px 12px',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: c }}>{categoryPlainLabel(b.category)}</div>
                  <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2, fontFamily: 'var(--cd-font-mono, monospace)' }}>{b.range}</div>
                  <div style={{ fontSize: 12, color: 'var(--cd-text)', marginTop: 8, lineHeight: 1.4 }}>
                    {b.first === 'None' ? 'No action' : (
                      <>1st {b.first.toLowerCase()}<br />2nd {b.second.toLowerCase()}</>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Counted */}
        <div style={{ padding: '16px 20px 8px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)', marginBottom: 10 }}>
            What is counted
          </div>
          <div
            className="bpl-consequence-checklist-grid"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', marginBottom: 6 }}>Scored in this dashboard</div>
              {SCORED_NOW.map(item => (
                <div key={item.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, color: 'var(--cd-text)', marginBottom: 6 }}>
                  <Check size={14} color="#16a34a" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>
                    {item.title}
                    {item.note && <span style={{ color: 'var(--cd-text-muted)', fontSize: 12 }}> — {item.note}</span>}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#0d9488', marginBottom: 6 }}>Fatigue rules (separate)</div>
              {FATIGUE_RULES.map(item => (
                <div key={item.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, color: 'var(--cd-text)', marginBottom: 6 }}>
                  <Circle size={12} color="#0d9488" style={{ flexShrink: 0, marginTop: 3 }} />
                  <span>
                    {item.title}
                    {item.note && <span style={{ color: 'var(--cd-text-muted)', fontSize: 12 }}> — {item.note}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: '8px 0 0', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--cd-text)' }}>Driver Management</strong> and{' '}
            <strong style={{ color: 'var(--cd-text)' }}>Response Tracking</strong> use Consequence/Fatigue Management.
            Fleet Safety Score stays the overview on Home and Safety.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 20px 20px' }}>
          <Link
            to="/drivers"
            onClick={onClose}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36,
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
              display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36,
              padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'var(--cd-surface-2)', color: 'var(--cd-text)', textDecoration: 'none',
              border: '1px solid var(--cd-border)',
            }}
          >
            Response Tracking <ArrowRight size={13} />
          </Link>
          <Link
            to={{ pathname: '/settings/scoring', hash: 'consequence-bands' }}
            onClick={onClose}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36,
              padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'var(--cd-surface-2)', color: 'var(--cd-text-muted)', textDecoration: 'none',
              border: '1px solid var(--cd-border)',
            }}
          >
            Edit values
          </Link>
        </div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .bpl-consequence-explainer-grid { grid-template-columns: 1fr !important; }
          .bpl-consequence-explainer-grid > section:first-child {
            border-right: none !important;
            border-bottom: 1px solid var(--cd-border);
          }
          .bpl-score-steps { grid-template-columns: 1fr !important; }
          .bpl-score-steps > [aria-hidden] { display: none !important; }
          .bpl-driver-band-grid { grid-template-columns: 1fr 1fr !important; }
          .bpl-consequence-checklist-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
