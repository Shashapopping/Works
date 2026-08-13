import { lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { FleetProvider } from './context/FleetContext';
import AppShell from './components/layout/AppShell';
import RequireAuth from './components/RequireAuth';
import Login from './pages/Login';
import { TRENDS_ENABLED } from './config/trends';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const FleetPage = lazy(() => import('./pages/FleetPage'));
const DispatchPage = lazy(() => import('./pages/DispatchPage'));
const TripsPage = lazy(() => import('./pages/TripsPage'));
const AiInsightsPage = lazy(() => import('./pages/AiInsightsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'));
const DriverManagement = lazy(() => import('./pages/DriverManagement'));
const CoachingPage = lazy(() => import('./pages/driver/CoachingPage'));
const TrainingPage = lazy(() => import('./pages/driver/TrainingPage'));
const CertificatesPage = lazy(() => import('./pages/driver/CertificatesPage'));
const FatigueManagementPage = lazy(() => import('./pages/driver/FatigueManagementPage'));
const VisionPage = lazy(() => import('./pages/driver/VisionPage'));
const IncidentIntelligence = lazy(() => import('./pages/IncidentIntelligence'));
const TrendsPage = TRENDS_ENABLED ? lazy(() => import('./pages/TrendsPage')) : null;
const Safety = lazy(() => import('./pages/Safety'));
const Settings = lazy(() => import('./pages/Settings'));
const Maintenance = lazy(() => import('./pages/Maintenance'));
const Tankers = lazy(() => import('./pages/Tankers'));
const Quarry = lazy(() => import('./pages/Quarry'));
const Cement = lazy(() => import('./pages/Cement'));
const ReadyMix = lazy(() => import('./pages/ReadyMix'));
const FuelMonitoring = lazy(() => import('./pages/FuelMonitoring'));
const FuelConsumption = lazy(() => import('./pages/FuelConsumption'));
const OperationalKpi = lazy(() => import('./pages/OperationalKpi'));

export default function App() {
  return (
    <AuthProvider>
      <FleetProvider>
        <HashRouter>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/fleet" element={<FleetPage />} />

                <Route path="/drivers" element={<DriverManagement />} />
                <Route path="/drivers/coaching" element={<CoachingPage />} />
                <Route path="/drivers/training" element={<TrainingPage />} />
                <Route path="/drivers/certifications" element={<CertificatesPage />} />
                <Route path="/drivers/fatigue" element={<FatigueManagementPage />} />
                <Route path="/drivers/vision" element={<VisionPage />} />
                <Route path="/drivers/*" element={<Navigate to="/drivers" replace />} />

                <Route path="/incidents" element={<IncidentIntelligence tab="events" />} />
                <Route
                  path="/incidents/trends"
                  element={<Navigate to={TRENDS_ENABLED ? '/trends' : '/incidents'} replace />}
                />
                <Route
                  path="/incidents/analysis"
                  element={<Navigate to={TRENDS_ENABLED ? '/trends' : '/incidents'} replace />}
                />
                <Route path="/incidents/response" element={<IncidentIntelligence tab="patterns" />} />
                <Route
                  path="/trends"
                  element={
                    TRENDS_ENABLED && TrendsPage
                      ? <TrendsPage />
                      : <Navigate to="/incidents" replace />
                  }
                />

                <Route path="/safety" element={<Safety />} />

                <Route path="/quarry" element={<Quarry />} />
                <Route path="/quarry/kpi" element={<OperationalKpi />} />
                <Route path="/kpi" element={<Navigate to="/quarry/kpi" replace />} />

                <Route path="/fuel" element={<Navigate to="/fuel/monitoring" replace />} />
                <Route path="/fuel/monitoring" element={<FuelMonitoring />} />
                <Route path="/fuel/consumption" element={<FuelConsumption />} />
                <Route path="/operations/fuel" element={<Navigate to="/fuel/monitoring" replace />} />
                <Route path="/operations/fuel/consumption" element={<Navigate to="/fuel/consumption" replace />} />

                <Route path="/trips" element={<TripsPage />} />
                <Route path="/trips/dispatch" element={<DispatchPage />} />
                <Route path="/dispatch" element={<Navigate to="/trips/dispatch" replace />} />
                <Route path="/aria" element={<AiInsightsPage />} />

                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/reports/documents" element={<DocumentsPage />} />
                <Route path="/reports/*" element={<Navigate to="/reports" replace />} />

                <Route path="/operations" element={<Navigate to="/trips" replace />} />
                <Route path="/operations/*" element={<Navigate to="/trips" replace />} />

                <Route path="/tankers" element={<Tankers />} />
                <Route path="/cement" element={<Cement />} />
                <Route path="/ready-mix" element={<ReadyMix />} />
                <Route path="/maintenance" element={<Maintenance />} />

                <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
                <Route path="/settings/general" element={<Settings tab="general" />} />
                <Route path="/settings/thresholds" element={<Settings tab="thresholds" />} />
                <Route path="/settings/api" element={<Navigate to="/settings/dev" replace />} />
                <Route path="/settings/dev" element={<Settings tab="dev" />} />
                <Route path="/settings/roles" element={<Settings tab="roles" />} />
                <Route path="/settings/users" element={<Settings tab="users" />} />
              </Route>
            </Route>
          </Routes>
        </HashRouter>
      </FleetProvider>
    </AuthProvider>
  );
}
