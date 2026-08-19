import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, Bell, Search, UserCircle, ShieldAlert, GraduationCap } from 'lucide-react';
import Sidebar from './Sidebar';
import SiteSelector from './SiteSelector';
import PageTransition from './PageTransition';
import SafetyToast from '../SafetyToast';
import SafetyIncidentModal from '../SafetyIncidentModal';
import { useFleet } from '../../context/FleetContext';
import { useAuth } from '../../context/AuthContext';
import type { SafetyNotification } from '../../hooks/useSafeIQ';
import { useUserNotifications } from '../../hooks/useUserNotifications';
import type { UserNotification } from '../../lib/coachingWarningsApi';
import EnvironmentBadge from '../EnvironmentBadge';
import { isKnownDriver, displayDriverName } from '../../lib/driverUtils';
import { SAFEIQ_ENABLED } from '../../config/safeIq';

function getPageTitle(pathname: string): { title: string; sub: string } {
  const map: Record<string, { title: string; sub: string }> = {
    '/': { title: 'Dashboard', sub: '— real-time fleet overview' },
    '/fleet': { title: 'Fleet', sub: '— live asset list' },
    '/trips': { title: 'Journey Management', sub: '— ongoing and completed journeys' },
    '/trips/dispatch': { title: 'Journey Management', sub: '— dispatch & journey planning' },
    '/aria': { title: 'AI Insights', sub: '— SafeIQ analyses' },
    '/drivers': { title: 'Driver Management', sub: '— profiles and safety scores' },
    '/drivers/coaching': { title: 'Coaching & Training', sub: '— score ≤70 and retraining' },
    '/drivers/training': { title: 'Coaching & Training', sub: '— score ≤70 and retraining' },
    '/incidents': { title: 'Incident Intelligence', sub: '— event explorer' },
    '/trends': { title: 'Trends', sub: '— visual event insights & history' },
    '/incidents/response': { title: 'Incident Intelligence', sub: '— response tracking' },
    '/vault': { title: 'Safety Vault', sub: '— incident records' },
    '/vault/safeiq': { title: 'Safety Vault', sub: '— SafeIQ analysis' },
    '/vault/investigations': { title: 'Safety Vault', sub: '— investigations' },
    '/vault/actions': { title: 'Safety Vault', sub: '— corrective actions' },
    '/vault/acknowledgements': { title: 'Safety Vault', sub: '— acknowledgements' },
    '/vault/audit': { title: 'Safety Vault', sub: '— audit trail' },
    '/tankers': { title: 'Bulk Tankers', sub: '— East & West zone fleet' },
    '/quarry': { title: 'Quarry', sub: '— Ewekoro, Mfamosing & quarry haulage' },
    '/cement': { title: 'Cement', sub: '— North / East / West distribution' },
    '/ready-mix': { title: 'Ready Mix', sub: '— plant assets' },
    '/fuel/monitoring': { title: 'Fuel', sub: '— monitoring' },
    '/fuel/consumption': { title: 'Fuel', sub: '— consumption' },
    '/reports': { title: 'Reports', sub: '— event log and trends' },
    '/reports/documents': { title: 'Documents', sub: '— report repository' },
    '/maintenance': { title: 'Maintenance', sub: '— scheduling & service' },
    '/settings/general': { title: 'Settings', sub: '— general' },
    '/settings/thresholds': { title: 'Settings', sub: '— safety score & thresholds' },
    '/settings/dev': { title: 'Settings', sub: '— developers' },
    '/settings/roles': { title: 'Settings', sub: '— roles & permissions' },
    '/settings/users': { title: 'Settings', sub: '— users & access' },
  };
  return map[pathname] ?? { title: 'BPL Fleet', sub: '' };
}

function severityColor(s: string) {
  if (s === 'RED') return '#dc2626';
  if (s === 'YELLOW') return '#d97706';
  return '#16a34a';
}

function timeAgo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function NotifPanel({
  teamNotifications,
  onTeamOpen,
  onTeamDismiss,
  onTeamClearAll,
  notifications,
  onOpen,
  onDismiss,
  onClearAll,
  onClose,
  onViewAll,
}: {
  teamNotifications: UserNotification[];
  onTeamOpen: (n: UserNotification) => void;
  onTeamDismiss: (id: string) => void;
  onTeamClearAll: () => void;
  notifications: SafetyNotification[];
  onOpen: (n: SafetyNotification) => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
  onViewAll: () => void;
}) {
  const visible = notifications.filter(n => isKnownDriver(n.driver.name));
  const teamVisible = teamNotifications.filter(n => !n.readAt);

  return (
    <div style={{
      position: 'absolute', top: 40, right: 0, width: 340,
      background: '#0e1e2e', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      zIndex: 200, overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Notifications</span>
          {(teamVisible.length + visible.length) > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, background: 'rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.5)', borderRadius: 99, padding: '1px 6px',
            }}>{teamVisible.length + visible.length}</span>
          )}
        </div>
        {(teamVisible.length + visible.length) > 0 && (
          <button
            onClick={() => { onTeamClearAll(); onClearAll(); onClose(); }}
            style={{
              fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)',
              background: 'rgba(255,255,255,0.07)', border: '0.5px solid rgba(255,255,255,0.12)',
              borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {teamVisible.length === 0 && visible.length === 0 ? (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
          No notifications yet
        </div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {teamVisible.map((n, i) => (
            <div
              key={n.id}
              onClick={() => { onTeamOpen(n); onClose(); }}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start',
              }}
            >
              <GraduationCap size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{n.title}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{n.body}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>{timeAgo(n.createdAt)}</div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onTeamDismiss(n.id); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', padding: 2, flexShrink: 0 }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
          ))}
          {visible.map((n, i) => {
            const severity = n.analysis?.severity ?? 'GREEN';
            const accent = severityColor(severity);
            return (
              <div
                key={n.id}
                onClick={() => { onOpen(n); onClose(); }}
                style={{
                  padding: '12px 16px',
                  borderBottom: i < visible.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start',
                  background: 'transparent', transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <ShieldAlert size={14} style={{ color: accent, flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {displayDriverName(n.driver.name)}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                    {n.magnitude} · {n.vehicle.id}
                    {n.eventCount > 1 && <span style={{ color: accent, fontWeight: 600 }}> · {n.eventCount} incidents/30d</span>}
                  </div>
                  <EnvironmentBadge environment={n.environment} compact />
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>
                    {timeAgo(n.timestamp)}
                    {n.analysis && <span style={{ color: accent, marginLeft: 6, fontWeight: 600 }}>{severity}</span>}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); onDismiss(n.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', padding: 2, flexShrink: 0 }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {SAFEIQ_ENABLED && visible.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => { onClose(); onViewAll(); }}
            style={{
              fontSize: 12, fontWeight: 600, color: '#60a5fa',
              background: 'none', border: 'none', cursor: 'pointer',
            }}
          >
            View all in AI Insights →
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [toastDismissed, setToastDismissed] = useState<Set<string>>(new Set());
  const notifRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    notifications, dismissNotification, clearAllNotifications, selectedNotification,
    openNotification, closeNotification,
    isMobile, redAlertCount,
  } = useFleet();
  const {
    notifications: teamNotifications,
    unreadCount: teamUnread,
    dismiss: dismissTeamNotification,
    clearAll: clearAllTeamNotifications,
  } = useUserNotifications();

  // Close panel on outside click
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  const { title, sub } = getPageTitle(location.pathname);
  const visibleNotifications = notifications.filter(n => isKnownDriver(n.driver.name));
  const bellCount = teamUnread + (SAFEIQ_ENABLED ? visibleNotifications.length : 0);

  const openTeamNotification = (n: UserNotification) => {
    dismissTeamNotification(n.id);
    if (n.link) navigate(n.link.replace(/^\/#\//, '/').replace(/^#/, ''));
    else navigate('/drivers/coaching');
  };

  return (
    <div className="bpl-app">
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

      <div className="bpl-main">
        {/* Dark topbar matching sidebar */}
        <header style={{
          height: 52,
          minHeight: 52,
          background: '#0a1520',
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isMobile && (
              <button onClick={() => setMobileOpen(o => !o)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 4 }}>
                <Menu size={18} />
              </button>
            )}
            <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>{title}</span>
            {!isMobile && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{sub}</span>}
            <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
            <SiteSelector />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {SAFEIQ_ENABLED && redAlertCount > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 7,
                background: 'rgba(204,0,0,0.18)',
                border: '0.5px solid rgba(204,0,0,0.4)',
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#ff6b6b' }}>
                  {redAlertCount} alert{redAlertCount > 1 ? 's' : ''}
                </span>
              </div>
            )}
            <button
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(255,255,255,0.06)',
                border: '0.5px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'rgba(255,255,255,0.5)',
              }}
              title="Search"
            >
              <Search size={14} />
            </button>
            {user && (
            <div style={{ position: 'relative' }} ref={notifRef}>
              <button
                onClick={() => setNotifOpen(o => !o)}
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: notifOpen ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)',
                  border: `0.5px solid ${notifOpen ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: notifOpen ? '#fff' : 'rgba(255,255,255,0.5)',
                  position: 'relative',
                }}
                title="Notifications"
              >
                <Bell size={14} />
                {bellCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 4, right: 4,
                    minWidth: 7, height: 7,
                    background: redAlertCount > 0 ? '#CC0000' : '#0078D4',
                    borderRadius: '50%', border: '1.5px solid #0a1520',
                  }} />
                )}
              </button>
              {notifOpen && (
                <NotifPanel
                  teamNotifications={teamNotifications}
                  onTeamOpen={openTeamNotification}
                  onTeamDismiss={dismissTeamNotification}
                  onTeamClearAll={clearAllTeamNotifications}
                  notifications={notifications}
                  onOpen={openNotification}
                  onDismiss={dismissNotification}
                  onClearAll={clearAllNotifications}
                  onClose={() => setNotifOpen(false)}
                  onViewAll={() => navigate('/aria')}
                />
              )}
            </div>
            )}
            <button
              onClick={() => navigate('/settings/general')}
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(255,255,255,0.06)',
                border: '0.5px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'rgba(255,255,255,0.5)',
              }}
              title="Settings"
            >
              <UserCircle size={14} />
            </button>
          </div>
        </header>

        {/* Page content — shell stays put; loader only in this region */}
        <main style={{ flex: 1, overflow: 'auto' }}>
          <div className="bpl-page">
            <PageTransition />
          </div>
        </main>
      </div>

      {SAFEIQ_ENABLED && (
        <SafetyToast
          notifications={notifications.filter(n => !toastDismissed.has(n.id))}
          onDismiss={id => setToastDismissed(prev => new Set([...prev, id]))}
          onClearAll={() => setToastDismissed(new Set(notifications.map(n => n.id)))}
          onOpen={openNotification}
        />
      )}
      {SAFEIQ_ENABLED && selectedNotification && (
        <SafetyIncidentModal notification={selectedNotification} onClose={closeNotification} />
      )}
    </div>
  );
}
