import { Link } from 'react-router-dom';
import { useFleet } from '../../context/FleetContext';
import { isOverspeedLabel } from '../../lib/overspeedFilter';

const SEV_COLOR = { critical: '#CC0000', warning: '#d97706', info: 'var(--bpl-blue)' };

function overspeedKph(speed?: number | null) {
  if (speed == null || !Number.isFinite(Number(speed))) return null;
  return Math.round(Number(speed));
}

export default function AlertsWidget() {
  const { alerts } = useFleet();

  return (
    <div className="bpl-card bpl-home-panel-card bpl-home-alerts-panel">
      <div className="bpl-card-header">
        <span className="bpl-card-title">Recent Incident Alert</span>
        <Link to="/incidents" className="bpl-card-link">See all</Link>
      </div>
      <div className="bpl-card-body bpl-home-panel-scroll bpl-incident-list">
        {alerts.length === 0 ? (
          <div style={{ padding: '12px 0', color: 'var(--cd-text-muted)', fontSize: 13 }}>No recent incident alerts</div>
        ) : alerts.map(a => {
          const speed = isOverspeedLabel(a.label) ? overspeedKph(a.speed) : null;
          const to = a.id ? `/incidents?event=${encodeURIComponent(a.id)}` : '/incidents';
          const meta = [
            a.driver && a.driver !== 'Unassigned' && a.driver !== '—' ? a.driver : null,
          ].filter(Boolean).join(' · ');
          return (
            <Link
              key={a.id}
              to={to}
              className="bpl-incident-card"
              style={{ '--incident-accent': SEV_COLOR[a.severity] } as React.CSSProperties}
            >
              <div className="bpl-incident-card-body">
                <div className="bpl-incident-card-top">
                  <span className="bpl-incident-type">{a.label}</span>
                  <span className="bpl-incident-time">{a.time}</span>
                </div>
                <div className="bpl-incident-title">{a.vehicle}</div>
                {meta && <div className="bpl-incident-meta">{meta}</div>}
              </div>
              {speed != null && (
                <div className="bpl-incident-speed">
                  <span className="bpl-incident-speed-value">{speed}</span>
                  <span className="bpl-incident-speed-unit">km/h</span>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
