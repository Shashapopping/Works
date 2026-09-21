import { ShieldAlert, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { SafetyNotification } from '../hooks/useSafeIQ';
import { formatEnvironmentLine } from './EnvironmentBadge';
import { isKnownDriver, displayDriverName } from '../lib/driverUtils';

function severityColor(s: string) {
  if (s === 'RED') return '#dc2626';
  if (s === 'YELLOW') return '#d97706';
  return '#16a34a';
}

function timeAgo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface Props {
  notifications: SafetyNotification[];
  onOpen: (n: SafetyNotification) => void;
  onDismiss?: (id: string) => void;
  showDismiss?: boolean;
  emptyHint?: string | null;
}

export default function SafeIQFeed({ notifications, onOpen, onDismiss, showDismiss = true, emptyHint }: Props) {
  const visible = notifications.filter(n => isKnownDriver(n.driver.name));

  if (visible.length === 0) {
    return (
      <div className="bpl-card bpl-safeiq-feed-empty">
        <ShieldAlert size={36} color="var(--cd-border)" />
        <div className="bpl-safeiq-feed-empty-title">No SafeIQ analyses yet</div>
        <div className="bpl-safeiq-feed-empty-sub">
          {emptyHint || 'Analyses appear when drivers cross incident thresholds'}
        </div>
      </div>
    );
  }

  return (
    <div className="bpl-safeiq-feed">
      {visible.map(n => {
        const severity = n.analysis?.severity ?? 'GREEN';
        const accent = severityColor(severity);
        const trend = n.driver.improvement_trend;

        return (
          <div
            key={n.id}
            className="bpl-card bpl-safeiq-feed-card"
            style={{ borderLeftColor: accent }}
            onClick={() => onOpen(n)}
          >
            <div className="bpl-safeiq-feed-card-head">
              <div className="bpl-safeiq-feed-card-ident">
                <ShieldAlert size={16} style={{ color: accent }} />
                <div>
                  <div className="bpl-safeiq-feed-driver">{displayDriverName(n.driver.name)}</div>
                  <div className="bpl-safeiq-feed-meta">
                    {n.vehicle.id} · {timeAgo(n.timestamp)}
                  </div>
                </div>
              </div>
              <div className="bpl-safeiq-feed-card-actions">
                {severity !== 'GREEN' && (
                  <span className="bpl-safeiq-feed-severity" style={{ color: accent, borderColor: `${accent}40`, background: severity === 'RED' ? '#fef2f2' : '#fffbeb' }}>
                    {severity}
                  </span>
                )}
                {showDismiss && onDismiss && (
                  <button
                    type="button"
                    className="bpl-safeiq-feed-dismiss"
                    onClick={e => { e.stopPropagation(); onDismiss(n.id); }}
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div className="bpl-safeiq-feed-env">{formatEnvironmentLine(n.environment)}</div>

            <div className="bpl-safeiq-feed-stats">
              <div>
                <div className="bpl-safeiq-feed-stat-label">Event</div>
                <div className="bpl-safeiq-feed-stat-value">{n.magnitude}</div>
              </div>
              <div>
                <div className="bpl-safeiq-feed-stat-label">Events / 7d</div>
                <div className="bpl-safeiq-feed-stat-value" style={{ color: accent }}>{n.eventCount}</div>
              </div>
              <div>
                <div className="bpl-safeiq-feed-stat-label">Safety Score</div>
                <div className="bpl-safeiq-feed-stat-value" style={{ color: severityColor(n.driver.safety_score_baseline >= 80 ? 'GREEN' : n.driver.safety_score_baseline >= 60 ? 'YELLOW' : 'RED') }}>
                  {n.driver.safety_score_baseline}
                </div>
              </div>
              <div>
                <div className="bpl-safeiq-feed-stat-label">Trend</div>
                <div className="bpl-safeiq-feed-trend" style={{ color: trend === 'improving' ? '#16a34a' : trend === 'declining' ? '#CC0000' : '#d97706' }}>
                  {trend === 'improving' ? <TrendingUp size={12} /> : trend === 'declining' ? <TrendingDown size={12} /> : <Minus size={12} />}
                  {trend}
                </div>
              </div>
            </div>

            {n.analysis && (
              <div className="bpl-safeiq-feed-analysis">
                <div className="bpl-safeiq-feed-analysis-row">
                  <span className="bpl-safeiq-feed-analysis-label">Severity</span>
                  {n.analysis.severity_reason}
                </div>
                <div className="bpl-safeiq-feed-analysis-row bpl-safeiq-feed-analysis-muted">
                  <span className="bpl-safeiq-feed-analysis-label">Coaching</span>
                  {n.analysis.coaching_recommendation}
                </div>
                {n.analysis.ops_flag && (
                  <div className="bpl-safeiq-feed-ops-flag">
                    <strong>Ops Flag:</strong> {n.analysis.ops_flag_reason}
                  </div>
                )}
              </div>
            )}

            <div className="bpl-safeiq-feed-cta">Click for full analysis →</div>
          </div>
        );
      })}
    </div>
  );
}
