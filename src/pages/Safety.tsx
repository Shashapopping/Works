import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, Minus,
  ShieldCheck, ShieldAlert, Shield, ArrowRight,
  Users, Activity, Zap, Target,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts';
import { useFleet } from '../context/FleetContext';
import type { LogEntry } from '../context/FleetContext';
import { isKnownDriver, displayDriverName } from '../lib/driverUtils';
import { clientName } from '../lib/branding';
import MockNamesBadge from '../components/MockNamesBadge';
import ConsequenceExplainerModal from '../components/ConsequenceExplainerModal';
import {
  scoreFromEvents,
  scoreBandColor,
  scoreBandLabel,
  eventWeight,
  ratePer100Vehicles,
  type FleetScoreConfig,
} from '../lib/fleetSafetyScore';

const HIDDEN = ['Possible Power Tamper', 'Battery Disconnection', 'Battery Disconnected', 'Front Panel Tamper', 'Back Panel Tamper', 'No Blue Key'];

const isSafetyEvent = (e: LogEntry) => e.type !== 'panic' && !HIDDEN.includes(e.label || '');

const scoreColor = (s: number, config?: FleetScoreConfig) => scoreBandColor(s, config);
const scoreLabel = (s: number, config?: FleetScoreConfig) => scoreBandLabel(s, config);

// ─── ScoreGauge (standalone, large) ─────────────────────────────────────────
function ScoreGauge({ score, delta, totalIncidents, weightedRate, onOpenExplainer, config }: {
  score: number; delta: number; totalIncidents: number;
  weightedRate: number;
  onOpenExplainer: () => void;
  config: FleetScoreConfig;
}) {
  const color = scoreColor(score, config);
  const label = scoreLabel(score, config);
  const sublabel = score >= config.bandGood
    ? 'At or near leading fleets on weighted incidents per 100 vehicles'
    : score >= config.bandAttention
    ? 'Above leading-fleet rate — coaching recommended'
    : score >= config.bandBelow
    ? 'Well above leading fleets — priority driver review'
    : 'Far from leading standard — immediate intervention advised';

  const circumference = 2 * Math.PI * 48;

  return (
    <button
      type="button"
      className="bpl-card"
      onClick={onOpenExplainer}
      title="How scoring works — Fleet vs Driver Consequence"
      style={{
        padding: '24px', display: 'flex', flexDirection: 'column', gap: 20,
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
              stroke={color} strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - score / 100)}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.8s ease' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 28, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>{score}</span>
            <span style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontWeight: 600 }}>/100</span>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)', lineHeight: 1, marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>{sublabel}</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 14 }}>
            {delta > 0
              ? <><TrendingUp size={13} color="#16a34a" /><span style={{ color: '#16a34a', fontWeight: 600 }}>+{delta} pts vs last month</span></>
              : delta < 0
              ? <><TrendingDown size={13} color="#CC0000" /><span style={{ color: '#CC0000', fontWeight: 600 }}>{delta} pts vs last month</span></>
              : <><Minus size={13} color="var(--cd-text-muted)" /><span style={{ color: 'var(--cd-text-muted)' }}>No change vs last month</span></>
            }
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              { value: totalIncidents, label: 'incidents / 30d' },
              { value: weightedRate.toFixed(1), label: 'weighted /100 veh' },
              { value: `≤${config.leadingRatePer100}`, label: 'leading aim' },
            ].map(m => (
              <div key={m.label}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>{m.value}</div>
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
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
        }}>
          {[
            { label: 'Harsh Braking', weight: config.weights.harshBraking, color: '#e05c2a' },
            { label: 'Overspeeding', weight: config.weights.overspeeding, color: '#d97706' },
            { label: 'Harsh Accel.', weight: config.weights.harshAcceleration, color: '#f59e0b' },
            { label: 'Cornering', weight: config.weights.harshCornering, color: '#8b5cf6' },
          ].map(w => (
            <div key={w.label} style={{
              background: `${w.color}12`, border: `1px solid ${w.color}30`,
              borderRadius: 6, padding: '6px 8px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: w.color, fontFamily: 'var(--cd-font-display)' }}>−{w.weight}</div>
              <div style={{ fontSize: 9, color: 'var(--cd-text-muted)', marginTop: 2, lineHeight: 1.3 }}>{w.label}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#0078D4', marginTop: 10, fontWeight: 600 }}>
          Click to see Fleet vs Driver Consequence scoring
        </div>
      </div>
    </button>
  );
}

// ─── IncidentBreakdown (bar chart) ───────────────────────────────────────────
function IncidentBreakdown({ events }: { events: LogEntry[] }) {
  const { scoreConfig } = useFleet();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = events.filter(e => new Date(e.eventTime || e.timestamp).getTime() >= thirtyDaysAgo && isSafetyEvent(e));
  const w = scoreConfig.weights;

  const data = [
    { name: 'Harsh Braking', count: recent.filter(e => e.label === 'Harsh Braking').length, color: '#e05c2a', weight: w.harshBraking },
    { name: 'Overspeeding', count: recent.filter(e => e.label === 'Overspeeding' || e.label === 'Overspeed Tiered').length, color: '#d97706', weight: w.overspeeding },
    { name: 'Harsh Accel.', count: recent.filter(e => e.label === 'Harsh Acceleration').length, color: '#f59e0b', weight: w.harshAcceleration },
    { name: 'Cornering', count: recent.filter(e => e.label === 'Harsh Cornering').length, color: '#8b5cf6', weight: w.harshCornering },
  ].sort((a, b) => b.count - a.count);

  const totalDeduction = data.reduce((acc, d) => acc + d.count * d.weight, 0);

  return (
    <div className="bpl-card" style={{ padding: '20px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)', marginBottom: 2 }}>Incident Breakdown</div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>Last 30 days · weighted deduction total: <strong style={{ color: 'var(--cd-text)' }}>{totalDeduction.toFixed(0)}</strong></div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} barSize={28} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--cd-border)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }} axisLine={false} tickLine={false} />
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
  );
}

// ─── WorstPerformers ─────────────────────────────────────────────────────────
function WorstPerformers({ events, vehicleCount }: { events: LogEntry[]; vehicleCount: number }) {
  const { scoreConfig } = useFleet();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const driverMap = useMemo(() => {
    const map: Record<string, {
      name: string; incidents: number; riskScore: number;
      types: Record<string, number>; lastEvent: string;
    }> = {};

    events.forEach(e => {
      const name = e.driverName;
      if (!isKnownDriver(name)) return;
      if (!isSafetyEvent(e)) return;
      const ts = new Date(e.eventTime || e.timestamp).getTime();
      if (ts < thirtyDaysAgo) return;

      if (!map[name]) map[name] = { name, incidents: 0, riskScore: 0, types: {}, lastEvent: '' };
      map[name].incidents++;
      map[name].riskScore += eventWeight(e.label, scoreConfig);
      const lbl = e.label || 'Unknown';
      map[name].types[lbl] = (map[name].types[lbl] || 0) + 1;
      const t = e.eventTime || e.timestamp;
      if (!map[name].lastEvent || t > map[name].lastEvent) map[name].lastEvent = t;
    });

    return Object.values(map)
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);
  }, [events, scoreConfig]);

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

      {driverMap.length === 0 ? (
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
function SafetyRadar({ events }: { events: LogEntry[] }) {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = events.filter(e => new Date(e.eventTime || e.timestamp).getTime() >= thirtyDaysAgo && isSafetyEvent(e));
  const total = Math.max(recent.length, 1);

  const data = [
    { subject: 'Braking', value: Math.round((recent.filter(e => e.label === 'Harsh Braking').length / total) * 100) },
    { subject: 'Speed', value: Math.round((recent.filter(e => e.label?.includes('Overspeed')).length / total) * 100) },
    { subject: 'Acceleration', value: Math.round((recent.filter(e => e.label === 'Harsh Acceleration').length / total) * 100) },
    { subject: 'Cornering', value: Math.round((recent.filter(e => e.label === 'Harsh Cornering').length / total) * 100) },
  ];

  return (
    <div className="bpl-card" style={{ padding: '20px 22px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)', marginBottom: 16 }}>
        Behaviour Profile
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <RadarChart data={data} margin={{ top: 0, right: 20, bottom: 0, left: 20 }}>
          <PolarGrid stroke="var(--cd-border)" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }} />
          <Radar dataKey="value" stroke="#0078D4" fill="#0078D4" fillOpacity={0.18} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', textAlign: 'center', marginTop: -4 }}>
        Higher = more of this offence · share of safety events (last 30d)
      </div>
    </div>
  );
}

// ─── Priority Actions ────────────────────────────────────────────────────────
function PriorityActions({ events, score, vehicleCount }: { events: LogEntry[]; score: number; vehicleCount: number }) {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = events.filter(e =>
    new Date(e.eventTime || e.timestamp).getTime() >= thirtyDaysAgo && isSafetyEvent(e)
  );

  const actions = useMemo(() => {
    const list: {
      priority: 'critical' | 'high' | 'medium';
      title: string;
      detail: string;
      icon: React.ElementType;
      to?: string;
    }[] = [];

    const brakingCount = recent.filter(e => e.label === 'Harsh Braking').length;
    if (brakingCount > 10) {
      const topBraker = Object.entries(
        recent.filter(e => e.label === 'Harsh Braking').reduce((acc, e) => {
          if (!isKnownDriver(e.driverName)) return acc;
          const n = e.driverName!;
          acc[n] = (acc[n] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).sort(([, a], [, b]) => b - a)[0];
      list.push({
        priority: 'high',
        title: `${brakingCount} harsh braking events — highest-weight offence`,
        detail: topBraker ? `Worst offender: ${topBraker[0]} (${topBraker[1]} events). Schedule following-distance and anticipation coaching.` : 'Schedule fleet-wide defensive driving refresher.',
        icon: ShieldAlert,
        to: '/incidents',
      });
    }

    const speedCount = recent.filter(e => e.label === 'Overspeeding' || e.label === 'Overspeed Tiered').length;
    if (speedCount > 5) {
      list.push({
        priority: 'high',
        title: `${speedCount} speeding events recorded`,
        detail: 'Review vehicle speed limiter configuration and enforce zero-tolerance speed policy per FRSC guidelines.',
        icon: Zap,
        to: '/incidents?filter=Overspeeding',
      });
    }

    const accelCount = recent.filter(e => e.label === 'Harsh Acceleration').length;
    if (accelCount > 8) {
      list.push({
        priority: 'medium',
        title: `${accelCount} harsh acceleration events`,
        detail: 'Often indicates schedule pressure. Review route timing and delivery windows to reduce driver urgency.',
        icon: Activity,
        to: '/incidents?filter=Harsh+Acceleration',
      });
    }

    const repeatDrivers = Object.entries(
      recent.reduce((acc, e) => {
        const n = e.driverName;
        if (!isKnownDriver(n)) return acc;
        acc[n] = (acc[n] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).filter(([, c]) => c >= 5);

    if (repeatDrivers.length > 0) {
      list.push({
        priority: 'medium',
        title: `${repeatDrivers.length} repeat offenders (5+ incidents each)`,
        detail: `${repeatDrivers.slice(0, 3).map(([n, c]) => `${n} (${c})`).join(', ')} — enrol in targeted behaviour coaching programme.`,
        icon: Users,
        to: '/incidents/response',
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
  }, [recent, score, vehicleCount]);

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
function KpiStrip({ events, vehicleCount }: { events: LogEntry[]; vehicleCount: number }) {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const recent30 = events.filter(e => isSafetyEvent(e) && new Date(e.eventTime || e.timestamp).getTime() >= thirtyDaysAgo);
  const recent7 = events.filter(e => isSafetyEvent(e) && new Date(e.eventTime || e.timestamp).getTime() >= sevenDaysAgo);
  const affectedVehicles = new Set(recent30.map(e => e.assetId)).size;
  const cleanVehicles = vehicleCount - affectedVehicles;

  const kpis = [
    { label: 'Incidents (30d)', value: recent30.length, sub: `${recent7.length} this week`, color: '#0078D4', icon: Activity },
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
            <div style={{ fontSize: 26, fontWeight: 700, color: k.color, lineHeight: 1, fontFamily: 'var(--cd-font-display)', marginBottom: 4 }}>{k.value}</div>
            <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>{k.sub}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function Safety() {
  const { events, vehicles, scoreConfig } = useFleet();
  const [explainerOpen, setExplainerOpen] = useState(false);

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const recentIncidents = events.filter(e => isSafetyEvent(e) && new Date(e.eventTime || e.timestamp).getTime() >= thirtyDaysAgo);
  const previousIncidents = events.filter(e => {
    const t = new Date(e.eventTime || e.timestamp).getTime();
    return isSafetyEvent(e) && t >= sixtyDaysAgo && t < thirtyDaysAgo;
  });
  const fleetSafetyScore = scoreFromEvents(recentIncidents, vehicles.length, scoreConfig);
  const fleetScoreDelta = fleetSafetyScore - scoreFromEvents(previousIncidents, vehicles.length, scoreConfig);
  const totalIncidents = recentIncidents.length;
  const weightedRate = ratePer100Vehicles(recentIncidents, vehicles.length, scoreConfig);

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Safety <MockNamesBadge /></h1>
        <p className="bpl-page-subtitle">Fleet score vs leading fleets + driver consequence tiers · {clientName()}</p>
      </div>

      {/* KPI strip */}
      <KpiStrip events={events} vehicleCount={vehicles.length} />

      {/* Score + Breakdown + Radar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 260px', gap: 14, marginBottom: 20 }}>
        <ScoreGauge
          score={fleetSafetyScore}
          delta={fleetScoreDelta}
          totalIncidents={totalIncidents}
          weightedRate={weightedRate}
          config={scoreConfig}
          onOpenExplainer={() => setExplainerOpen(true)}
        />
        <IncidentBreakdown events={events} />
        <SafetyRadar events={events} />
      </div>

      {/* Worst performers */}
      <div style={{ marginBottom: 20 }}>
        <WorstPerformers events={events} vehicleCount={vehicles.length} />
      </div>

      {/* Priority actions */}
      <PriorityActions events={events} score={fleetSafetyScore} vehicleCount={vehicles.length} />

      {explainerOpen && (
        <ConsequenceExplainerModal
          fleetScore={fleetSafetyScore}
          fleetDelta={fleetScoreDelta}
          totalIncidents={totalIncidents}
          vehicleCount={vehicles.length}
          actualWeightedRate={weightedRate}
          scoreConfig={scoreConfig}
          onClose={() => setExplainerOpen(false)}
        />
      )}
    </div>
  );
}
