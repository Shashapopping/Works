import { ShieldAlert, X, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { SafetyNotification, Severity } from '../hooks/useSafeIQ';
import EnvironmentBadge from './EnvironmentBadge';
import { displayDriverName } from '../lib/driverUtils';
import { brandLabel } from '../lib/branding';

// ─── keyword highlight ────────────────────────────────────────────────────────
const DANGER_PATTERN = /\b(harsh braking|harsh acceleration|overspeeding|overspeed tiered|overspeed|cornering|panic alert|panic|tailgating|following distance|speeding|collision|near.miss|critical|immediate action|intervention required)\b/gi;
const IMPORTANT_PATTERN = /\b(rain|wet|fog|visibility|slippery|heavy traffic|congestion|peak hour|FMCSA|FRSC|ISO 39001|BASIC|threshold|recurring|pattern|behaviour|behavior|trend|escalat)\b/gi;

function HighlightedText({ text }: { text: string }) {
  const combined = new RegExp(
    `(?<danger>${DANGER_PATTERN.source})|(?<important>${IMPORTANT_PATTERN.source})`,
    'gi'
  );

  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = combined.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const isDanger = match.groups?.danger !== undefined;
    parts.push(
      <mark key={match.index} style={{
        fontWeight: 700,
        color: isDanger ? 'var(--cd-danger)' : 'inherit',
        background: isDanger ? 'var(--cd-danger-bg)' : 'transparent',
        borderRadius: isDanger ? 3 : 0,
        padding: isDanger ? '0 2px' : 0,
        fontStyle: 'inherit',
        textDecoration: 'none',
      }}>
        {match[0]}
      </mark>
    );
    last = match.index + match[0].length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

interface Props {
  notification: SafetyNotification;
  onClose: () => void;
}

function severityBannerStyle(s: Severity): React.CSSProperties {
  if (s === 'RED') return { background: 'var(--cd-danger-bg)', borderBottom: '1px solid var(--cd-danger-border)' };
  if (s === 'YELLOW') return { background: 'var(--cd-status-idle-bg)', borderBottom: '1px solid var(--cd-status-idle-border)' };
  return { background: 'var(--cd-status-moving-bg)', borderBottom: '1px solid var(--cd-status-moving-border)' };
}

function severityBadgeStyle(s: Severity): React.CSSProperties {
  if (s === 'RED') return { background: 'var(--cd-danger-bg)', color: 'var(--cd-danger)', border: '1px solid var(--cd-danger-border)' };
  if (s === 'YELLOW') return { background: 'var(--cd-status-idle-bg)', color: 'var(--cd-status-idle-text)', border: '1px solid var(--cd-status-idle-border)' };
  return { background: 'var(--cd-status-moving-bg)', color: 'var(--cd-status-moving-text)', border: '1px solid var(--cd-status-moving-border)' };
}

function severityEmoji(s: Severity) {
  if (s === 'RED') return '🔴';
  if (s === 'YELLOW') return '🟡';
  return '🟢';
}

function severityText(s: Severity) {
  if (s === 'RED') return 'RED ALERT';
  if (s === 'YELLOW') return 'CAUTION';
  return 'IMPROVING';
}

function scoreBarColor(score: number) {
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#d97706';
  return '#dc2626';
}

function trendArrow(trend: string) {
  if (trend === 'improving') return '↑';
  if (trend === 'declining') return '↓';
  return '→';
}

function trendColor(trend: string) {
  if (trend === 'improving') return '#16a34a';
  if (trend === 'declining') return '#dc2626';
  return '#d97706';
}

function incidentLabel(type: string) {
  if (type === 'harsh_braking') return 'Harsh Braking';
  if (type === 'harsh_acceleration') return 'Harsh Acceleration';
  if (type === 'speeding') return 'Speeding';
  if (type === 'excessive_idling') return 'Excessive Idling';
  return type;
}

function formatTimestamp(ts: string) {
  try {
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return ts;
  }
}


function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--cd-text-muted)', marginBottom: '6px' }}>
      {children}
    </div>
  );
}

function SectionCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--cd-surface-2, #f8fafc)', border: '1px solid var(--cd-border)', borderRadius: '10px', padding: '14px', ...style }}>
      {children}
    </div>
  );
}

export default function SafetyIncidentModal({ notification: n, onClose }: Props) {
  const analysis = n.analysis;
  const severity = analysis?.severity ?? 'GREEN';
  const navigate = useNavigate();

  const goToDriver = () => {
    onClose();
    navigate(`/drivers?q=${encodeURIComponent(displayDriverName(n.driver.name))}`);
  };

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 3000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--cd-surface)',
    border: '1px solid var(--cd-border)',
    borderRadius: '20px',
    width: '100%',
    maxWidth: '620px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: 'var(--cd-card-shadow)',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ShieldAlert size={20} style={{ color: 'var(--cd-accent)' }} />
            <span style={{ fontWeight: '700', color: 'var(--cd-accent)', fontSize: '15px' }}>SafeIQ</span>
            <span style={{ color: 'var(--cd-text-muted)', fontSize: '15px' }}>Safety Analysis</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cd-text-muted)', padding: '4px', display: 'flex', alignItems: 'center' }}>
            <X size={20} />
          </button>
        </div>

        {/* Severity banner */}
        {analysis && (
          <div style={{ ...severityBannerStyle(severity), padding: '14px 24px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <span style={{ ...severityBadgeStyle(severity), fontSize: '12px', fontWeight: '700', padding: '4px 10px', borderRadius: '9999px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {severityEmoji(severity)} {severityText(severity)}
              </span>
              <span style={{ fontSize: '13px', color: 'var(--cd-text)', lineHeight: '1.5' }}>
                <HighlightedText text={analysis.severity_reason} />
              </span>
            </div>
          </div>
        )}

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>

          {/* Section 1 — Incident Details */}
          <div>
            <SectionLabel>Incident Details</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <SectionCard>
                <div style={{ fontSize: '10px', color: 'var(--cd-text-muted)', marginBottom: '3px', fontWeight: '600' }}>TYPE</div>
                <div style={{ fontSize: '13px', color: 'var(--cd-text)', fontWeight: '600' }}>{incidentLabel(n.type)}</div>
                <div style={{ fontSize: '12px', color: 'var(--cd-accent)', fontWeight: '700', marginTop: '4px' }}>{n.magnitude}</div>
              </SectionCard>
              <SectionCard>
                <div style={{ fontSize: '10px', color: 'var(--cd-text-muted)', marginBottom: '3px', fontWeight: '600' }}>TIME</div>
                <div style={{ fontSize: '13px', color: 'var(--cd-text)', fontWeight: '500' }}>{formatTimestamp(n.timestamp)}</div>
              </SectionCard>
              {n.location && (
                <SectionCard>
                  <div style={{ fontSize: '10px', color: 'var(--cd-text-muted)', marginBottom: '3px', fontWeight: '600' }}>LOCATION</div>
                  <div style={{ fontSize: '13px', color: 'var(--cd-text)', fontWeight: '500' }}>{n.location}</div>
                </SectionCard>
              )}
            </div>
          </div>

          {/* Section 2 — Environment */}
          <div>
            <SectionLabel>Environmental Conditions</SectionLabel>
            <EnvironmentBadge environment={n.environment} />
          </div>

          {/* Section 3 — Driver & Vehicle */}
          <div>
            <SectionLabel>Driver &amp; Vehicle</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <SectionCard>
                <button
                  onClick={goToDriver}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    display: 'flex', alignItems: 'center', gap: 6, marginBottom: '6px',
                  }}
                >
                  <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--cd-accent)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                    {displayDriverName(n.driver.name)}
                  </span>
                  <ExternalLink size={11} color="var(--cd-accent)" />
                </button>
                <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)', marginBottom: '10px' }}>{n.driver.id}</div>

                <div style={{ fontSize: '10px', color: 'var(--cd-text-muted)', marginBottom: '4px', fontWeight: '600' }}>SAFETY SCORE</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ flex: 1, height: '6px', background: 'var(--cd-border)', borderRadius: '99px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${n.driver.safety_score_baseline}%`, background: scoreBarColor(n.driver.safety_score_baseline), borderRadius: '99px' }} />
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: scoreBarColor(n.driver.safety_score_baseline) }}>{n.driver.safety_score_baseline}</span>
                </div>

                <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)', marginBottom: '4px' }}>
                  <span style={{ fontWeight: '600' }}>Incidents (7 days):</span> {n.driver.incidents_last_30_days}
                </div>
                <div style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ color: 'var(--cd-text-muted)', fontWeight: '600' }}>Trend:</span>
                  <span style={{ color: trendColor(n.driver.improvement_trend), fontWeight: '700', fontSize: '15px' }}>{trendArrow(n.driver.improvement_trend)}</span>
                  <span style={{ color: trendColor(n.driver.improvement_trend), fontWeight: '600', fontSize: '11px' }}>{n.driver.improvement_trend}</span>
                </div>
              </SectionCard>

              <SectionCard>
                <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--cd-text)', marginBottom: '4px' }}>{n.vehicle.id}</div>
                {(n.vehicle.make || n.vehicle.model) && (
                  <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)' }}>
                    {[n.vehicle.make, n.vehicle.model].filter(Boolean).join(' · ')}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          {/* Section 4 — SafeIQ Analysis */}
          {analysis && (
            <div>
              <SectionLabel>SafeIQ Analysis</SectionLabel>
              <SectionCard>
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--cd-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: '6px' }}>Root Cause</div>
                  <div style={{ fontSize: '13px', color: 'var(--cd-text)', lineHeight: '1.6' }}><HighlightedText text={analysis.root_cause} /></div>
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--cd-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: '6px' }}>Industry Reference</div>
                  <div style={{ fontSize: '12px', color: 'var(--cd-text-muted)', lineHeight: '1.6', fontStyle: 'italic' }}><HighlightedText text={analysis.industry_reference} /></div>
                  {analysis.industry_citations && analysis.industry_citations.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {analysis.industry_citations.map(c => (
                        <a
                          key={c.url}
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={c.note}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 10,
                            fontWeight: 600,
                            fontStyle: 'normal',
                            color: 'var(--cd-text)',
                            background: 'var(--cd-surface-2, var(--cd-border))',
                            border: '1px solid var(--cd-border)',
                            borderRadius: 6,
                            padding: '3px 8px',
                            textDecoration: 'none',
                            maxWidth: '100%',
                          }}
                        >
                          <ExternalLink size={10} style={{ flexShrink: 0, opacity: 0.7 }} />
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--cd-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: '6px' }}>Coaching Recommendation</div>
                  <div style={{ fontSize: '13px', color: 'var(--cd-text)', lineHeight: '1.6' }}><HighlightedText text={analysis.coaching_recommendation} /></div>
                </div>
              </SectionCard>
            </div>
          )}

          {/* Section 5 — Ops Flag */}
          {analysis?.ops_flag && (
            <div style={{ background: 'var(--cd-danger-bg)', border: '1px solid var(--cd-danger-border)', borderRadius: '10px', padding: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '16px' }}>⚠️</span>
                <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--cd-danger)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Operations Flag</span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--cd-text)', lineHeight: '1.6' }}><HighlightedText text={analysis.ops_flag_reason} /></div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
