import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, Minus,
  ShieldCheck, ShieldAlert, Shield, ArrowRight,
  Activity, Zap, Target,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts';
import { useFleet, authFetch } from '../context/FleetContext';
import { isKnownDriver, displayDriverName } from '../lib/driverUtils';
import { clientName } from '../lib/branding';
import MockNamesBadge from '../components/MockNamesBadge';
import ConsequenceExplainerModal from '../components/ConsequenceExplainerModal';
import {
  scoreBandColor,
  scoreBandLabel,
  ratePer100Km,
  computeFleetScore,
  totalSafetyPointsFromCensus,
  SCORE_DROP_PER_IVMS_UNIT,
  FLEET_SCORE_SCALE,
  eventWeight,
  hosSlicesFromMinutes,
  type FleetScoreConfig,
  type FleetSafetyExposure,
} from '../lib/fleetSafetyScore';
import { SkelValue } from '../components/data/DataBusy';
import { appendUrlScope } from '../lib/siteScope';
import { authCachedJson, cachePeek, CACHE_TTL, peekSafetySummary } from '../lib/apiCache';
import PagePeriodBar from '../components/PagePeriodBar';
import { type PageDateRange, defaultPageCustomRange, pagePeriodIsoBounds } from '../lib/pagePeriod';
const scoreColor = (s: number, config?: FleetScoreConfig) => scoreBandColor(s, config);
const scoreLabel = (s: number, config?: FleetScoreConfig) => scoreBandLabel(s, config);

// ─── ScoreGauge (standalone, large) ─────────────────────────────────────────
function ScoreGauge({
  score,
  delta,
  totalIncidents,
  weightedRate,
  hosHeldMinutes,
  hosSlices,
  onOpenExplainer,
  config,
  busy,
}: {
  score: number; delta: number; totalIncidents: number;
  weightedRate: number;
  hosHeldMinutes: number;
  hosSlices?: number;
  onOpenExplainer: () => void;
  config: FleetScoreConfig;
  busy?: boolean;
}) {
  const color = scoreColor(score, config);
  const label = scoreLabel(score, config);
  const sublabel = score >= config.bandGood
    ? 'Low weighted IVMS rate per 100 km'
    : score >= config.bandAttention
    ? 'Elevated IVMS rate per 100 km — coaching recommended'
    : score >= config.bandBelow
    ? 'High IVMS rate per 100 km — priority review'
    : 'Very high IVMS rate per 100 km — immediate intervention advised';

  const circumference = 2 * Math.PI * 48;
  const activeHosSlices = hosSlices ?? hosSlicesFromMinutes(hosHeldMinutes, config);
  const hosWeightLabel = `+${config.hosPointsPer10Min} / ${config.hosSliceMinutes} min`;

  return (
    <button
      type="button"
      className="bpl-card"
      onClick={onOpenExplainer}
      title="How scoring works — two scores, two jobs"
      style={{
        padding: '20px', display: 'flex', flexDirection: 'column', gap: 18,
        cursor: 'pointer', textAlign: 'left', width: '100%',
        border: '1px solid var(--cd-border)', background: 'var(--cd-surface)',
        font: 'inherit', color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)' }}>
          Fleet Safety Score
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, color: '#0078D4' }}>How scoring works</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* Ring */}
        <div style={{ position: 'relative', width: 112, height: 112, flexShrink: 0 }}>
          <svg width="112" height="112" viewBox="0 0 112 112" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="56" cy="56" r="48" fill="none" stroke="var(--cd-border)" strokeWidth="8" />
            <circle
              cx="56" cy="56" r="48" fill="none"
              stroke={busy ? 'var(--cd-border)' : color} strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - (busy ? 0 : score) / FLEET_SCORE_SCALE)}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.8s ease' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: busy ? 'var(--cd-text-muted)' : color, fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>
              {busy ? <SkelValue /> : score}
            </span>
            {!busy && <span style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontWeight: 600 }}>/{FLEET_SCORE_SCALE}</span>}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: busy ? 'var(--cd-text-muted)' : color, fontFamily: 'var(--cd-font-display)', lineHeight: 1, marginBottom: 4 }}>
            {busy ? <SkelValue wide /> : label}
          </div>
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            {busy ? 'Loading incident data…' : sublabel}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 14 }}>
            {busy ? (
              <SkelValue wide />
            ) : delta > 0
              ? <><TrendingUp size={13} color="#16a34a" /><span style={{ color: '#16a34a', fontWeight: 600 }}>+{delta} pts vs last month</span></>
              : delta < 0
              ? <><TrendingDown size={13} color="#CC0000" /><span style={{ color: '#CC0000', fontWeight: 600 }}>{delta} pts vs last month</span></>
              : <><Minus size={13} color="var(--cd-text-muted)" /><span style={{ color: 'var(--cd-text-muted)' }}>No change vs last month</span></>
            }
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              { value: totalIncidents, label: 'incidents / 30d', title: undefined },
              { value: weightedRate.toFixed(2), label: 'IVMS pts / 100 km', title: undefined },
              { value: SCORE_DROP_PER_IVMS_UNIT, label: '× multiplier', title: undefined },
              { value: activeHosSlices, label: 'HOS slices', title: undefined },
            ].map(m => (
              <div key={m.label} title={m.title}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>
                  {busy ? <SkelValue /> : m.value}
                </div>
                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 2 }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Fleet score weights */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)', marginBottom: 8 }}>
          Fleet score weights
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8,
        }}>
          {[
            { label: 'Harsh Braking', weight: config.weights.harshBraking, color: '#e05c2a', title: undefined },
            { label: 'Overspeeding', weight: config.weights.overspeeding, color: '#d97706', title: undefined },
            { label: 'Harsh Accel.', weight: config.weights.harshAcceleration, color: '#f59e0b', title: undefined },
            { label: 'Cornering', weight: config.weights.harshCornering, color: '#8b5cf6', title: undefined },
            { label: 'HOS', weight: hosWeightLabel, color: '#0d9488', title: undefined },
          ].map(w => (
            <div key={w.label} title={w.title} style={{
              background: `${w.color}12`, border: `1px solid ${w.color}30`,
              borderRadius: 6, padding: '6px 8px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: w.color, fontFamily: 'var(--cd-font-display)' }}>
                {typeof w.weight === 'string' ? w.weight : `+${w.weight}`}
              </div>
              <div style={{ fontSize: 9, color: 'var(--cd-text-muted)', marginTop: 2, lineHeight: 1.3 }}>{w.label}</div>
            </div>
          ))}
        </div>
      </div>
    </button>
  );
}

// ─── IncidentBreakdown (bar chart) ───────────────────────────────────────────
function IncidentBreakdown({ byLabel }: { byLabel?: Record<string, number> }) {
  const { scoreConfig } = useFleet();
  const w = scoreConfig.weights;
  const counts = byLabel || {};

  const data = [
    { name: 'Harsh Braking', count: counts['Harsh Braking'] || 0, color: '#e05c2a', weight: w.harshBraking },
    { name: 'Overspeeding', count: counts['Overspeeding'] || 0, color: '#d97706', weight: w.overspeeding },
    {
      name: 'Tiered / Road Spd',
      count: (counts['Overspeed Tiered'] || 0) + (counts['Road Speed Overspeeding'] || 0),
      color: '#a855f7',
      weight: w.overspeeding,
    },
    { name: 'Harsh Accel.', count: counts['Harsh Acceleration'] || 0, color: '#f59e0b', weight: w.harshAcceleration },
    { name: 'Cornering', count: counts['Harsh Cornering'] || 0, color: '#8b5cf6', weight: w.harshCornering },
  ].sort((a, b) => b.count - a.count);

  const totalDeduction = data.reduce((acc, d) => acc + d.count * d.weight, 0);

  return (
    <div className="bpl-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', minHeight: 300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)', marginBottom: 2 }}>Incident Breakdown</div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>Last 30 days · weighted deduction total: <strong style={{ color: 'var(--cd-text)' }}>{totalDeduction.toFixed(0)}</strong></div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 220, paddingTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barSize={28} margin={{ top: 8, right: 8, bottom: 28, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--cd-border)" vertical={false} />
          <XAxis
            dataKey="name"
            interval={0}
            tick={{ fontSize: 9, fill: 'var(--cd-text-muted)' }}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
          />
          <YAxis
            width={32}
            tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{ background: 'var(--cd-surface)', border: '1px solid var(--cd-border)', borderRadius: 6, fontSize: 12 }}
            formatter={(value: number, name: string, props: any) => [`${value} incidents (−${(value * props.payload.weight).toFixed(0)} pts)`, 'Count']}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
          </Bar>
        </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── WorstPerformers ─────────────────────────────────────────────────────────
function WorstPerformers({
  assetIds = [],
  scoped,
}: {
  assetIds?: string[];
  scoped: boolean;
}) {
  const { scoreConfig } = useFleet();
  const assetScopeKey = assetIds.join(',');
  const url = useMemo(() => {
    const params = new URLSearchParams({ range: '30d' });
    return appendUrlScope(`/api/risk/drivers?${params.toString()}`, {
      assetIds: scoped ? assetIds : [],
    });
  }, [assetScopeKey, scoped]);
  const [rows, setRows] = useState<{
    name: string; incidents: number; riskScore: number; types: Record<string, number>; lastEvent: string;
  }[]>(() => {
    const cached = cachePeek<{ drivers?: Array<{
      driverName?: string;
      harshBraking?: number;
      harshAcceleration?: number;
      overspeeding?: number;
      overspeedTiered?: number;
      harshCornering?: number;
      total?: number;
    }> }>(url);
    if (!cached?.drivers) return [];
    return cached.drivers
      .filter(d => isKnownDriver(d.driverName))
      .map(d => {
        const types: Record<string, number> = {};
        if (d.harshBraking) types['Harsh Braking'] = d.harshBraking;
        if (d.harshAcceleration) types['Harsh Acceleration'] = d.harshAcceleration;
        if ((d.overspeeding || 0) + (d.overspeedTiered || 0)) {
          types.Overspeeding = (d.overspeeding || 0) + (d.overspeedTiered || 0);
        }
        if (d.harshCornering) types['Harsh Cornering'] = d.harshCornering;
        let riskScore = 0;
        for (const [label, count] of Object.entries(types)) {
          riskScore += eventWeight(label, scoreConfig) * count;
        }
        return {
          name: d.driverName || 'N/A',
          incidents: d.total ?? 0,
          riskScore,
          types,
          lastEvent: '',
        };
      })
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);
  });
  const [loading, setLoading] = useState(() => Boolean(url) && !cachePeek(url));

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const cached = cachePeek(url);
    if (cached) {
      setLoading(false);
    } else {
      setRows([]);
      setLoading(true);
    }
    authCachedJson<{
      drivers?: Array<{
        driverName?: string;
        harshBraking?: number;
        harshAcceleration?: number;
        overspeeding?: number;
        overspeedTiered?: number;
        harshCornering?: number;
        total?: number;
      }>;
    }>(url, authFetch, { ttlMs: CACHE_TTL.riskDrivers })
      .then(data => {
        if (cancelled || !data?.drivers) return;
        setRows(
          data.drivers
            .filter(d => isKnownDriver(d.driverName))
            .map(d => {
              const types: Record<string, number> = {};
              if (d.harshBraking) types['Harsh Braking'] = d.harshBraking;
              if (d.harshAcceleration) types['Harsh Acceleration'] = d.harshAcceleration;
              if ((d.overspeeding || 0) + (d.overspeedTiered || 0)) {
                types.Overspeeding = (d.overspeeding || 0) + (d.overspeedTiered || 0);
              }
              if (d.harshCornering) types['Harsh Cornering'] = d.harshCornering;
              let riskScore = 0;
              for (const [label, count] of Object.entries(types)) {
                riskScore += eventWeight(label, scoreConfig) * count;
              }
              return {
                name: d.driverName || 'N/A',
                incidents: d.total ?? 0,
                riskScore,
                types,
                lastEvent: '',
              };
            })
            .sort((a, b) => b.riskScore - a.riskScore)
            .slice(0, 10),
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [url, scoreConfig]);

  const driverMap = rows;

  const maxRisk = Math.max(...driverMap.map(d => d.riskScore), 1);

  const riskTier = (score: number): { label: string; color: string } => {
    const pct = score / maxRisk;
    if (pct >= 0.75) return { label: 'Critical', color: '#CC0000' };
    if (pct >= 0.5) return { label: 'High', color: '#e05c2a' };
    if (pct >= 0.25) return { label: 'Medium', color: '#d97706' };
    return { label: 'Low', color: '#16a34a' };
  };

  return (
    <div className="bpl-card">
      <div className="bpl-card-header">
        <span className="bpl-card-title">Worst Performing Drivers</span>
        <span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>Ranked by weighted risk · last 30 days</span>
      </div>

      {loading && rows.length === 0 ? (
        <div style={{ padding: '32px 20px' }}>
          {/* Skeleton header row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '28px 1fr 100px 80px 120px 110px',
            padding: '7px 0', marginBottom: 8,
            borderBottom: '1px solid var(--cd-border)',
          }}>
            {['#', 'Driver', 'Risk Score', 'Incidents', 'Top Offence', 'Last Event'].map(h => (
              <span key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)' }}>{h}</span>
            ))}
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '28px 1fr 100px 80px 120px 110px',
              padding: '13px 0', borderBottom: i < 4 ? '1px solid var(--cd-border)' : 'none',
              alignItems: 'center', gap: 0,
            }}>
              <div style={{ width: 14, height: 10, background: 'var(--cd-border)', borderRadius: 3, opacity: 0.5 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ width: `${55 + (i % 3) * 15}%`, height: 11, background: 'var(--cd-border)', borderRadius: 3 }} />
                <div style={{ width: '70%', height: 8, background: 'var(--cd-border)', borderRadius: 3, opacity: 0.4 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ height: 4, background: 'var(--cd-border)', borderRadius: 99, width: '80%' }} />
                <div style={{ width: 28, height: 8, background: 'var(--cd-border)', borderRadius: 3, opacity: 0.4 }} />
              </div>
              <div style={{ width: 24, height: 13, background: 'var(--cd-border)', borderRadius: 3 }} />
              <div style={{ width: '70%', height: 20, background: 'var(--cd-border)', borderRadius: 4, opacity: 0.5 }} />
              <div style={{ width: '75%', height: 10, background: 'var(--cd-border)', borderRadius: 3, opacity: 0.4 }} />
            </div>
          ))}
        </div>
      ) : driverMap.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>
          No driver incident data for this period
        </div>
      ) : (
        <div>
          {/* Header row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '28px 1fr 100px 80px 120px 110px',
            padding: '7px 20px', borderBottom: '1px solid var(--cd-border)',
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)',
          }}>
            <span>#</span>
            <span>Driver</span>
            <span>Risk Score</span>
            <span>Incidents</span>
            <span>Top Offence</span>
            <span>Last Event</span>
          </div>

          {driverMap.map((d, i) => {
            const tier = riskTier(d.riskScore);
            const topType = Object.entries(d.types).sort(([, a], [, b]) => b - a)[0];
            const lastFmt = d.lastEvent
              ? new Date(d.lastEvent).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
              : '—';

            return (
              <div key={d.name} style={{
                display: 'grid', gridTemplateColumns: '28px 1fr 100px 80px 120px 110px',
                padding: '11px 20px',
                borderBottom: i < driverMap.length - 1 ? '1px solid var(--cd-border)' : 'none',
                alignItems: 'center',
                background: 'transparent',
              }}>
                <span style={{ fontSize: 11, color: 'var(--cd-text-muted)', fontWeight: 600 }}>{i + 1}</span>

                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {displayDriverName(d.name)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 1 }}>
                    {Object.entries(d.types).map(([t, c]) => `${t} ×${c}`).join(' · ')}
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 4, background: 'var(--cd-border)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${(d.riskScore / maxRisk) * 100}%`,
                        background: tier.color, borderRadius: 99,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: tier.color, minWidth: 22, textAlign: 'right' }}>{d.riskScore.toFixed(0)}</span>
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                    color: tier.color, marginTop: 3, display: 'block',
                  }}>{tier.label}</span>
                </div>

                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{d.incidents}</span>

                <div>
                  {topType && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                      background: 'var(--cd-border)', color: 'var(--cd-text)',
                    }}>{topType[0]} ×{topType[1]}</span>
                  )}
                </div>

                <span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{lastFmt}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── RadarCard ───────────────────────────────────────────────────────────────
function SafetyRadar({ byLabel }: { byLabel?: Record<string, number> }) {
  const braking = byLabel?.['Harsh Braking'] ?? 0;
  const speed = byLabel?.['Overspeeding'] ?? 0;
  const tiered = (byLabel?.['Overspeed Tiered'] ?? 0) + (byLabel?.['Road Speed Overspeeding'] ?? 0);
  const accel = byLabel?.['Harsh Acceleration'] ?? 0;
  const corner = byLabel?.['Harsh Cornering'] ?? 0;
  const total = Math.max(braking + speed + tiered + accel + corner, 1);

  const data = [
    { subject: 'Braking', value: Math.round((braking / total) * 100) },
    { subject: 'Speed', value: Math.round((speed / total) * 100) },
    { subject: 'Tiered Spd', value: Math.round((tiered / total) * 100) },
    { subject: 'Accel.', value: Math.round((accel / total) * 100) },
    { subject: 'Cornering', value: Math.round((corner / total) * 100) },
  ];

  return (
    <div className="bpl-card" style={{ padding: '18px 20px', minHeight: 300 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)', marginBottom: 16 }}>
        Behaviour Profile
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <RadarChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
          <PolarGrid stroke="var(--cd-border)" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }} />
          <Radar dataKey="value" stroke="#0078D4" fill="#0078D4" fillOpacity={0.18} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', textAlign: 'center', marginTop: -4 }}>
        Higher = more of this offence · last 30d · Tiered Spd = Overspeed Tiered + Road Speed (≥60 kph)
      </div>
    </div>
  );
}

// ─── Priority Actions ────────────────────────────────────────────────────────
function PriorityActions({ byLabel, score, vehicleCount }: {
  byLabel?: Record<string, number>;
  score: number;
  vehicleCount: number;
}) {
  const actions = useMemo(() => {
    const list: {
      priority: 'critical' | 'high' | 'medium';
      title: string;
      detail: string;
      icon: React.ElementType;
      to?: string;
    }[] = [];

    const brakingCount = byLabel?.['Harsh Braking'] ?? 0;
    if (brakingCount > 10) {
      list.push({
        priority: 'high',
        title: `${brakingCount.toLocaleString()} harsh braking events — highest-weight offence`,
        detail: 'Schedule following-distance and anticipation coaching. See worst performers for named drivers.',
        icon: ShieldAlert,
        to: '/incidents',
      });
    }

    const speedCount = (byLabel?.['Overspeeding'] ?? 0) + (byLabel?.['Overspeed Tiered'] ?? 0) + (byLabel?.['Road Speed Overspeeding'] ?? 0);
    if (speedCount > 5) {
      list.push({
        priority: 'high',
        title: `${speedCount.toLocaleString()} speeding events recorded`,
        detail: 'Review vehicle speed limiter configuration and enforce zero-tolerance speed policy per FRSC guidelines.',
        icon: Zap,
        to: '/incidents?filter=Overspeeding',
      });
    }

    const accelCount = byLabel?.['Harsh Acceleration'] ?? 0;
    if (accelCount > 8) {
      list.push({
        priority: 'medium',
        title: `${accelCount.toLocaleString()} harsh acceleration events`,
        detail: 'Often indicates schedule pressure. Review route timing and delivery windows to reduce driver urgency.',
        icon: Activity,
        to: '/incidents?filter=Harsh+Acceleration',
      });
    }

    if (score < 60 && vehicleCount > 0) {
      list.push({
        priority: 'medium',
        title: 'Fleet score below acceptable threshold',
        detail: 'Consider a toolbox talk on the scoring system so drivers understand how their behaviour affects the fleet rating.',
        icon: Target,
      });
    }

    return list.slice(0, 6);
  }, [byLabel, score, vehicleCount]);

  const priorityStyle = (p: string) => {
    if (p === 'high') return { bg: 'rgba(224,92,42,0.06)', border: 'rgba(224,92,42,0.25)', dot: '#e05c2a', label: 'High' };
    return { bg: 'rgba(217,119,6,0.06)', border: 'rgba(217,119,6,0.25)', dot: '#d97706', label: 'Medium' };
  };

  return (
    <div className="bpl-card">
      <div className="bpl-card-header">
        <span className="bpl-card-title">Priority Actions</span>
        <span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>Auto-generated from incident data</span>
      </div>

      {actions.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center' }}>
          <ShieldCheck size={28} strokeWidth={1.5} style={{ color: '#16a34a', marginBottom: 10 }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)' }}>No critical actions flagged</div>
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginTop: 4 }}>Fleet behaviour is within acceptable parameters</div>
        </div>
      ) : (
        <div>
          {actions.map((a, i) => {
            const s = priorityStyle(a.priority);
            const Icon = a.icon;
            const rowStyle: React.CSSProperties = {
              display: 'flex', gap: 14, padding: '14px 20px',
              borderBottom: i < actions.length - 1 ? '1px solid var(--cd-border)' : 'none',
              background: s.bg,
              borderLeft: `3px solid ${s.dot}`,
              textDecoration: 'none',
              color: 'inherit',
              cursor: a.to ? 'pointer' : 'default',
              transition: a.to ? 'background 0.15s' : undefined,
            };
            const content = (
              <>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: `${s.dot}18`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={15} color={s.dot} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: s.dot }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 3 }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', lineHeight: 1.5 }}>{a.detail}</div>
                </div>
                {a.to && <ArrowRight size={14} style={{ color: 'var(--cd-text-muted)', flexShrink: 0, marginTop: 2 }} />}
              </>
            );
            return a.to ? (
              <Link key={i} to={a.to} style={rowStyle}>
                {content}
              </Link>
            ) : (
              <div key={i} style={rowStyle}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── KPI strip ───────────────────────────────────────────────────────────────
function KpiStrip({ vehicleCount, exposure, busy }: { vehicleCount: number; exposure: FleetSafetyExposure | null; busy?: boolean }) {
  const incidents = exposure?.incidentTotal ?? 0;
  const affectedVehicles = exposure?.assetCount ?? 0;
  const cleanVehicles = vehicleCount - affectedVehicles;

  const kpis = [
    { label: 'Incidents (30d)', value: incidents, sub: 'Full census', color: '#0078D4', icon: Activity },
    { label: 'Vehicles with Incidents', value: affectedVehicles, sub: `${vehicleCount > 0 ? Math.round((affectedVehicles / vehicleCount) * 100) : 0}% of fleet`, color: '#e05c2a', icon: Shield },
    { label: 'Clean Vehicles', value: cleanVehicles >= 0 ? cleanVehicles : '—', sub: 'Zero incidents (30d)', color: '#16a34a', icon: ShieldCheck },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
      {kpis.map(k => {
        const Icon = k.icon;
        return (
          <div key={k.label} className="bpl-card" style={{ padding: '16px 18px', borderTop: `3px solid ${k.color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)' }}>{k.label}</span>
              <Icon size={13} style={{ color: k.color, opacity: 0.7 }} />
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: k.color, lineHeight: 1, fontFamily: 'var(--cd-font-display)', marginBottom: 4 }}>
              {busy ? <SkelValue wide /> : k.value}
            </div>
            <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>{busy ? '—' : k.sub}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function Safety() {
  const {
    vehicles,
    scoreConfig,
    safetyScore,
    safetyDelta,
    safetyExposure,
    safetyExposureLoading,
    scopedAssetIds,
    siteFilterActive,
  } = useFleet();
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [dateRange, setDateRange] = useState<PageDateRange>('30days');
  const [customRange, setCustomRange] = useState(defaultPageCustomRange);
  const [periodExposure, setPeriodExposure] = useState<FleetSafetyExposure | null>(null);
  const [periodLoading, setPeriodLoading] = useState(false);

  const siteFiltered = siteFilterActive;
  const useContextExposure = dateRange === '30days';
  const assetScopeKey = scopedAssetIds.join(',');

  const periodUrl = useMemo(() => {
    if (useContextExposure) return '';
    const b = pagePeriodIsoBounds(dateRange, customRange.from, customRange.to);
    const params = new URLSearchParams();
    if (b.from && b.to) {
      params.set('from', b.from);
      params.set('to', b.to);
    } else if (dateRange === 'today') params.set('range', 'today');
    else if (dateRange === '7days') params.set('range', '7d');
    else params.set('range', '30d');
    return appendUrlScope(`/api/safety/summary?${params}`, {
      assetIds: siteFiltered ? scopedAssetIds : [],
    });
  }, [dateRange, customRange.from, customRange.to, siteFiltered, assetScopeKey, useContextExposure]);

  useEffect(() => {
    if (useContextExposure) {
      setPeriodLoading(false);
      return;
    }
    if (!periodUrl) {
      setPeriodExposure(null);
      setPeriodLoading(false);
      return;
    }
    let cancelled = false;
    const cached = cachePeek<FleetSafetyExposure>(periodUrl);
    setPeriodExposure(cached);
    setPeriodLoading(!cached);
    authCachedJson<FleetSafetyExposure>(periodUrl, authFetch, {
      ttlMs: CACHE_TTL.safetySummary,
    })
      .then(data => {
        if (cancelled || !data) return;
        setPeriodExposure(data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPeriodLoading(false); });
    return () => { cancelled = true; };
  }, [periodUrl, useContextExposure]);

  const pageExposure = useContextExposure
    ? safetyExposure
    : (periodExposure ?? safetyExposure);
  const totalIncidents = pageExposure?.incidentTotal ?? 0;
  const distanceKm = pageExposure?.distanceKm ?? 0;
  const hosHeldMinutes = pageExposure?.hosHeldMinutes ?? 0;
  const pageScoreResult = useMemo(() => {
    if (useContextExposure && safetyExposure) return { score: safetyScore, delta: safetyDelta };
    return computeFleetScore(pageExposure ?? { distanceKm: 0, hosHeldMinutes: 0, byLabel: {} }, null, scoreConfig);
  }, [useContextExposure, safetyExposure, safetyScore, safetyDelta, pageExposure, scoreConfig]);
  const points = totalSafetyPointsFromCensus(pageExposure ?? { distanceKm: 0, hosHeldMinutes: 0 }, scoreConfig);
  const weightedRate = ratePer100Km(points.ivms, distanceKm);
  const altLoading = useContextExposure
    ? safetyExposureLoading
    : (periodLoading || safetyExposureLoading);
  const pageBusy = !pageExposure && altLoading;
  const scoreBusy = pageBusy;

  return (
    <div>
      <div className="bpl-page-header bpl-page-header-row">
        <div>
          <h1 className="bpl-page-title">Safety <MockNamesBadge /></h1>
          <p className="bpl-page-subtitle">Fleet health from weighted IVMS per 100 km · driver discipline is a separate score · {clientName()}</p>
        </div>
        <PagePeriodBar
          value={dateRange}
          onChange={setDateRange}
          customFrom={customRange.from}
          customTo={customRange.to}
          onCustomFromChange={f => setCustomRange(r => ({ ...r, from: f }))}
          onCustomToChange={t => setCustomRange(r => ({ ...r, to: t }))}
        />
      </div>

      {/* KPI strip */}
      <KpiStrip vehicleCount={vehicles.length} exposure={pageExposure} busy={pageBusy} />

      {/* Score + Breakdown + Radar */}
      <div style={{ display: 'grid', gridTemplateColumns: '40fr 35fr 25fr', gap: 14, marginBottom: 20 }}>
        <ScoreGauge
          score={pageScoreResult.score}
          delta={pageScoreResult.delta}
          totalIncidents={totalIncidents}
          weightedRate={weightedRate}
          hosHeldMinutes={hosHeldMinutes}
          hosSlices={pageExposure?.hosSlices}
          config={scoreConfig}
          busy={scoreBusy}
          onOpenExplainer={() => setExplainerOpen(true)}
        />
        <IncidentBreakdown byLabel={pageExposure?.byLabel} />
        <SafetyRadar byLabel={pageExposure?.byLabel} />
      </div>

      {/* Worst performers */}
      <div style={{ marginBottom: 20 }}>
        <WorstPerformers assetIds={scopedAssetIds} scoped={siteFiltered} />
      </div>

      {/* Priority actions */}
      <PriorityActions byLabel={pageExposure?.byLabel} score={pageScoreResult.score} vehicleCount={vehicles.length} />

      {explainerOpen && (
        <ConsequenceExplainerModal
          fleetScore={pageScoreResult.score}
          fleetDelta={pageScoreResult.delta}
          totalIncidents={totalIncidents}
          vehicleCount={vehicles.length}
          actualWeightedRate={weightedRate}
          distanceKm={distanceKm}
          hosHeldMinutes={hosHeldMinutes}
          hosSlices={pageExposure?.hosSlices}
          scoreConfig={scoreConfig}
          onClose={() => setExplainerOpen(false)}
        />
      )}
    </div>
  );
}
