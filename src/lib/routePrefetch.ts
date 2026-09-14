/** Prefetch lazy route chunks on sidebar hover so navigation doesn't stall on the old page. */
export const ROUTE_CHUNK_LOADERS: Record<string, () => Promise<unknown>> = {
  '/': () => import('../pages/Dashboard'),
  '/fleet': () => import('../pages/FleetPage'),
  '/assets': () => import('../pages/AssetsPage'),
  '/drivers': () => import('../pages/DriverManagement'),
  '/drivers/coaching': () => import('../pages/driver/CoachingPage'),
  '/drivers/training': () => import('../pages/driver/TrainingPage'),
  '/drivers/certifications': () => import('../pages/driver/CertificatesPage'),
  '/drivers/fatigue': () => import('../pages/driver/FatigueManagementPage'),
  '/drivers/vision': () => import('../pages/driver/VisionPage'),
  '/incidents': () => import('../pages/IncidentIntelligence'),
  '/incidents/response': () => import('../pages/IncidentIntelligence'),
  '/incidents/audit': () => import('../pages/AuditPage'),
  '/utilization': () => import('../pages/UtilizationPage'),
  '/tankers': () => import('../pages/Tankers'),
  '/quarry': () => import('../pages/Quarry'),
  '/quarry/kpi': () => import('../pages/OperationalKpi'),
  '/cement': () => import('../pages/Cement'),
  '/ready-mix': () => import('../pages/ReadyMix'),
  '/safety': () => import('../pages/Safety'),
  '/maintenance': () => import('../pages/Maintenance'),
  '/fuel/monitoring': () => import('../pages/FuelMonitoring'),
  '/fuel/consumption': () => import('../pages/FuelConsumption'),
  '/reports': () => import('../pages/ReportsPage'),
  '/reports/automation': () => import('../pages/ReportsAutomationPage'),
  '/reports/documents': () => import('../pages/DocumentsPage'),
  '/trips': () => import('../pages/TripsPage'),
  '/trips/dispatch': () => import('../pages/DispatchPage'),
  '/aria': () => import('../pages/AiInsightsPage'),
  '/settings/general': () => import('../pages/Settings'),
  '/settings/scoring': () => import('../pages/Settings'),
  '/settings/dev': () => import('../pages/Settings'),
  '/settings/roles': () => import('../pages/Settings'),
  '/settings/users': () => import('../pages/Settings'),
};

const prefetchedChunks = new Set<string>();

export function prefetchRouteChunk(path: string) {
  const load = ROUTE_CHUNK_LOADERS[path];
  if (!load || prefetchedChunks.has(path)) return;
  prefetchedChunks.add(path);
  void load().catch(() => {
    prefetchedChunks.delete(path);
  });
}
