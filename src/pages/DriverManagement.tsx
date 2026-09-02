import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import { displayDriverName } from '../lib/driverUtils';
import MockNamesBadge from '../components/MockNamesBadge';
import {
  CONSEQUENCE_CONFIG_EVENT,
  CONSEQUENCE_CONFIG_KEY,
  loadConsequenceConfig,
  normalizeDriverScore,
  categorizeDriverScore,
  toDisplayScore100,
  type ConsequenceCategory,
  type ConsequenceScoreConfig,
} from '../lib/consequenceScore';
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
import { useHosRecords } from '../hooks/useHosRecords';
import { fmtHosMinutes, type HosRecord } from '../lib/hos';
import { hosPointsFromHeldMinutes } from '../lib/fleetSafetyScore';

type DateRange = DriverPeriod;
type DriverProfile = AssessedDriver;
const DRIVER_SCORE_PERIOD: DateRange = '30days';

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

function fmtPoints(value: number) {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function hosHeldMinutesFromRecord(record?: HosRecord | null) {
  if (!record) return 0;
  const dailyRestWindow = record.dailyRestWindowMinutes || 1440;
  const dailyRestElapsed = record.dailyRestElapsedMinutes ?? record.minutesSinceDailyRest ?? (7 * 24 * 60);
  const weeklyRestWindow = record.weeklyRestWindowMinutes || (7 * 24 * 60);
  const weeklyRestElapsed = record.weeklyRestElapsedMinutes
    ?? (record.daysSinceWeeklyRest == null ? weeklyRestWindow : record.daysSinceWeeklyRest * 24 * 60);
  return Math.max(0, record.violationDriveMinutes ?? 0)
    + Math.max(0, dailyRestElapsed - dailyRestWindow)
    + Math.max(0, weeklyRestElapsed - weeklyRestWindow);
}

function hosImpactPer100Km(hosPoints: number, distanceKm: number) {
  return hosPoints > 0 ? Math.abs(normalizeDriverScore(-hosPoints, distanceKm)) : 0;
}

function scoreBarColor(category: ConsequenceCategory) {
  if (category === 'Green') return '#16a34a';
  if (category === 'Amber') return '#f59e0b';
  if (category === 'Yellow') return '#d97706';
  return '#CC0000';
}

function ScoreBar({ score, category }: {
  score: number;
  category: ConsequenceCategory;
}) {
  const color = scoreBarColor(category);
  const barWidth = Math.max(0, Math.min(100, score));
  return (
    <div className="dm-score">
      <div className="dm-score-track">
        <div className="dm-score-fill" style={{ width: `${barWidth}%`, background: color }} />
      </div>
      <span className="dm-score-copy">
        <span className="dm-score-n" style={{ color }}>{fmtPoints(score)}</span>
      </span>
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
      label: 'High risk - write-up pending',
      action: 'Issue an official write-up in Coaching before marking this driver for suspension review.',
      official: false,
    };
  }
  if (category === 'Red' && !hasWriteUp) {
    return {
      label: 'Severe risk - write-up pending',
      action: 'Issue an official write-up in Coaching before marking this driver as critical.',
      official: false,
    };
  }
  return {
    label: category === 'Green'
      ? 'On track'
      : category === 'Amber'
        ? 'Needs coaching'
        : category === 'Yellow'
          ? 'Suspension review'
          : 'Critical',
    action: category === 'Green'
      ? 'No disciplinary action - eligible for monthly / quarterly rewards'
      : category === 'Amber'
        ? 'Written Warning'
        : category === 'Yellow'
          ? 'Official write-up recorded - proceed with suspension review.'
          : 'Official write-up recorded - proceed with critical review.',
    official: hasWriteUp,
  };
}

function DriverCard({ driver, expanded, onToggle, onHosOpen, stats, latestWarning, hosPoints, hosHeldMinutes, consequenceConfig }: {
  driver: DriverProfile;
  expanded: boolean;
  onToggle: () => void;
  onHosOpen: () => void;
  stats: ReturnType<typeof periodCardStats>;
  latestWarning: DriverWarning | null;
  hosPoints: number;
  hosHeldMinutes: number;
  consequenceConfig: ConsequenceScoreConfig;
}) {
  const { consequence } = driver;
  const recentEvents = stats.events.slice(0, 10);
  const infractions = stats.eventCount;
  const distanceLabel = fmtDistanceKm(stats.km);
  const hosLabel = fmtHosHours(stats.drivingTimeSeconds, stats.journeyCount);
  const hosHasData = stats.drivingTimeSeconds > 0 || stats.journeyCount > 0;
  const scoreDistanceKm = driver.distanceKm;
  const hosScoreImpact = hosImpactPer100Km(hosPoints, scoreDistanceKm);
  const finalDriverScore = consequence.driverScore - hosScoreImpact;
  const finalDisplayScore = toDisplayScore100(finalDriverScore);
  const finalCategory = categorizeDriverScore(finalDriverScore, consequenceConfig);
  const color = scoreBarColor(finalCategory);
  const officialStatus = driverOfficialStatus(finalCategory, latestWarning);

  const phone = driver.phone && driver.phone !== 'N/A'
    ? (DEMO_BRANDING ? demoPhoneLabel(driver.phone) : driver.phone)
    : null;

  return (
    <div
      className={`dm-row${expanded ? ' is-open' : ''}`}
      style={{ '--dm-accent': color } as React.CSSProperties}
    >
      <div
        className="dm-row-head"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
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
        <button
          type="button"
          className="dm-stat dm-stat--tap"
          title={`${HOS_WINDOW_TIP} Open Fatigue Management for ${displayDriverName(driver.name)}.`}
          onClick={e => {
            e.stopPropagation();
            onHosOpen();
          }}
        >
          <div className="dm-stat-val" style={{ color: hosHasData ? undefined : 'var(--cd-text-muted)' }}>{hosLabel}</div>
          <div className="dm-stat-lbl">HOS</div>
        </button>

        <ScoreBar score={finalDisplayScore} category={finalCategory} />

        <div className="dm-tail">
          <span className="dm-band">{officialStatus.label}</span>
          {expanded
            ? <ChevronUp size={14} className="dm-chevron" />
            : <ChevronDown size={14} className="dm-chevron" />}
        </div>
      </div>

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
          {!latestWarning && (finalCategory === 'Yellow' || finalCategory === 'Red') && (
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
              ...(hosPoints > 0
                ? [{ label: 'HOS points', value: `-${fmtPoints(hosPoints)} pts | -${fmtPoints(hosScoreImpact)} /100km`, tip: `${fmtPoints(hosPoints)} raw HOS points from ${fmtHosMinutes(hosHeldMinutes)} held over HOS limits; scaled by ${fmtDistanceKm(scoreDistanceKm)} monthly km` }]
                : []),
              { label: 'Per 100 km', value: finalDriverScore.toFixed(1) },
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
  const navigate = useNavigate();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [dateRange, setDateRange] = useState<DateRange>('30days');
  const [customRange, setCustomRange] = useState(defaultDriverCustomRange);
  const [expandedDrivers, setExpandedDrivers] = useState<Set<string>>(new Set());
  const { tripDrivers: periodTrips, loading: periodTripLoading } = usePeriodTripDrivers(dateRange, customRange);
  const { tripDrivers: scoreTrips, loading: scoreTripLoading } = usePeriodTripDrivers(DRIVER_SCORE_PERIOD, customRange);
  const { events, eventsLoading, vehicles, selectedSites, siteOptions, siteNameOptions, scoreConfig } = useFleet();
  const { records: hosRaw } = useHosRecords();
  const [driverWarnings, setDriverWarnings] = useState<Map<string, DriverWarning>>(new Map());
  const [consequenceConfig, setConsequenceConfig] = useState<ConsequenceScoreConfig>(() => loadConsequenceConfig());
  const seedBusy = eventsLoading || periodTripLoading || scoreTripLoading;
  const siteFiltered = selectedSites.length > 0;

  const scopeLabel = useMemo(() => {
    if (!siteFiltered) return null;
    return selectedSiteScopeLabel(selectedSites, siteOptions, siteNameOptions);
  }, [selectedSites, siteFiltered, siteNameOptions, siteOptions]);

  const scopedPeriodTrips = useMemo(
    () => siteFiltered ? filterTripDriversByVehicles(periodTrips, vehicles) : periodTrips,
    [periodTrips, siteFiltered, vehicles],
  );

  const scopedScoreTrips = useMemo(
    () => siteFiltered ? filterTripDriversByVehicles(scoreTrips, vehicles) : scoreTrips,
    [scoreTrips, siteFiltered, vehicles],
  );

  const scoreEvents = useMemo(
    () => eventsInDriverPeriod(events, DRIVER_SCORE_PERIOD),
    [events],
  );

  useEffect(() => {
    const q = searchParams.get('q');
    if (!q) return;
    setSearch(q);
    setExpandedDrivers(new Set([q]));
  }, []);

  useEffect(() => {
    const onConfig = (event: Event) => {
      setConsequenceConfig((event as CustomEvent<ConsequenceScoreConfig>).detail ?? loadConsequenceConfig());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CONSEQUENCE_CONFIG_KEY) setConsequenceConfig(loadConsequenceConfig());
    };
    window.addEventListener(CONSEQUENCE_CONFIG_EVENT, onConfig);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CONSEQUENCE_CONFIG_EVENT, onConfig);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const drivers: DriverProfile[] = useMemo(
    () => assessDrivers(scoreEvents, scopedScoreTrips, consequenceConfig),
    [consequenceConfig, scoreEvents, scopedScoreTrips],
  );
  const periodTripMap = useMemo(() => tripStatsByDriverKey(scopedPeriodTrips), [scopedPeriodTrips]);
  const hosPointsByDriverKey = useMemo(() => {
    const map = new Map<string, { points: number; heldMinutes: number }>();
    const add = (key: string | null | undefined, heldMinutes: number) => {
      const k = (key || '').trim();
      if (!k || map.has(k)) return;
      map.set(k, {
        points: hosPointsFromHeldMinutes(heldMinutes, scoreConfig),
        heldMinutes,
      });
    };
    const source = Array.isArray(hosRaw) ? hosRaw : [];
    source.forEach(record => {
      const heldMinutes = hosHeldMinutesFromRecord(record);
      if (heldMinutes <= 0) return;
      add(record.id, heldMinutes);
      add(record.driverName, heldMinutes);
    });
    return map;
  }, [hosRaw, scoreConfig]);
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
    // Do not pass thousands of keys — GET query string length crashes the page.
    fetchDriverWarnings()
      .then(warnings => {
        if (cancelled) return;
        const wanted = new Set(driverWarningKeys);
        const byDriver = new Map<string, DriverWarning>();
        warnings.forEach(w => {
          if (!wanted.has(w.driverKey)) return;
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
  const finalOutcomeByDriverKey = useMemo(() => {
    const map = new Map<string, { category: ConsequenceCategory; driverScore: number; displayScore: number }>();
    drivers.forEach(d => {
      const hos = hosPointsByDriverKey.get(d.key) || hosPointsByDriverKey.get((d.name || '').trim());
      const driverScore = d.consequence.driverScore - hosImpactPer100Km(hos?.points ?? 0, d.distanceKm);
      map.set(d.key, {
        category: categorizeDriverScore(driverScore, consequenceConfig),
        driverScore,
        displayScore: toDisplayScore100(driverScore),
      });
    });
    return map;
  }, [consequenceConfig, drivers, hosPointsByDriverKey]);
  const rankedDrivers = useMemo(
    () => drivers.slice().sort((a, b) => {
      const ao = finalOutcomeByDriverKey.get(a.key);
      const bo = finalOutcomeByDriverKey.get(b.key);
      return (ao?.displayScore ?? a.consequence.displayScore) - (bo?.displayScore ?? b.consequence.displayScore)
        || (ao?.driverScore ?? a.consequence.driverScore) - (bo?.driverScore ?? b.consequence.driverScore);
    }),
    [drivers, finalOutcomeByDriverKey],
  );
  const searchNeedle = deferredSearch.trim().toLowerCase();
  const visible = searchNeedle
    ? rankedDrivers.filter(d => String(d.name || '').toLowerCase().includes(searchNeedle) || String(d.regNo || '').toLowerCase().includes(searchNeedle))
    : rankedDrivers;

  const pagination = useClientPagination(visible, 50, deferredSearch);

  const toggle = (name: string) => setExpandedDrivers(prev => {
    const n = new Set(prev);
    n.has(name) ? n.delete(name) : n.add(name);
    return n;
  });

  const redCount = drivers.filter(d => finalOutcomeByDriverKey.get(d.key)?.category === 'Red').length;
  const needsAction = drivers.filter(d => (finalOutcomeByDriverKey.get(d.key)?.category ?? d.consequence.category) !== 'Green').length;
  const greenCount = drivers.filter(d => (finalOutcomeByDriverKey.get(d.key)?.category ?? d.consequence.category) === 'Green').length;

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
          Consequence/Fatigue Management scorecards — selected-period penalty points normalized per 100 km
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
          <div className="bpl-kpi-sub">Needs coaching + official write-up review</div>
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
            (() => {
              const hos = hosPointsByDriverKey.get(d.key) || hosPointsByDriverKey.get((d.name || '').trim());
              return (
                <DriverCard
                  key={d.key}
                  driver={d}
                  expanded={expandedDrivers.has(d.name) || expandedDrivers.has(d.key)}
                  onToggle={() => toggle(d.name)}
                  onHosOpen={() => navigate(`/drivers/fatigue?q=${encodeURIComponent(displayDriverName(d.name))}`)}
                  stats={periodCardStats(d, dateRange, customRange, periodTripMap, consequenceConfig)}
                  latestWarning={driverWarnings.get(d.key) ?? null}
                  hosPoints={hos?.points ?? 0}
                  hosHeldMinutes={hos?.heldMinutes ?? 0}
                  consequenceConfig={consequenceConfig}
                />
              );
            })()
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
