import { useEffect, useRef } from 'react';
import type { SafetyNotification, Severity } from '../hooks/useSafeIQ';
import { formatEnvironmentLine } from './EnvironmentBadge';
import { isKnownDriver, displayDriverName } from '../lib/driverUtils';
import { brandLabel } from '../lib/branding';

interface Props {
  notifications: SafetyNotification[];
  onDismiss: (id: string) => void;
  onOpen: (n: SafetyNotification) => void;
  onClearAll: () => void;
}

function severityColor(s: Severity) {
  if (s === 'RED') return '#dc2626';
  if (s === 'YELLOW') return '#d97706';
  return '#16a34a';
}

function severityPillStyle(s: Severity): React.CSSProperties {
  if (s === 'RED') return { background: '#fef2f2', color: '#dc2626' };
  if (s === 'YELLOW') return { background: '#fffbeb', color: '#d97706' };
  return { background: '#f0fdf4', color: '#16a34a' };
}

function severityLabel(s: Severity) {
  if (s === 'RED') return 'RED ALERT';
  if (s === 'YELLOW') return 'CAUTION';
  return 'IMPROVING';
}

function incidentLabel(type: string) {
  if (type === 'harsh_braking') return 'Harsh Braking';
  if (type === 'harsh_acceleration') return 'Harsh Acceleration';
  if (type === 'speeding') return 'Speeding';
  if (type === 'excessive_idling') return 'Excessive Idling';
  return type;
}

function timeAgo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

interface ToastCardProps {
  n: SafetyNotification;
  onDismiss: (id: string) => void;
  onOpen: (n: SafetyNotification) => void;
}

// Auto-dismiss durations: RED never auto-dismisses, YELLOW = 30s, GREEN = 20s
function autoDismissMs(s: Severity): number | null {
  if (s === 'RED') return null;
  if (s === 'YELLOW') return 30000;
  return 20000;
}

function ToastCard({ n, onDismiss, onOpen }: ToastCardProps) {
  const severity = n.analysis?.severity ?? 'GREEN';
  const duration = autoDismissMs(severity);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (duration !== null) {
      timerRef.current = setTimeout(() => onDismiss(n.id), duration);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  function handleOpen() {
    // Cancel auto-dismiss when the user opens the detail view
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onOpen(n);
  }

  const accentColor = severityColor(severity);

  const slideAnim = 'safeiq-slide-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards';
  const cardAnimation = severity === 'RED'
    ? `${slideAnim}, safeiq-red-pulse 2s ease-in-out 0.4s infinite`
    : slideAnim;

  const cardStyle: React.CSSProperties = {
    background: 'color-mix(in oklab, var(--cd-surface) 92%, transparent)',
    backdropFilter: 'var(--cd-glass-blur)',
    WebkitBackdropFilter: 'var(--cd-glass-blur)',
    border: '1px solid var(--cd-glass-border)',
    borderRadius: '14px',
    boxShadow: 'var(--cd-card-shadow)',
    borderLeft: `4px solid ${accentColor}`,
    animation: cardAnimation,
    cursor: 'pointer',
    overflow: 'hidden',
    position: 'relative',
  };

  const pillStyle: React.CSSProperties = {
    ...severityPillStyle(severity),
    fontSize: '9px',
    fontWeight: '700',
    padding: '2px 7px',
    borderRadius: '9999px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    flexShrink: 0,
  };

  const drainDuration = duration ? `${duration / 1000}s` : '0s';
  const drainBarStyle: React.CSSProperties = {
    height: '3px',
    width: '100%',
    background: accentColor,
    animation: duration ? `safeiq-drain ${drainDuration} linear forwards` : 'none',
    borderRadius: '0 0 14px 14px',
    opacity: 0.7,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={cardStyle} onClick={handleOpen}>
        {/* Top row */}
        <div style={{ padding: '14px 14px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={pillStyle}>{severityLabel(severity)}</span>
          <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--cd-text)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayDriverName(n.driver.name)}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onDismiss(n.id); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cd-text-muted)', padding: '2px', display: 'flex', alignItems: 'center', flexShrink: 0 }}
            aria-label="Dismiss"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Second row */}
        <div style={{ padding: '4px 14px 4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '10px', color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
            {incidentLabel(n.type)}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--cd-text-muted)' }}>·</span>
          <span style={{ fontSize: '10px', color: 'var(--cd-text-muted)' }}>{n.vehicle.id}</span>
          <span style={{ fontSize: '10px', color: 'var(--cd-text-muted)' }}>·</span>
          <span style={{ fontSize: '10px', color: accentColor, fontWeight: '600' }}>{n.magnitude}</span>
          {n.eventCount > 1 && (
            <>
              <span style={{ fontSize: '10px', color: 'var(--cd-text-muted)' }}>·</span>
              <span style={{ fontSize: '10px', color: accentColor, fontWeight: '700' }}>{n.eventCount} events / 7d</span>
            </>
          )}
        </div>

        {/* Third row — location */}
        {n.location && (
          <div style={{ padding: '0 14px 4px', fontSize: '12px', color: 'var(--cd-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {brandLabel(n.location)}
          </div>
        )}

        {/* Environment row */}
        {n.environment.weather !== 'Loading…' && (
          <div style={{ padding: '0 14px 6px', fontSize: '11px', color: 'var(--cd-text-muted)' }}>
            {formatEnvironmentLine(n.environment)}
          </div>
        )}

        {/* Fourth row — severity reason */}
        {n.analysis && (
          <div style={{ padding: '0 14px 10px', fontSize: '12px', color: 'var(--cd-text)', overflow: 'hidden', maxHeight: '2.8em', lineHeight: '1.4' }}>
            {n.analysis.severity_reason}
          </div>
        )}

        {/* Bottom row */}
        <div style={{ padding: '0 14px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--cd-text-muted)' }}>{timeAgo(n.timestamp)}</span>
          <span style={{ fontSize: '11px', color: 'var(--cd-accent)', fontWeight: '600', cursor: 'pointer' }} onClick={handleOpen}>View Analysis →</span>
        </div>
      </div>

      {/* Progress drain bar */}
      <div style={drainBarStyle} />
    </div>
  );
}

export default function SafetyToast({ notifications, onDismiss, onOpen, onClearAll }: Props) {
  const visible = notifications.filter(n => isKnownDriver(n.driver.name));
  if (visible.length === 0) return null;

  return (
    <div style={{ position: 'fixed', top: '66px', right: '24px', zIndex: 2000, display: 'flex', flexDirection: 'column', gap: '10px', width: '360px', maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
      {visible.length >= 2 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClearAll}
            style={{
              fontSize: 11, fontWeight: 600,
              color: 'rgba(255,255,255,0.55)',
              background: 'rgba(15,25,40,0.85)',
              border: '0.5px solid rgba(255,255,255,0.14)',
              borderRadius: 7, padding: '4px 12px',
              cursor: 'pointer', backdropFilter: 'blur(8px)',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(204,0,0,0.35)'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(15,25,40,0.85)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.55)'; }}
          >
            Clear all ({visible.length})
          </button>
        </div>
      )}
      {visible.map(n => (
        <ToastCard key={n.id} n={n} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
    </div>
  );
}
