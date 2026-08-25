import { Bot, Folder, MailCheck } from 'lucide-react';
import FeatureGate from '../components/FeatureGate';
import ReportAutomate from '../components/ReportAutomate';
import { DocumentsExplorer } from './DocumentsPage';

export default function ReportsAutomationPage() {
  return (
    <FeatureGate featureId="reports">
      <div>
        <div className="bpl-page-header bpl-page-header-row">
          <div>
            <h1 className="bpl-page-title">
              <Bot size={18} color="#0078D4" style={{ display: 'inline', marginRight: 8, verticalAlign: -3 }} />
              Report Automation
            </h1>
            <p className="bpl-page-subtitle">
              Schedule recurring fleet reports and review generated documents in one place
            </p>
          </div>
        </div>

        <div className="bpl-automation-page-grid">
          <section className="bpl-card bpl-automation-config-card">
            <div className="bpl-automation-card-head">
              <MailCheck size={16} />
              <div>
                <strong>Automation setup</strong>
                <span>Select a report, save its filters, then schedule delivery</span>
              </div>
            </div>
            <ReportAutomate
              embedded
              defaultOpen
              defaultFrequency="weekly"
            />
          </section>

          <section className="bpl-card bpl-automation-docs-card">
            <div className="bpl-automation-card-head">
              <Folder size={16} />
              <div>
                <strong>Documents</strong>
                <span>Reports generated or downloaded by the system</span>
              </div>
            </div>
            <DocumentsExplorer showHeader={false} />
          </section>
        </div>
      </div>
    </FeatureGate>
  );
}
