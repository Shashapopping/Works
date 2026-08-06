import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useFleet } from '../../context/FleetContext';
import { SAFEIQ_ENABLED } from '../../config/safeIq';

export default function AiInsightsWidget() {
  const { insights, notifications } = useFleet();

  return (
    <div className="bpl-card bpl-home-panel-card">
      <div className="bpl-card-header">
        <span className="bpl-card-title">AI Insights</span>
        <Link to="/aria" className="bpl-card-link">See all</Link>
      </div>
      <div className="bpl-card-body bpl-home-panel-scroll">
        {insights.map(ins => (
          <div key={ins.id} className="bpl-insight-item">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{ins.title}</div>
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', lineHeight: 1.5 }}>{ins.description}</div>
          </div>
        ))}
        {SAFEIQ_ENABLED && notifications.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginTop: 10 }}>
            {notifications.length} SafeIQ {notifications.length === 1 ? 'analysis' : 'analyses'} pending review
          </div>
        )}
        <Link to="/aria" className="bpl-btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} />
          View AI Insights
        </Link>
      </div>
    </div>
  );
}
