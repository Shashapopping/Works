import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { isFeatureLocked } from '../config/lockedFeatures';

interface Props {
  featureId?: string;
  children: ReactNode;
}

export default function FeatureGate({ featureId, children }: Props) {
  if (!isFeatureLocked(featureId)) {
    return <>{children}</>;
  }

  return (
    <div className="bpl-feature-locked">
      <div className="bpl-feature-locked-content bpl-feature-locked-placeholder" aria-hidden="true" />
      <div className="bpl-feature-locked-overlay">
        <div className="bpl-feature-locked-card">
          <div className="bpl-feature-locked-icon">
            <Lock size={22} />
          </div>
          <div className="bpl-feature-locked-title">Not available</div>
          <p className="bpl-feature-locked-message">
            This feature is not available for your organization.
          </p>
          <p className="bpl-feature-locked-hint">
            Contact Best Practices Ltd to unlock this module for your fleet.
          </p>
        </div>
      </div>
    </div>
  );
}
