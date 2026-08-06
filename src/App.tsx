import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { FleetProvider } from './context/FleetContext';
import AppShell from './components/layout/AppShell';
import RequireAuth from './components/RequireAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import FleetPage from './pages/FleetPage';
import DispatchPage from './pages/DispatchPage';
import TripsPage from './pages/TripsPage';
import AiInsightsPage from './pages/AiInsightsPage';
import ReportsPage from './pages/ReportsPage';
import DocumentsPage from './pages/DocumentsPage';
import DriverManagement from './pages/DriverManagement';
import IncidentIntelligence from './pages/IncidentIntelligence';
import Safety from './pages/Safety';
import Settings from './pages/Settings';
import Maintenance from './pages/Maintenance';
import Tankers from './pages/Tankers';
import Quarry from './pages/Quarry';
import Cement from './pages/Cement';
import ReadyMix from './pages/ReadyMix';
import FuelMonitoring from './pages/FuelMonitoring';
import FuelConsumption from './pages/FuelConsumption';
import OperationalKpi from './pages/OperationalKpi';

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
                <Route path="/drivers/*" element={<Navigate to="/drivers" replace />} />

                <Route path="/incidents" element={<IncidentIntelligence tab="events" />} />
                <Route path="/incidents/trends" element={<IncidentIntelligence tab="trends" />} />
                <Route path="/incidents/analysis" element={<Navigate to="/incidents/trends" replace />} />
                <Route path="/incidents/response" element={<IncidentIntelligence tab="patterns" />} />

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
