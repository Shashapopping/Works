import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, Minus,
  ShieldCheck, ShieldAlert, Shield, ArrowRight,
  Activity, Zap, Target,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  LineChart, Line, Legend,
} from 'recharts';
import { useFleet } from '../context/FleetContext';
import type { DriverDistanceSummary, LogEntry } from '../context/FleetContext';
import { isKnownDriver, displayDriverName } from '../lib/driverUtils';
import { clientName } from '../lib/branding';
import MockNamesBadge from '../components/MockNamesBadge';
import ConsequenceExplainerModal from '../components/ConsequenceExplainerModal';
import {
  scoreBandColor,
  scoreBandLabel,
  ratePer100Km,
  totalSafetyPointsFromCensus,
  SCORE_DROP_PER_HARM_UNIT,
  eventWeight,
  hosSlicesFromMinutes,
  type FleetScoreConfig,
  type FleetSafetyExposure,
} from '../lib/fleetSafetyScore';
import { SkelValue } from '../components/data/DataBusy';

const scoreColor = (s: number, config?: FleetScoreConfig) => scoreBandColor(s, config);
const scoreLabel = (s: number, config?: FleetScoreConfig) => scoreBandLabel(s, config);
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function shortDay(ms: number) {
  return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

// A "week" is the 7-day span ending `offsetWeeks` weeks ago (0 = the 7 days up to and including today).
function weekWindow(offsetWeeks: number) {
  const todayStart = startOfLocalDay(new Date());
  const end = todayStart - offsetWeeks * 7 * DAY_MS + DAY_MS;
  const start = end - 7 * DAY_MS;
  return { start, end };
}

function weekOptionLabel(offsetWeeks: number) {
  if (offsetWeeks === 0) return 'This week';
  if (offsetWeeks === 1) return 'Last week';
  const { start } = weekWindow(offsetWeeks);
  return `Week of ${new Date(start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
}

function weeklySafetyTrend(events: LogEntry[], scoreConfig: FleetScoreConfig, currentOffset: number, previousOffset: number) {
  const currentWin = weekWindow(currentOffset);
  const previousWin = weekWindow(previousOffset);

  const rows = Array.from({ length: 7 }, (_, i) => ({
    day: shortDay(currentWin.start + i * DAY_MS),
    previousDay: shortDay(previousWin.start + i * DAY_MS),
    currentIncidents: 0,
    previousIncidents: 0,
    currentPoints: 0,
    previousPoints: 0,
  }));

  for (const event of events) {
    if (event.type === 'panic') continue;
    const label = (event.label || '').trim();
    const weight = eventWeight(label, scoreConfig);
    if (!label || weight <= 0) continue;
    const ts = new Date(event.eventTime || event.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;

    if (ts >= currentWin.start && ts < currentWin.end) {
      const idx = Math.min(6, Math.floor((ts - currentWin.start) / DAY_MS));
      rows[idx].currentIncidents += 1;
      rows[idx].currentPoints += weight;
    } else if (ts >= previousWin.start && ts < previousWin.end) {
      const idx = Math.min(6, Math.floor((ts - previousWin.start) / DAY_MS));
      rows[idx].previousIncidents += 1;
      rows[idx].previousPoints += weight;
    }
  }

  return {
    rows,
    currentIncidents: rows.reduce((sum, row) => sum + row.currentIncidents, 0),
    previousIncidents: rows.reduce((sum, row) => sum + row.previousIncidents, 0),
    currentPoints: rows.reduce((sum, row) => sum + row.currentPoints, 0),
    previousPoints: rows.reduce((sum, row) => sum + row.previousPoints, 0),
  };
}

function scopedSafetyExposureFromEvents(
  events: LogEntry[],
  driverDistance: DriverDistanceSummary | null,
  scoreConfig: FleetScoreConfig,
): FleetSafetyExposure {
  const byLabel: Record<string, number> = {};
  const assetKeys = new Set<string>();
  const driverKeys = new Set<string>();
  let panicCount = 0;

  for (const event of events) {
    if (event.type === 'panic') {
      panicCount += 1;
      continue;
    }

    const label = (event.label || '').trim();
    if (!label || eventWeight(label, scoreConfig) <= 0) continue;

    byLabel[label] = (byLabel[label] || 0) + 1;
    if (event.assetId) assetKeys.add(String(event.assetId));
    else if (event.regNo) assetKeys.add(event.regNo);
    if (isKnownDriver(event.driverName)) driverKeys.add(event.driverId || event.driverName!);
  }

  const incidentTotal = Object.values(byLabel).reduce((sum, count) => sum + count, 0);
  return {
    distanceKm: driverDistance?.totalDistanceKm ?? 0,
    hosHeldMinutes: 0,
    incidentTotal,
    scoringCount: incidentTotal,
    byLabel,
    panicCount,
    assetCount: assetKeys.size,
    driverCount: driverKeys.size,
    start: driverDistance?.start,
    end: driverDistance?.end,
  };
}

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
    ? 'Close to zero harm per 100 km'
    : score >= config.bandAttention
    ? 'Elevated harm per 100 km — coaching recommended'
    : score >= config.bandBelow
    ? 'High harm per 100 km — priority driver and HOS review'
    : 'Far from zero harm per 100 km — immediate intervention advised';

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
              stroke={busy ? 'var(--cd-border)' : color} strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - (busy ? 0 : score) / 100)}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.8s ease' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: busy ? 'var(--cd-text-muted)' : color, fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>
              {busy ? <SkelValue /> : score}
            </span>
            {!busy && <span style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontWeight: 600 }}>/100</span>}
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
              { value: weightedRate.toFixed(2), label: 'pts / 100 km', title: undefined },
              { value: activeHosSlices, label: 'HOS slices', title: undefined },
              { value: SCORE_DROP_PER_HARM_UNIT, label: 'pts lost / unit', title: undefined },
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
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8,
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
                {w.label === 'HOS' ? w.weight : `+${w.weight}`}
              </div>
              <div style={{ fontSize: 9, color: 'var(--cd-text-muted)', marginTop: 2, lineHeight: 1.3 }}>{w.label}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#0078D4', marginTop: 10, fontWeight: 600 }}>
          Click for a 10-second explainer
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
function WorstPerformers({ events, loading }: { events: LogEntry[]; loading: boolean }) {
  const { scoreConfig } = useFleet();
  const rows = useMemo<{
    name: string; incidents: number; riskScore: number; types: Record<string, number>; lastEvent: string;
  }[]>(() => {
    const byDriver = new Map<string, { name: string; incidents: number; riskScore: number; types: Record<string, number>; lastEvent: string }>();

    for (const event of events) {
      if (event.type === 'panic' || !isKnownDriver(event.driverName)) continue;
      const label = (event.label || '').trim();
      const weight = eventWeight(label, scoreConfig);
      if (!label || weight <= 0) continue;

      const key = event.driverId || event.driverName!;
      const row = byDriver.get(key) || {
        name: event.driverName!,
        incidents: 0,
        riskScore: 0,
        types: {},
        lastEvent: '',
      };
      row.incidents += 1;
      row.riskScore += weight;
      row.types[label] = (row.types[label] || 0) + 1;
      const eventTime = event.eventTime || event.timestamp || '';
      if (!row.lastEvent || new Date(eventTime).getTime() > new Date(row.lastEvent).getTime()) {
        row.lastEvent = eventTime;
      }
      byDriver.set(key, row);
    }

    return Array.from(byDriver.values())
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);
  }, [events, scoreConfig]);

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

      {loading ? (
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
    <div className="bpl-card" style={{ padding: '20px 22px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)', marginBottom: 16 }}>
        Behaviour Profile
      </div>
      <ResponsiveContainer width="100%" height={200}>
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

// Events are only fetched for the last 14 days, so only these two weeks have real data.
const WEEK_OPTIONS = [0, 1];

function WeekSelect({ value, onChange }: { value: number; onChange: (offset: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        fontSize: 11, fontWeight: 600, color: 'var(--cd-text)',
        background: 'var(--cd-surface)', border: '1px solid var(--cd-border)',
        borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
      }}
    >
      {WEEK_OPTIONS.map(offset => (
        <option key={offset} value={offset}>{weekOptionLabel(offset)}</option>
      ))}
    </select>
  );
}

function WeeklySafetyTrend({ events, scoreConfig, loading }: { events: LogEntry[]; scoreConfig: FleetScoreConfig; loading: boolean }) {
  const [currentOffset, setCurrentOffset] = useState(0);
  const [previousOffset, setPreviousOffset] = useState(1);

  const trend = useMemo(
    () => weeklySafetyTrend(events, scoreConfig, currentOffset, previousOffset),
    [events, scoreConfig, currentOffset, previousOffset],
  );
  const currentLabel = weekOptionLabel(currentOffset);
  const previousLabel = weekOptionLabel(previousOffset);

  return (
    <div className="bpl-card" style={{ padding: '20px 22px', marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)', marginBottom: 2 }}>
            Weekly Safety Trend
          </div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <WeekSelect value={currentOffset} onChange={setCurrentOffset} />
            <span>vs</span>
            <WeekSelect value={previousOffset} onChange={setPreviousOffset} />
            <span>· weighted harm points</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{ minWidth: 112, textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0078D4', fontFamily: 'var(--cd-font-display)' }}>
              {loading ? <SkelValue /> : trend.currentPoints.toFixed(0)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>harm points total · {currentLabel.toLowerCase()}</div>
          </div>
          <div style={{ minWidth: 112, textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--cd-text-muted)', fontFamily: 'var(--cd-font-display)' }}>
              {loading ? <SkelValue /> : trend.previousPoints.toFixed(0)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>harm points total · {previousLabel.toLowerCase()}</div>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={trend.rows} margin={{ top: 4, right: 18, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--cd-border)" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--cd-surface)', border: '1px solid var(--cd-border)', borderRadius: 6, fontSize: 12 }}
            formatter={(value: number, name: string) => [`${Number(value).toFixed(0)} pts`, name === 'currentPoints' ? currentLabel : previousLabel]}
            labelFormatter={(label, payload) => {
              const row = payload?.[0]?.payload;
              return row?.previousDay ? `${label} vs ${row.previousDay}` : String(label);
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value) => value === 'currentPoints' ? currentLabel : previousLabel} />
          <Line type="monotone" dataKey="currentPoints" stroke="#0078D4" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="previousPoints" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
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
    events,
    driverDistance,
    scoreConfig,
    safetyScore,
    safetyDelta,
    safetyExposure,
    safetyExposureLoading,
    eventsLoading,
    distanceLoading,
    selectedSites,
  } = useFleet();
  const [explainerOpen, setExplainerOpen] = useState(false);

  const siteFiltered = selectedSites.length > 0;
  const scopedExposure = useMemo(
    () => scopedSafetyExposureFromEvents(events, driverDistance, scoreConfig),
    [driverDistance, events, scoreConfig],
  );
  const pageExposure = siteFiltered ? scopedExposure : safetyExposure;
  const totalIncidents = pageExposure?.incidentTotal ?? 0;
  const distanceKm = pageExposure?.distanceKm ?? 0;
  const hosHeldMinutes = pageExposure?.hosHeldMinutes ?? 0;
  const points = totalSafetyPointsFromCensus(pageExposure ?? { distanceKm: 0, hosHeldMinutes: 0 }, scoreConfig);
  const weightedRate = ratePer100Km(points.total, distanceKm);
  const pageBusy = siteFiltered ? (eventsLoading || distanceLoading) : safetyExposureLoading;
  const scoreBusy = safetyExposureLoading;

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Safety <MockNamesBadge /></h1>
        <p className="bpl-page-subtitle">Fleet health from harm per 100 km · driver discipline is a separate score · {clientName()}</p>
      </div>

      {/* KPI strip */}
      <KpiStrip vehicleCount={vehicles.length} exposure={pageExposure} busy={pageBusy} />

      {/* Score + Breakdown + Radar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 260px', gap: 14, marginBottom: 20 }}>
        <ScoreGauge
          score={safetyScore}
          delta={safetyDelta}
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

      <WeeklySafetyTrend events={events} scoreConfig={scoreConfig} loading={pageBusy} />

      {/* Worst performers */}
      <div style={{ marginBottom: 20 }}>
        <WorstPerformers events={events} loading={eventsLoading} />
      </div>

      {/* Priority actions */}
      <PriorityActions byLabel={pageExposure?.byLabel} score={safetyScore} vehicleCount={vehicles.length} />

      {explainerOpen && (
        <ConsequenceExplainerModal
          fleetScore={safetyScore}
          fleetDelta={safetyDelta}
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
