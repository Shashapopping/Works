import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider } from './context/AuthContext';

import { FleetProvider } from './context/FleetContext';

import AppShell from './components/layout/AppShell';

import RequireAuth from './components/RequireAuth';

import Login from './pages/Login';

import { FATIGUE_ENABLED } from './config/fatigue';

import Dashboard from './pages/Dashboard';
import FleetPage from './pages/FleetPage';
import DriverManagement from './pages/DriverManagement';
import CoachingPage from './pages/driver/CoachingPage';
import TrainingPage from './pages/driver/TrainingPage';
import CertificatesPage from './pages/driver/CertificatesPage';
import IncidentIntelligence from './pages/IncidentIntelligence';
import Safety from './pages/Safety';
import Tankers from './pages/Tankers';
import Quarry from './pages/Quarry';
import Cement from './pages/Cement';
import ReadyMix from './pages/ReadyMix';
import FuelMonitoring from './pages/FuelMonitoring';
import OperationalKpi from './pages/OperationalKpi';
import UtilizationPage from './pages/UtilizationPage';
import AuditPage from './pages/AuditPage';
import AssetsPage from './pages/AssetsPage';
import DispatchPage from './pages/DispatchPage';
import TripsPage from './pages/TripsPage';
import AiInsightsPage from './pages/AiInsightsPage';
import VisionPage from './pages/driver/VisionPage';
import FuelConsumption from './pages/FuelConsumption';
import ReportsPage from './pages/ReportsPage';
import ReportsAutomationPage from './pages/ReportsAutomationPage';
import Maintenance from './pages/Maintenance';
import Settings from './pages/Settings';
import FatigueManagementPage from './pages/driver/FatigueManagementPage';

function AuthenticatedApp() {
  return (
    <FleetProvider>
      <AppShell />
    </FleetProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<RequireAuth />}>
            <Route element={<AuthenticatedApp />}>
                <Route path="/" element={<Dashboard />} />

                <Route path="/fleet" element={<FleetPage />} />

                <Route path="/drivers" element={<DriverManagement />} />

                <Route path="/drivers/coaching" element={<CoachingPage />} />

                <Route path="/drivers/training" element={<TrainingPage />} />

                <Route path="/drivers/certifications" element={<CertificatesPage />} />

                <Route
                  path="/drivers/fatigue"
                  element={
                    FATIGUE_ENABLED
                      ? <FatigueManagementPage />
                      : <Navigate to="/drivers" replace />
                  }
                />

                <Route path="/drivers/vision" element={<VisionPage />} />

                <Route path="/drivers/*" element={<Navigate to="/drivers" replace />} />

                <Route
                  path="/consequence-management"
                  element={<Navigate to={{ pathname: '/settings/scoring', hash: 'consequence-bands' }} replace />}
                />

                <Route path="/incidents" element={<IncidentIntelligence tab="events" />} />

                <Route path="/incidents/response" element={<IncidentIntelligence tab="patterns" />} />

                <Route path="/incidents/audit" element={<AuditPage />} />

                <Route path="/safety" element={<Safety />} />

                <Route path="/quarry" element={<Quarry />} />

                <Route path="/quarry/kpi" element={<OperationalKpi />} />

                <Route path="/fuel" element={<Navigate to="/fuel/monitoring" replace />} />

                <Route path="/fuel/monitoring" element={<FuelMonitoring />} />

                <Route
                  path="/fuel/consumption"
                  element={<FuelConsumption />}
                />

                <Route path="/trips" element={<TripsPage />} />

                <Route path="/trips/dispatch" element={<DispatchPage />} />

                <Route path="/dispatch" element={<Navigate to="/trips/dispatch" replace />} />

                <Route path="/aria" element={<AiInsightsPage />} />

                <Route path="/reports" element={<ReportsPage />} />

                <Route path="/reports/automation" element={<ReportsAutomationPage />} />

                <Route path="/reports/*" element={<Navigate to="/reports" replace />} />

                <Route path="/assets" element={<AssetsPage />} />

                <Route path="/utilization" element={<UtilizationPage />} />

                <Route path="/tankers" element={<Tankers />} />

                <Route path="/cement" element={<Cement />} />

                <Route path="/ready-mix" element={<ReadyMix />} />

                <Route path="/maintenance" element={<Maintenance />} />

                <Route path="/settings" element={<Navigate to="/settings/general" replace />} />

                <Route path="/settings/general" element={<Settings tab="general" />} />

                <Route path="/settings/scoring" element={<Settings tab="thresholds" />} />

                <Route path="/settings/thresholds" element={<Navigate to="/settings/scoring" replace />} />

                <Route path="/settings/api" element={<Navigate to="/settings/dev" replace />} />

                <Route path="/settings/dev" element={<Settings tab="dev" />} />

                <Route path="/settings/roles" element={<Settings tab="roles" />} />

                <Route path="/settings/users" element={<Settings tab="users" />} />
            </Route>
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
