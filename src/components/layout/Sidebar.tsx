import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, User, GraduationCap, Award, BadgeCheck,
  AlertTriangle, Search, ListChecks, TrendingUp,
  Shield, Wrench, FileBarChart2, Folder, BarChart3, Fuel,
  Truck, Map, Navigation, Route, Brain, Lock, Gauge,
  Mountain, Package, Droplets, Settings, ChevronDown, Sun, Moon, LogOut,
} from 'lucide-react';
import { useFleet } from '../../context/FleetContext';
import { useAuth } from '../../context/AuthContext';
import { permissionForPath, getAuthMode, getStoredToken, decodeJwtPayload } from '../../lib/authApi';

interface SubItem {
  path: string;
  label: string;
  icon: React.ElementType;
  locked?: boolean;
}

interface NavGroup {
  path: string;
  icon: React.ElementType;
  label: string;
  children?: SubItem[];
  pinned?: boolean;
  locked?: boolean;
  /** Accent color for fleet-segment icon badge */
  accent?: string;
}

const NAV: NavGroup[] = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/fleet', icon: Map, label: 'Fleet' },
  {
    path: '/drivers', icon: Users, label: 'Driver Management',
    children: [
      { path: '/drivers', label: 'Drivers', icon: User },
      { path: '/drivers/coaching', label: 'Coaching', icon: GraduationCap },
      { path: '/drivers/training', label: 'Training', icon: Award },
      { path: '/drivers/certifications', label: 'Certificates', icon: BadgeCheck },
    ],
  },
  {
    path: '/incidents', icon: AlertTriangle, label: 'Incident Intelligence',
    children: [
      { path: '/incidents', label: 'Event Explorer', icon: Search },
      { path: '/incidents/trends', label: 'Trends', icon: TrendingUp },
      { path: '/incidents/response', label: 'Response Tracking', icon: ListChecks },
    ],
  },
  { path: '/tankers', icon: Truck, label: 'Bulk Tankers', accent: '#f59e0b' },
  {
    path: '/quarry', icon: Mountain, label: 'Quarry', accent: '#84cc16',
    children: [
      { path: '/quarry', label: 'Overview', icon: Mountain },
      { path: '/quarry/kpi', label: 'Utilization & KPIs', icon: Gauge },
    ],
  },
  { path: '/cement', icon: Package, label: 'Cement', accent: '#94a3b8' },
  { path: '/ready-mix', icon: Droplets, label: 'Ready Mix', accent: '#22d3ee' },
  { path: '/safety', icon: Shield, label: 'Safety' },
  {
    path: '/fuel', icon: Fuel, label: 'Fuel',
    children: [
      { path: '/fuel/monitoring', label: 'Monitoring', icon: Fuel },
      { path: '/fuel/consumption', label: 'Consumption', icon: BarChart3 },
    ],
  },
  {
    path: '/reports', icon: FileBarChart2, label: 'Reports',
    children: [
      { path: '/reports', label: 'Reports', icon: FileBarChart2 },
      { path: '/reports/documents', label: 'Documents', icon: Folder },
    ],
  },
  { path: '/maintenance', icon: Wrench, label: 'Maintenance' },
  // Locked / upcoming — keep at bottom of nav
  {
    path: '/trips', icon: Route, label: 'Journey Management', locked: true,
    children: [
      { path: '/trips', label: 'Journeys', icon: Route, locked: true },
      { path: '/trips/dispatch', label: 'Dispatch', icon: Navigation, locked: true },
    ],
  },
  { path: '/aria', icon: Brain, label: 'AI Insights', locked: true },
];

function NavIcon({
  Icon,
  accent,
  active,
  size = 15,
}: {
  Icon: React.ElementType;
  accent?: string;
  active?: boolean;
  size?: number;
}) {
  if (!accent) {
    return <Icon size={size} style={{ flexShrink: 0 }} />;
  }
  return (
    <span
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: active ? `${accent}33` : `${accent}22`,
        border: `1px solid ${accent}${active ? '99' : '55'}`,
        color: accent,
        boxShadow: active ? `0 0 10px ${accent}33` : 'none',
      }}
    >
      <Icon size={12} strokeWidth={2.25} />
    </span>
  );
}

interface Props {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export default function Sidebar({ mobileOpen, onCloseMobile }: Props) {
  const { theme, setTheme, redAlertCount, fleetSafetyScore, scoreConfig } = useFleet();
  const { user, hasPermission, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const jwtToken = getAuthMode() === 'jwt' ? getStoredToken() : null;
  const jwtClaims = jwtToken ? decodeJwtPayload(jwtToken) : null;

  const canSeePath = (path: string) => {
    const perm = permissionForPath(path);
    if (!perm) return true;
    return hasPermission(perm);
  };

  const visibleNav = NAV.filter(g => canSeePath(g.path)).map(g => ({
    ...g,
    children: g.children?.filter(c => canSeePath(c.path)),
  }));

  const getParentPath = (pathname: string) => {
    const match = visibleNav.find(g =>
      g.children
        ? g.children.some(c => c.path === pathname) || pathname.startsWith(g.path + '/')
        : g.path === pathname
    );
    return match?.path ?? null;
  };

  const [openGroup, setOpenGroup] = useState<string | null>(() => getParentPath(location.pathname));

  const toggleGroup = (path: string, defaultChild?: string) => {
    if (openGroup === path) {
      setOpenGroup(null);
    } else {
      setOpenGroup(path);
      if (defaultChild) navigate(defaultChild);
    }
  };

  const scoreColor = fleetSafetyScore >= scoreConfig.bandGood
    ? '#33d38d'
    : fleetSafetyScore >= scoreConfig.bandAttention
    ? '#f5b453'
    : fleetSafetyScore >= scoreConfig.bandBelow
    ? '#e05c2a'
    : '#ff6b6b';

  return (
    <aside className={`bpl-sidebar${mobileOpen ? ' mobile-open' : ''}`}
      style={{ background: '#0a1520', width: 220 }}
    >
      <div style={{ padding: '16px 16px 12px', borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: '#fff',
            borderRadius: 6,
            padding: '5px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <img
              src="/HBM-logo.jpeg"
              alt="HBM Nigeria"
              style={{ height: 32, width: 'auto', objectFit: 'contain', display: 'block' }}
            />
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>
            Fleet Intelligence<br />Platform
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 12, padding: '8px 10px',
          background: 'rgba(255,255,255,0.04)',
          border: '0.5px solid rgba(255,255,255,0.07)',
          borderRadius: 8,
        }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>
              Safety Score
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor, lineHeight: 1, fontFamily: 'var(--cd-font-display)' }}>
              {fleetSafetyScore}
              <span style={{ fontSize: 10, fontWeight: 400, color: 'rgba(255,255,255,0.3)', marginLeft: 1 }}>/100</span>
            </div>
          </div>
          {redAlertCount > 0 && (
            <div style={{
              background: '#CC0000', color: '#fff', borderRadius: 6,
              padding: '3px 7px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{redAlertCount}</div>
              <div style={{ fontSize: 8, letterSpacing: '0.04em' }}>RED</div>
            </div>
          )}
        </div>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', padding: '8px 0',
        scrollbarWidth: 'none',
      }}>
        {visibleNav.map(group => {
          const Icon = group.icon;
          const isOpen = openGroup === group.path;
          const isActive = group.path === '/'
            ? location.pathname === '/'
            : location.pathname === group.path || location.pathname.startsWith(group.path + '/');

          if (!group.children?.length) {
            return (
              <NavLink
                key={group.path}
                to={group.path}
                end
                onClick={onCloseMobile}
                style={({ isActive: navActive }) => ({
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 14px', cursor: 'pointer',
                  color: navActive ? (group.accent || '#0078D4') : 'rgba(255,255,255,0.55)',
                  background: navActive ? (group.accent ? `${group.accent}22` : 'rgba(0,120,212,0.18)') : 'transparent',
                  fontSize: 12.5, textDecoration: 'none',
                  transition: 'background 0.15s, color 0.15s',
                })}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
                  else if (group.accent) (e.currentTarget as HTMLElement).style.background = `${group.accent}22`;
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <NavIcon Icon={Icon} accent={group.accent} active={isActive} />
                  {group.label}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {group.locked && <Lock size={11} style={{ opacity: 0.4, flexShrink: 0 }} />}
                  {group.path === '/' && redAlertCount > 0 && (
                    <span style={{ background: '#CC0000', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 9999 }}>
                      {redAlertCount}
                    </span>
                  )}
                </div>
              </NavLink>
            );
          }

          return (
            <div key={group.path} style={{ marginBottom: 2 }}>
              <div
                onClick={() => toggleGroup(group.path, group.children![0].path)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 14px', cursor: 'pointer',
                  color: isActive ? (group.accent || '#0078D4') : 'rgba(255,255,255,0.55)',
                  background: isActive && !isOpen
                    ? (group.accent ? `${group.accent}22` : 'rgba(0,120,212,0.18)')
                    : 'transparent',
                  fontSize: 12.5,
                  transition: 'background 0.15s, color 0.15s',
                  userSelect: 'none',
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => {
                  if (!isActive || isOpen) (e.currentTarget as HTMLElement).style.background = 'transparent';
                  else if (group.accent) (e.currentTarget as HTMLElement).style.background = `${group.accent}22`;
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <NavIcon Icon={Icon} accent={group.accent} active={isActive} />
                  {group.label}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {group.locked && <Lock size={11} style={{ opacity: 0.4, flexShrink: 0 }} />}
                  <ChevronDown
                    size={13}
                    style={{
                      color: 'rgba(255,255,255,0.25)',
                      transition: 'transform 0.2s ease',
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      flexShrink: 0,
                    }}
                  />
                </div>
              </div>

              <div style={{
                overflow: 'hidden',
                maxHeight: isOpen ? `${group.children!.length * 34}px` : '0',
                transition: 'max-height 0.25s ease',
              }}>
                {group.children!.map(child => {
                  const SubIcon = child.icon;
                  const childActive = location.pathname === child.path;
                  return (
                    <NavLink
                      key={child.path}
                      to={child.path}
                      end
                      onClick={onCloseMobile}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 14px 6px 38px',
                        fontSize: 12,
                        color: childActive ? (group.accent || '#0078D4') : 'rgba(255,255,255,0.4)',
                        textDecoration: 'none',
                        transition: 'background 0.15s, color 0.15s',
                        background: childActive
                          ? (group.accent ? `${group.accent}18` : 'rgba(0,120,212,0.1)')
                          : 'transparent',
                      }}
                      onMouseEnter={e => { if (!childActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
                      onMouseLeave={e => { if (!childActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <SubIcon size={13} style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{child.label}</span>
                      {child.locked && <Lock size={11} style={{ opacity: 0.4, flexShrink: 0 }} />}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)', paddingBottom: 12 }}>
        {hasPermission('settings') && (
          <NavLink
            to="/settings/general"
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '8px 14px', fontSize: 12.5,
              color: isActive ? '#0078D4' : 'rgba(255,255,255,0.55)',
              background: isActive ? 'rgba(0,120,212,0.18)' : 'transparent',
              textDecoration: 'none',
              transition: 'background 0.15s, color 0.15s',
            })}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'}
            onMouseLeave={e => {
              const active = location.pathname.startsWith('/settings');
              (e.currentTarget as HTMLElement).style.background = active ? 'rgba(0,120,212,0.18)' : 'transparent';
            }}
          >
            <Settings size={15} />
            Settings
          </NavLink>
        )}

        {jwtToken && (
          <div style={{
            margin: '8px 10px 0',
            background: 'rgba(234,179,8,0.1)',
            border: '0.5px solid rgba(234,179,8,0.35)',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 10,
            color: 'rgba(255,255,255,0.65)',
            lineHeight: 1.45,
          }}>
            <div style={{ fontWeight: 700, color: 'rgba(234,179,8,0.95)', marginBottom: 4 }}>
              JWT mode (local)
            </div>
            {jwtClaims && (
              <div style={{ fontFamily: 'monospace', fontSize: 9, wordBreak: 'break-all' }}>
                sub: {String(jwtClaims.sub)}<br />
                exp: {jwtClaims.exp ? new Date(Number(jwtClaims.exp) * 1000).toLocaleString() : '—'}
              </div>
            )}
            <div style={{ marginTop: 4, opacity: 0.75 }}>
              Token in localStorage · sent as Authorization: Bearer
            </div>
          </div>
        )}

        <div style={{
          margin: '8px 10px 0',
          background: 'rgba(0,120,212,0.12)',
          border: '0.5px solid rgba(0,120,212,0.3)',
          borderRadius: 8,
          padding: '8px 10px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 6, height: 6, background: '#0078D4', borderRadius: '50%',
            animation: 'aria-pulse 2s ease-in-out infinite',
            flexShrink: 0,
          }} />
          <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: 11, color: 'rgba(0,120,212,0.9)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name || 'Signed in'}
            </div>
            {user?.roleName && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.roleName}
              </div>
            )}
          </div>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            style={{
              marginLeft: 'auto', background: 'none', border: 'none',
              cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 2,
              display: 'flex', alignItems: 'center',
            }}
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
          </button>
          <button
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.3)', padding: 2,
              display: 'flex', alignItems: 'center',
            }}
            title="Log out"
          >
            <LogOut size={12} />
          </button>
        </div>
      </div>
    </aside>
  );
}
