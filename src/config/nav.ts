import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Users, User, GraduationCap, BadgeCheck, Moon, Camera,
  AlertTriangle, Search, ListChecks, ClipboardList, Truck, Mountain, Gauge, Package,
  Droplets, Shield, Wrench, Fuel, BarChart3, FileBarChart2, Bot, Route, Navigation,
  Brain, Boxes, Map, Award,
} from 'lucide-react';
import { FATIGUE_ENABLED } from './fatigue';

export interface NavSubItem {
  path: string;
  label: string;
  icon: LucideIcon;
  locked?: boolean;
}

export interface NavGroup {
  path: string;
  icon: LucideIcon;
  label: string;
  children?: NavSubItem[];
  pinned?: boolean;
  locked?: boolean;
  accent?: string;
}

/** Sidebar structure — single source of truth (Chevron-style). */
export const SIDEBAR_NAV: NavGroup[] = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/fleet', icon: Map, label: 'Fleet' },
  { path: '/assets', icon: Boxes, label: 'Assets' },
  {
    path: '/drivers',
    icon: Users,
    label: 'Driver Management',
    children: [
      { path: '/drivers', label: 'Drivers', icon: User },
      { path: '/drivers/coaching', label: 'Coaching', icon: GraduationCap },
      { path: '/drivers/training', label: 'Training', icon: Award },
      { path: '/drivers/certifications', label: 'Certificates', icon: BadgeCheck },
      ...(FATIGUE_ENABLED
        ? [{ path: '/drivers/fatigue', label: 'Fatigue Management', icon: Moon }]
        : []),
      { path: '/drivers/vision', label: 'Vision', icon: Camera, locked: true },
    ],
  },
  {
    path: '/incidents',
    icon: AlertTriangle,
    label: 'Incident Intelligence',
    children: [
      { path: '/incidents', label: 'Event Explorer', icon: Search },
      { path: '/incidents/response', label: 'Response Tracking', icon: ListChecks },
      { path: '/incidents/audit', label: 'Audit', icon: ClipboardList },
    ],
  },
  { path: '/utilization', icon: Gauge, label: 'Utilization' },
  { path: '/tankers', icon: Truck, label: 'Bulk Tankers', accent: '#f59e0b' },
  {
    path: '/quarry',
    icon: Mountain,
    label: 'Quarry',
    accent: '#84cc16',
    children: [
      { path: '/quarry', label: 'Overview', icon: Mountain },
      { path: '/quarry/kpi', label: 'Utilization & KPIs', icon: Gauge },
    ],
  },
  { path: '/cement', icon: Package, label: 'Cement', accent: '#94a3b8' },
  { path: '/ready-mix', icon: Droplets, label: 'Ready Mix', accent: '#22d3ee' },
  { path: '/safety', icon: Shield, label: 'Safety' },
  { path: '/maintenance', icon: Wrench, label: 'Maintenance' },
  {
    path: '/fuel',
    icon: Fuel,
    label: 'Fuel',
    children: [
      { path: '/fuel/monitoring', label: 'Monitoring', icon: Fuel },
      { path: '/fuel/consumption', label: 'Consumption', icon: BarChart3, locked: true },
    ],
  },
  {
    path: '/reports',
    icon: FileBarChart2,
    label: 'Reports',
    children: [
      { path: '/reports', label: 'Reports', icon: FileBarChart2 },
      { path: '/reports/automation', label: 'Automation', icon: Bot },
    ],
  },
  {
    path: '/trips',
    icon: Route,
    label: 'Journey Management',
    locked: true,
    children: [
      { path: '/trips', label: 'Journeys', icon: Route, locked: true },
      { path: '/trips/dispatch', label: 'Dispatch', icon: Navigation, locked: true },
    ],
  },
  { path: '/aria', icon: Brain, label: 'AI Insights', locked: true },
];

/** Warm page APIs on hover (Chevron-style). */
function bucketedNowIso(bucketMs = 5 * 60_000) {
  const t = Math.ceil(Date.now() / bucketMs) * bucketMs;
  return new Date(t).toISOString();
}

function warmTrendsUrl(days: number) {
  const to = bucketedNowIso();
  const from = new Date(new Date(to).getTime() - days * 86400000).toISOString();
  return `/api/events/trends?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

export const ROUTE_WARM_URLS: Record<string, readonly string[]> = {
  '/': [
    '/api/driver-distance?range=7d&trips=0&summary=1',
    '/api/fuel/consumption?period=week&trips=0&summary=1',
  ],
  '/fleet': [
    '/api/driver-distance?range=today&trips=0&summary=1',
    '/api/hos',
  ],
  '/drivers': [
    '/api/risk/drivers?range=7d',
    '/api/driver-distance?range=7d&trips=0',
    '/api/driver-distance?range=30d&trips=0',
  ],
  '/drivers/fatigue': ['/api/hos'],
  '/drivers/certifications': ['/api/risk/drivers?range=30d'],
  '/incidents': [
    '/api/safety/summary?range=7d',
    '/api/risk/drivers?range=7d',
    warmTrendsUrl(7),
    '/api/events/log?format=page&limit=50',
  ],
  '/incidents/response': [
    '/api/risk/drivers?range=7d',
    '/api/risk/drivers?range=30d',
    '/api/driver-distance?range=7d&trips=0',
    '/api/driver-distance?range=30d&trips=0',
  ],
  '/incidents/audit': [],
  '/assets': [
    '/api/risk/drivers?range=7d&groupBy=asset',
  ],
  '/tankers': [
    '/api/driver-distance?range=today&trips=0',
    '/api/fuel/consumption?period=day&trips=0',
    '/api/safety/summary?range=30d',
  ],
  '/quarry': [
    '/api/driver-distance?range=today&trips=0',
    '/api/fuel/consumption?period=day&trips=0',
    '/api/safety/summary?range=30d',
    '/api/safety/summary?range=prev30d',
  ],
  '/cement': [
    '/api/driver-distance?range=today&trips=0',
    '/api/safety/summary?range=30d',
    '/api/safety/summary?range=prev30d',
  ],
  '/ready-mix': [
    '/api/trips/session',
    '/api/driver-distance?range=today&trips=0',
    '/api/safety/summary?range=30d',
  ],
  '/drivers/coaching': [
    '/api/risk/drivers?range=30d',
    '/api/driver-distance?range=30d&trips=0',
    '/api/driver-distance?range=prev30d&trips=0',
  ],
  '/drivers/training': [
    '/api/risk/drivers?range=30d',
    '/api/driver-distance?range=30d&trips=0',
    '/api/driver-distance?range=prev30d&trips=0',
  ],
  '/maintenance': [],
  '/settings/general': [
    '/api/roles',
    '/api/users',
  ],
  '/utilization': ['/api/utilization?period=week&scope=all'],
  '/safety': [
    '/api/safety/summary?range=30d',
    '/api/safety/summary?range=prev30d',
    '/api/risk/drivers?range=30d',
  ],
  '/fuel/monitoring': ['/api/fuel/consumption?period=week&trips=0'],
  '/fuel/consumption': ['/api/fuel/consumption?period=week&trips=0'],
  '/reports': ['/api/utilization?period=week&scope=all'],
  '/quarry/kpi': ['/api/utilization?period=week&scope=quarry'],
};

export function getParentPath(pathname: string): string | null {
  for (const group of SIDEBAR_NAV) {
    if (group.path === pathname) return group.path;
    if (group.children?.some(c => c.path === pathname)) return group.path;
    if (pathname.startsWith(`${group.path}/`) && group.children?.length) return group.path;
  }
  return null;
}
