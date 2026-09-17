import { Brain, Sparkles } from 'lucide-react';
import FeatureGate from '../components/FeatureGate';
import SafeIQFeed from '../components/SafeIQFeed';
import { useFleet } from '../context/FleetContext';
import { selectedSiteScopeLabel } from '../lib/cementSiteTree';

export default function AiInsightsPage() {
  const {
    notifications,
    openNotification,
    dismissNotification,
    insights,
    selectedSites,
    siteOptions,
    siteNameOptions,
    siteFilterActive,
  } = useFleet();

  const siteScopeLabel = siteFilterActive
    ? selectedSiteScopeLabel(selectedSites, siteOptions, siteNameOptions, 'selected sites')
    : null;

  return (
    <FeatureGate featureId="aria">
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">AI Insights</h1>
        <p className="bpl-page-subtitle">
          SafeIQ incident analyses and fleet intelligence recommendations
          {siteScopeLabel ? ` · filtered for ${siteScopeLabel}` : ''}
        </p>
      </div>

      <div className="bpl-aria-page-grid">
        <section className="bpl-aria-page-section">
          <div className="bpl-aria-section-head">
            <div className="bpl-aria-section-title">
              <ShieldIcon />
              <span>SafeIQ Analyses</span>
            </div>
            <span className="bpl-aria-section-count">{notifications.length} active</span>
          </div>
          <SafeIQFeed
            notifications={notifications}
            onOpen={openNotification}
            onDismiss={dismissNotification}
            emptyHint={siteScopeLabel ? `No analyses for ${siteScopeLabel}` : null}
          />
        </section>

        <section className="bpl-aria-page-section">
          <div className="bpl-aria-section-head">
            <div className="bpl-aria-section-title">
              <Sparkles size={16} />
              <span>Fleet Insights</span>
            </div>
          </div>
          <div className="bpl-aria-insights-list">
            {insights.map(ins => (
              <div key={ins.id} className="bpl-card bpl-aria-insight-card">
                <div className="bpl-aria-insight-type">{ins.type}</div>
                <div className="bpl-aria-insight-title">{ins.title}</div>
                <p className="bpl-aria-insight-desc">{ins.description}</p>
              </div>
            ))}
          </div>
          <div className="bpl-card bpl-aria-chat-hint">
            <Brain size={18} color="var(--bpl-blue)" />
            <div>
              <div className="bpl-aria-chat-hint-title">ARIA Assistant</div>
              <p className="bpl-aria-chat-hint-text">
                Use the chat button bottom-right to ask questions about fleet status, drivers, and safety risks.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
    </FeatureGate>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
