import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import { displayDriverName } from '../lib/driverUtils';
import MockNamesBadge from '../components/MockNamesBadge';
import { type ConsequenceCategory } from '../lib/consequenceScore';
import { assessDrivers, eventsInDriverPeriod, type AssessedDriver, type DriverPeriod, defaultDriverCustomRange, periodCardStats, tripStatsByDriverKey } from '../lib/driverAssessment';
import { usePeriodTripDrivers } from '../hooks/useAssessmentTripDrivers';
import { useClientPagination } from '../hooks/useClientPagination';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import PageControls from '../components/PageControls';
import { brandLabel } from '../lib/branding';
import { DEMO_BRANDING, demoPhoneLabel } from '../config/demoBranding';
import { SkelValue, SkelTable } from '../components/data/DataBusy';
import { filterTripDriversByVehicles } from '../lib/siteScope';
import InfoTip from '../components/InfoTip';
import { selectedSiteScopeLabel } from '../lib/cementSiteTree';
import { fetchDriverWarnings, type DriverWarning } from '../lib/coachingWarningsApi';

type DateRange = DriverPeriod;
type DriverProfile = AssessedDriver;

function fmtDistanceKm(km: number) {
  if (km <= 0) return '0';
  if (km < 10) return km.toFixed(1);
  return Math.round(km).toLocaleString();
}

const HOS_WINDOW_TIP = 'Drive time in the selected period from telematics segments. Short GPS blips are ignored.';

function fmtHosHours(seconds: number, journeyCount: number) {
  if (seconds <= 0 && journeyCount <= 0) return '—';
  const h = seconds / 3600;
  if (h <= 0) return '<0.1h';
  if (h < 10) return `${h.toFixed(1)}h`;
  return `${Math.round(h)}h`;
}

function scoreBarColor(category: ConsequenceCategory) {
  if (category === 'Green') return '#16a34a';
  if (category === 'Amber') return '#f59e0b';
  if (category === 'Yellow') return '#d97706';
  return '#CC0000';
}

function ScoreBar({ score, category }: { score: number; category: ConsequenceCategory }) {
  const color = scoreBarColor(category);
  return (
    <div className="dm-score">
      <div className="dm-score-track">
        <div className="dm-score-fill" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="dm-score-n" style={{ color }}>{score}</span>
    </div>
  );
}

function formatWriteUpTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Africa/Lagos',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function driverOfficialStatus(
  category: ConsequenceCategory,
  latestWarning: DriverWarning | null,
) {
  const hasWriteUp = !!latestWarning;
  if (category === 'Yellow' && !hasWriteUp) {
    return {
      label: 'High risk - coaching record pending',
      action: 'Create an official coaching record before escalating this driver for management review.',
      official: false,
    };
  }
  if (category === 'Red' && !hasWriteUp) {
    return {
      label: 'Severe risk - coaching record pending',
      action: 'Create an official coaching record before escalating this driver for management review.',
      official: false,
    };
  }
  return {
    label: category === 'Green'
      ? 'On track'
      : category === 'Amber'
        ? 'Needs coaching'
        : category === 'Yellow'
          ? 'High risk'
          : 'Severe risk',
    action: category === 'Green'
      ? 'No action needed - eligible for monthly / quarterly rewards'
      : category === 'Amber'
        ? 'Coaching review'
        : category === 'Yellow'
          ? 'Official coaching record found - proceed with management review.'
          : 'Official coaching record found - proceed with management review.',
    official: hasWriteUp,
  };
}

function DriverCard({ driver, expanded, onToggle, stats }: {
  driver: DriverProfile;
  expanded: boolean;
  onToggle: () => void;
  stats: ReturnType<typeof periodCardStats>;
  latestWarning: DriverWarning | null;
}) {
  const { consequence } = driver;
  const color = consequence.categoryColor;
  const officialStatus = driverOfficialStatus(consequence.category, latestWarning);
  const recentEvents = stats.events.slice(0, 10);
  const infractions = stats.eventCount;
  const distanceLabel = fmtDistanceKm(stats.km);
  const hosLabel = fmtHosHours(stats.drivingTimeSeconds, stats.journeyCount);
  const hosHasData = stats.drivingTimeSeconds > 0 || stats.journeyCount > 0;

  const phone = driver.phone && driver.phone !== 'N/A'
    ? (DEMO_BRANDING ? demoPhoneLabel(driver.phone) : driver.phone)
    : null;

  return (
    <div
      className={`dm-row${expanded ? ' is-open' : ''}`}
      style={{ '--dm-accent': color } as React.CSSProperties}
    >
      <button type="button" className="dm-row-head" onClick={onToggle}>
        <div className="dm-ident">
          <div className="dm-avatar">{displayDriverName(driver.name).charAt(0) || '?'}</div>
          <div className="dm-ident-text">
            <div className="dm-name">{displayDriverName(driver.name)}</div>
            <div className="dm-meta">
              <span>{driver.regNo}</span>
              <span>{brandLabel(driver.assetName)}</span>
              {phone && <span>{phone}</span>}
            </div>
          </div>
        </div>

        <div className="dm-stat">
          <div className="dm-stat-val" style={{ color: infractions > 0 ? '#CC0000' : undefined }}>{infractions}</div>
          <div className="dm-stat-lbl">Events</div>
        </div>
        <div className="dm-stat">
          <div className="dm-stat-val">{distanceLabel}</div>
          <div className="dm-stat-lbl">km</div>
        </div>
        <div className="dm-stat" title={HOS_WINDOW_TIP}>
          <div className="dm-stat-val" style={{ color: hosHasData ? undefined : 'var(--cd-text-muted)' }}>{hosLabel}</div>
          <div className="dm-stat-lbl">HOS</div>
        </div>

        <ScoreBar score={consequence.displayScore} category={consequence.category} />

        <div className="dm-tail">
          <span className="dm-band">{officialStatus.label}</span>
          {expanded
            ? <ChevronUp size={14} className="dm-chevron" />
            : <ChevronDown size={14} className="dm-chevron" />}
        </div>
      </button>

      {expanded && (
        <div className="dm-drop">
          <div className="dm-reco">
            <span className="dm-reco-kicker">Action</span>
            <span className="dm-reco-text">{officialStatus.action}</span>
          </div>
          {latestWarning && (
            <div className="dm-reco" style={{ marginTop: 8 }}>
              <span className="dm-reco-kicker">Official write-up</span>
              <span className="dm-reco-text">
                {latestWarning.issuedByName} - {formatWriteUpTime(latestWarning.createdAt)}
              </span>
            </div>
          )}
          {!latestWarning && (consequence.category === 'Yellow' || consequence.category === 'Red') && (
            <div className="dm-reco" style={{ marginTop: 8 }}>
              <span className="dm-reco-kicker">Official status</span>
              <span className="dm-reco-text">No written warning record found in Response Tracking / Coaching.</span>
            </div>
          )}
          {driver.distanceKm <= 0 && consequence.counts.eventCount > 0 && (
            <div className="dm-reco" style={{ marginTop: 8 }}>
              <span className="dm-reco-kicker">Exposure</span>
              <span className="dm-reco-text">No trip kilometres matched — rate uses a 100 km floor so one event cannot become score 0.</span>
            </div>
          )}

          <div className="dm-facts">
            {[
              { label: 'Penalty', value: consequence.penaltyPoints },
              { label: 'Distance', value: `${Math.round(stats.km).toLocaleString()} km` },
              { label: 'HOS', value: hosHasData ? `${(stats.drivingTimeSeconds / 3600).toFixed(1)}h` : '—', tip: HOS_WINDOW_TIP },
              { label: 'Per 100 km', value: consequence.driverScore.toFixed(1) },
            ].map(s => (
              <div key={s.label} className="dm-fact" title={s.tip}>
                <span className="dm-fact-val">{s.value}</span>
                <span className="dm-fact-lbl">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="dm-facts dm-facts--counts">
            {[
              { label: 'Brake', value: stats.harshBraking, color: '#CC0000' },
              { label: 'Accel', value: stats.harshAccel, color: '#0078D4' },
              { label: 'Speed', value: stats.overspeeding, color: '#9333ea' },
              ...(stats.cornering > 0
                ? [{ label: 'Corner', value: stats.cornering, color: '#d97706' }]
                : []),
            ].map(s => (
              <div key={s.label} className="dm-fact">
                <span className="dm-fact-val" style={{ color: s.color }}>{s.value}</span>
                <span className="dm-fact-lbl">{s.label}</span>
              </div>
            ))}
          </div>

          {recentEvents.length > 0 && (
            <div className="dm-events">
              <div className="dm-events-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span>Recent</span>
                <Link
                  to={`/incidents?q=${encodeURIComponent(driver.name)}&range=alltime`}
                  onClick={e => e.stopPropagation()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'var(--bpl-blue)',
                    fontSize: 11,
                    fontWeight: 700,
                    textDecoration: 'none',
                    textTransform: 'none',
                  }}
                  title={`View all incidents for ${displayDriverName(driver.name)}`}
                >
                  View all incidents
                  <ExternalLink size={12} aria-hidden />
                </Link>
              </div>
              {recentEvents.map((e, i) => {
                const label = e.label || 'Unknown';
                const c = label === 'Harsh Braking' ? '#CC0000' : undefined;
                return (
                  <div key={i} className="dm-event">
                    <span className="dm-event-type" style={{ color: c }}>{label}</span>
                    <span className="dm-event-loc">{e.address || '—'}</span>
                    <span className="dm-event-time">
                      {e.eventTime ? new Date(e.eventTime).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DriverManagement() {
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [dateRange, setDateRange] = useState<DateRange>('30days');
  const [customRange, setCustomRange] = useState(defaultDriverCustomRange);
  const [expandedDrivers, setExpandedDrivers] = useState<Set<string>>(new Set());
  const { tripDrivers: periodTrips, loading: periodTripLoading } = usePeriodTripDrivers(dateRange, customRange);
  const { events, eventsLoading, vehicles, selectedSites, siteOptions, siteNameOptions } = useFleet();
  const [driverWarnings, setDriverWarnings] = useState<Map<string, DriverWarning>>(new Map());
  const seedBusy = eventsLoading || periodTripLoading;
  const siteFiltered = selectedSites.length > 0;

  const scopeLabel = useMemo(() => {
    if (!siteFiltered) return null;
    return selectedSiteScopeLabel(selectedSites, siteOptions, siteNameOptions);
  }, [selectedSites, siteFiltered, siteNameOptions, siteOptions]);

  const scopedPeriodTrips = useMemo(
    () => siteFiltered ? filterTripDriversByVehicles(periodTrips, vehicles) : periodTrips,
    [periodTrips, siteFiltered, vehicles],
  );

  const scoreEvents = useMemo(
    () => eventsInDriverPeriod(events, dateRange, customRange),
    [customRange, dateRange, events],
  );

  useEffect(() => {
    const q = searchParams.get('q');
    if (!q) return;
    setSearch(q);
    setExpandedDrivers(new Set([q]));
  }, []);

  const drivers: DriverProfile[] = useMemo(
    () => assessDrivers(scoreEvents, scopedPeriodTrips),
    [scoreEvents, scopedPeriodTrips],
  );
  const periodTripMap = useMemo(() => tripStatsByDriverKey(scopedPeriodTrips), [scopedPeriodTrips]);
  const driverWarningKeys = useMemo(
    () => Array.from(new Set(drivers.map(d => d.key).filter(Boolean))).sort(),
    [drivers],
  );

  useEffect(() => {
    if (driverWarningKeys.length === 0) {
      setDriverWarnings(new Map());
      return;
    }
    let cancelled = false;
    fetchDriverWarnings(driverWarningKeys)
      .then(warnings => {
        if (cancelled) return;
        const byDriver = new Map<string, DriverWarning>();
        warnings.forEach(w => {
          if (!byDriver.has(w.driverKey)) byDriver.set(w.driverKey, w);
        });
        setDriverWarnings(byDriver);
      })
      .catch(() => {
        if (!cancelled) setDriverWarnings(new Map());
      });
    return () => { cancelled = true; };
  }, [driverWarningKeys]);

  const debouncedSearch = useDebouncedValue(search, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const visible = deferredSearch
    ? drivers.filter(d => d.name.toLowerCase().includes(deferredSearch.toLowerCase()) || d.regNo.toLowerCase().includes(deferredSearch.toLowerCase()))
    : drivers;

  const pagination = useClientPagination(visible, 50, deferredSearch);

  const toggle = (name: string) => setExpandedDrivers(prev => {
    const n = new Set(prev);
    n.has(name) ? n.delete(name) : n.add(name);
    return n;
  });

  const redCount = drivers.filter(d => d.consequence.category === 'Red').length;
  const needsAction = drivers.filter(d => d.consequence.category !== 'Green').length;
  const greenCount = drivers.filter(d => d.consequence.category === 'Green').length;

  return (
    <div className="dm-page">
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">
          {scopeLabel ? (
            <>
              <span style={{ color: 'var(--bpl-blue)' }}>{brandLabel(scopeLabel)}</span> Drivers
            </>
          ) : (
            'Driver Management'
          )} <MockNamesBadge />
        </h1>
        <p className="bpl-page-subtitle">
          Driver risk scorecards — selected-period safety events normalized per 100 km
          {scopeLabel && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              marginLeft: 8,
              padding: '2px 8px',
              borderRadius: 9999,
              background: 'var(--bpl-blue-soft)',
              color: 'var(--bpl-blue)',
              fontWeight: 700,
            }}>
              {brandLabel(scopeLabel)}
            </span>
          )}
        </p>
      </div>

      <div className="bpl-kpi-grid dm-summary">
        <div className="bpl-kpi-card">
          <div className="bpl-kpi-label" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Total Drivers
            <InfoTip
              label="Total Drivers"
              text="The site selector count is vehicles/assets. Total Drivers counts unique active driver profiles with usable driver data in this selected scope, so it can be lower than the asset count."
            />
          </div>
          <div className="bpl-kpi-value">{seedBusy ? <SkelValue wide /> : drivers.length}</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '2px solid #CC0000' }}>
          <div className="bpl-kpi-label">High Risk</div>
          <div className="bpl-kpi-value" style={{ color: '#CC0000' }}>{seedBusy ? <SkelValue /> : redCount}</div>
          <div className="bpl-kpi-sub">Red tier</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '2px solid #d97706' }}>
          <div className="bpl-kpi-label">Needs Action</div>
          <div className="bpl-kpi-value" style={{ color: '#d97706' }}>{seedBusy ? <SkelValue /> : needsAction}</div>
          <div className="bpl-kpi-sub">Needs coaching or management review</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '2px solid #16a34a' }}>
          <div className="bpl-kpi-label">Low Risk</div>
          <div className="bpl-kpi-value" style={{ color: '#16a34a' }}>{seedBusy ? <SkelValue /> : greenCount}</div>
          <div className="bpl-kpi-sub">Green tier</div>
        </div>
      </div>

      <div className="dm-toolbar">
        <div className="dm-search">
          <Search size={13} className="dm-search-icon" />
          <input
            type="text"
            placeholder="Search driver or vehicle..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="dm-range">
          {(['today', '7days', '30days', 'custom'] as DateRange[]).map(r => (
            <button
              key={r}
              type="button"
              className={dateRange === r ? 'is-on' : undefined}
              onClick={() => setDateRange(r)}
            >
              {r === 'today' ? 'Today' : r === '7days' ? '7d' : r === '30days' ? '30d' : 'Custom'}
            </button>
          ))}
        </div>
        {dateRange === 'custom' && (
          <div className="dm-custom-range">
            <input
              type="date"
              value={customRange.from}
              max={customRange.to}
              onChange={e => setCustomRange(r => ({ ...r, from: e.target.value }))}
            />
            <span>to</span>
            <input
              type="date"
              value={customRange.to}
              min={customRange.from}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setCustomRange(r => ({ ...r, to: e.target.value }))}
            />
          </div>
        )}
        <span className="dm-toolbar-count">
          {seedBusy ? <SkelValue /> : `${visible.length} drivers`}
        </span>
      </div>

      {seedBusy ? (
        <div className="bpl-card" style={{ padding: 16 }}><SkelTable rows={6} /></div>
      ) : visible.length === 0 ? (
        <div className="bpl-card dm-empty">No driver data available</div>
      ) : (
        <div className="bpl-card dm-list">
          <div className="dm-list-head">
            <span>Driver</span>
            <span>Events</span>
            <span>km</span>
            <span>HOS</span>
            <span>Score</span>
            <span />
          </div>
          {pagination.pageRows.map(d => (
            <DriverCard
              key={d.key}
              driver={d}
              expanded={expandedDrivers.has(d.name) || expandedDrivers.has(d.key)}
              onToggle={() => toggle(d.name)}
              stats={periodCardStats(d, dateRange, customRange, periodTripMap)}
              latestWarning={driverWarnings.get(d.key) ?? null}
            />
          ))}
        </div>
      )}

      {!seedBusy && visible.length > 0 && (
        <div className="bpl-card" style={{ marginTop: 8, padding: 0 }}>
          <PageControls
            page={pagination.page}
            pageCount={pagination.pageCount}
            from={pagination.from}
            to={pagination.to}
            total={pagination.total}
            hasPrev={pagination.hasPrev}
            hasNext={pagination.hasNext}
            onPrev={pagination.prev}
            onNext={pagination.next}
            itemLabel="drivers"
          />
        </div>
      )}
    </div>
  );
}
