import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { useFleet, authFetch, type LogEntry } from '../context/FleetContext';
import { displayDriverName } from '../lib/driverUtils';
import MockNamesBadge from '../components/MockNamesBadge';
import {
  categorizeDriverScore,
  normalizeDriverScore,
  toDisplayScore100,
  CATEGORY_COLORS,
  type ConsequenceCategory,
} from '../lib/consequenceScore';
import {
  assessDriversFromRisk,
  driverRiskUrl,
  type AssessedDriver,
  type DriverPeriod,
  defaultDriverCustomRange,
  periodCardStats,
  tripStatsByDriverKey,
} from '../lib/driverAssessment';
import { usePeriodTripDrivers } from '../hooks/useAssessmentTripDrivers';
import { useClientPagination } from '../hooks/useClientPagination';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import PageControls from '../components/PageControls';
import { brandLabel } from '../lib/branding';
import { DEMO_BRANDING, demoPhoneLabel } from '../config/demoBranding';
import { SkelValue, SkelTable } from '../components/data/DataBusy';
import { filterTripDriversByVehicles, filterRiskDriversByVehicles } from '../lib/siteScope';
import InfoTip from '../components/InfoTip';
import { selectedSiteScopeLabel } from '../lib/cementSiteTree';
import { fetchDriverWarnings, type DriverWarning } from '../lib/coachingWarningsApi';
import PagePeriodBar from '../components/PagePeriodBar';
import { authCachedJson, cachePeek, CACHE_TTL } from '../lib/apiCache';
import { driverExpandEventsUrl, parseEventsLogPayload } from '../lib/riskExpandEvents';
import ExpandedEventsList from '../components/risk/ExpandedEventsList';
import { useHosRecords } from '../hooks/useHosRecords';
import { fmtHosMinutes, hosHeldMinutesFromRecord } from '../lib/hos';
import { hosPointsFromHeldMinutes } from '../lib/fleetSafetyScore';
import { useAuth } from '../context/AuthContext';

type DateRange = DriverPeriod;
type DriverProfile = AssessedDriver;

function fmtDistanceKm(km: number) {
  if (km <= 0) return '0';
  if (km < 10) return km.toFixed(1);
  return Math.round(km).toLocaleString();
}

const HOS_WINDOW_TIP = 'Drive time in the selected period from telematics segments. Short GPS blips are ignored.';
const HOS_POINTS_TIP = 'Live HOS breach points (same rule as Fatigue): floor(over-limit minutes ÷ 10) × points-per-slice. When > 0 they reduce this driver’s score.';

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

/** HOS points treated like penalty points, then normalized per 100 km. */
function hosImpactPer100Km(hosPoints: number, distanceKm: number) {
  return hosPoints > 0 ? Math.abs(normalizeDriverScore(-hosPoints, distanceKm)) : 0;
}

function scoreBarColor(category: ConsequenceCategory) {
  if (category === 'Green') return '#16a34a';
  if (category === 'Amber') return '#f59e0b';
  if (category === 'Yellow') return '#d97706';
  return '#CC0000';
}

function ScoreBar({ score, category, hosImpact }: {
  score: number;
  category: ConsequenceCategory;
  hosImpact: number;
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
        {hosImpact > 0 && (
          <span className="dm-score-hos" title="HOS points reduced this score">
            −{fmtPoints(hosImpact)} HOS
          </span>
        )}
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

function driverEventsUrl(driver: DriverProfile, period: DateRange, custom: { from: string; to: string }) {
  return driverExpandEventsUrl(driver.name, period, custom.from, custom.to);
}

function DriverCard({
  driver,
  expanded,
  onToggle,
  stats,
  latestWarning,
  recentEvents,
  eventsLoading,
  hosPoints,
  hosHeldMinutes,
  hosImpact,
  displayScore,
  category,
}: {
  driver: DriverProfile;
  expanded: boolean;
  onToggle: () => void;
  stats: ReturnType<typeof periodCardStats>;
  latestWarning: DriverWarning | null;
  recentEvents: LogEntry[];
  eventsLoading: boolean;
  hosPoints: number;
  hosHeldMinutes: number;
  hosImpact: number;
  displayScore: number;
  category: ConsequenceCategory;
}) {
  const { consequence } = driver;
  const color = scoreBarColor(category);
  const officialStatus = driverOfficialStatus(category, latestWarning);
  const infractions = stats.eventCount;
  const distanceLabel = fmtDistanceKm(stats.km);
  const hosHoursLabel = fmtHosHours(stats.drivingTimeSeconds, stats.journeyCount);
  const hosHasDriveData = stats.drivingTimeSeconds > 0 || stats.journeyCount > 0;
  const hosAffectsScore = hosPoints > 0 && hosImpact > 0;
  const hosCellLabel = hosAffectsScore ? `${fmtPoints(hosPoints)} pts` : hosHoursLabel;
  const hosCellTip = hosAffectsScore
    ? `${HOS_POINTS_TIP} ${fmtHosMinutes(hosHeldMinutes)} over-limit → ${fmtPoints(hosPoints)} pts (−${fmtPoints(hosImpact)} on score). Drive time: ${hosHoursLabel}.`
    : HOS_WINDOW_TIP;

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
        <div
          className={`dm-stat${hosAffectsScore ? ' is-hos-hit' : ''}`}
          title={hosCellTip}
        >
          <div
            className="dm-stat-val"
            style={{ color: hosAffectsScore ? '#CC0000' : (hosHasDriveData ? undefined : 'var(--cd-text-muted)') }}
          >
            {hosCellLabel}
          </div>
          <div className="dm-stat-lbl">HOS</div>
        </div>

        <ScoreBar score={displayScore} category={category} hosImpact={hosImpact} />

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
          {!latestWarning && (category === 'Yellow' || category === 'Red') && (
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
          {hosAffectsScore && (
            <div className="dm-reco" style={{ marginTop: 8 }}>
              <span className="dm-reco-kicker">HOS impact</span>
              <span className="dm-reco-text">
                {fmtPoints(hosPoints)} HOS pts from {fmtHosMinutes(hosHeldMinutes)} over-limit
                (same rule as Fatigue) reduces the score by {fmtPoints(hosImpact)} after per-100 km normalization.
              </span>
            </div>
          )}

          <div className="dm-facts">
            {[
              { label: 'Penalty', value: consequence.penaltyPoints },
              { label: 'Distance', value: `${Math.round(stats.km).toLocaleString()} km` },
              {
                label: 'HOS pts',
                value: hosPoints > 0 ? fmtPoints(hosPoints) : '0',
                tip: HOS_POINTS_TIP,
                highlight: hosAffectsScore,
              },
              { label: 'Drive', value: hosHasDriveData ? `${(stats.drivingTimeSeconds / 3600).toFixed(1)}h` : '—', tip: HOS_WINDOW_TIP },
              { label: 'Per 100 km', value: (consequence.driverScore - hosImpact).toFixed(1) },
            ].map(s => (
              <div key={s.label} className="dm-fact" title={s.tip}>
                <span className="dm-fact-val" style={{ color: s.highlight ? '#CC0000' : undefined }}>{s.value}</span>
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

          <div className="dm-events">
            <div className="dm-events-label">Events in period</div>
            <ExpandedEventsList
              events={recentEvents}
              loading={eventsLoading}
              emptyMessage={infractions > 0 ? 'Loading detail…' : 'No events in this period.'}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function DriverManagement() {
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [dateRange, setDateRange] = useState<DateRange>('7days');
  const [customRange, setCustomRange] = useState(defaultDriverCustomRange);
  const [expandedDrivers, setExpandedDrivers] = useState<Set<string>>(new Set());
  const { tripDrivers: periodTrips, loading: periodTripLoading } = usePeriodTripDrivers(dateRange, customRange);
  const { vehicles, selectedSites, siteOptions, siteNameOptions, scoreConfig, siteLock } = useFleet();
  const { user } = useAuth();
  const { records: hosRaw } = useHosRecords();
  const [driverWarnings, setDriverWarnings] = useState<Map<string, DriverWarning>>(new Map());
  const [expandEvents, setExpandEvents] = useState<Record<string, LogEntry[]>>({});
  const [expandLoading, setExpandLoading] = useState<Record<string, boolean>>({});

  const riskUrl = driverRiskUrl(dateRange, customRange);
  const [riskRows, setRiskRows] = useState(() =>
    cachePeek<{ drivers?: Parameters<typeof assessDriversFromRisk>[0] }>(riskUrl)?.drivers ?? [],
  );
  const [riskLoading, setRiskLoading] = useState(() => !cachePeek(riskUrl));
  const seedBusy = riskLoading && riskRows.length === 0;
  const siteFiltered = selectedSites.length > 0;

  const scopeLabel = useMemo(() => {
    if (siteLock && user?.fleetName) return user.fleetName;
    if (!siteFiltered) return null;
    return selectedSiteScopeLabel(selectedSites, siteOptions, siteNameOptions);
  }, [siteLock, user?.fleetName, selectedSites, siteFiltered, siteNameOptions, siteOptions]);

  const scopedPeriodTrips = useMemo(
    () => siteFiltered ? filterTripDriversByVehicles(periodTrips, vehicles) : periodTrips,
    [periodTrips, siteFiltered, vehicles],
  );

  const scopedRiskRows = useMemo(
    () => siteFiltered ? filterRiskDriversByVehicles(riskRows, scopedPeriodTrips, vehicles) : riskRows,
    [riskRows, scopedPeriodTrips, vehicles, siteFiltered],
  );

  useEffect(() => {
    let cancelled = false;
    const url = driverRiskUrl(dateRange, customRange);
    const cached = cachePeek<{ drivers?: Parameters<typeof assessDriversFromRisk>[0] }>(url);
    if (cached?.drivers?.length) {
      setRiskRows(cached.drivers);
      setRiskLoading(false);
    } else {
      // Keep prior rows; seedBusy only skeletons when riskRows is empty.
      setRiskLoading(true);
    }
    authCachedJson<{ drivers?: Parameters<typeof assessDriversFromRisk>[0] }>(url, authFetch, {
      ttlMs: CACHE_TTL.riskDrivers,
    })
      .then(data => {
        if (cancelled || !data?.drivers) return;
        setRiskRows(data.drivers);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRiskLoading(false);
      });
    return () => { cancelled = true; };
  }, [dateRange, customRange]);

  useEffect(() => {
    setExpandEvents({});
    setExpandLoading({});
  }, [dateRange, customRange.from, customRange.to]);

  const drivers: DriverProfile[] = useMemo(
    () => assessDriversFromRisk(scopedRiskRows, scopedPeriodTrips),
    [scopedRiskRows, scopedPeriodTrips],
  );
  const periodTripMap = useMemo(() => tripStatsByDriverKey(scopedPeriodTrips), [scopedPeriodTrips]);
  const hosByDriverKey = useMemo(() => {
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
  const finalOutcomeByDriverKey = useMemo(() => {
    const map = new Map<string, {
      category: ConsequenceCategory;
      driverScore: number;
      displayScore: number;
      hosPoints: number;
      hosHeldMinutes: number;
      hosImpact: number;
    }>();
    drivers.forEach(d => {
      const hos = hosByDriverKey.get(d.key) || hosByDriverKey.get((d.name || '').trim());
      const hosPoints = hos?.points ?? 0;
      const hosHeldMinutes = hos?.heldMinutes ?? 0;
      const hosImpact = hosImpactPer100Km(hosPoints, d.distanceKm);
      const driverScore = d.consequence.driverScore - hosImpact;
      map.set(d.key, {
        category: categorizeDriverScore(driverScore),
        driverScore,
        displayScore: toDisplayScore100(driverScore),
        hosPoints,
        hosHeldMinutes,
        hosImpact,
      });
    });
    return map;
  }, [drivers, hosByDriverKey]);
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

  const loadExpandEvents = (driver: DriverProfile) => {
    const url = driverEventsUrl(driver, dateRange, customRange);
    if (expandEvents[driver.key] || expandLoading[driver.key]) return;
    const cached = cachePeek<{ entries?: LogEntry[] } | LogEntry[]>(url);
    if (cached) {
      setExpandEvents(prev => ({ ...prev, [driver.key]: parseEventsLogPayload(cached) }));
      return;
    }
    setExpandLoading(prev => ({ ...prev, [driver.key]: true }));
    authCachedJson<{ entries?: LogEntry[] } | LogEntry[]>(url, authFetch, { ttlMs: CACHE_TTL.fleetEvents })
      .then(data => {
        setExpandEvents(prev => ({ ...prev, [driver.key]: parseEventsLogPayload(data) }));
      })
      .catch(() => {
        setExpandEvents(prev => ({ ...prev, [driver.key]: [] }));
      })
      .finally(() => {
        setExpandLoading(prev => ({ ...prev, [driver.key]: false }));
      });
  };

  // Deep-link ?q= — re-run when q changes (including while already on this page).
  const deepLinkQ = searchParams.get('q')?.trim() || '';
  useEffect(() => {
    if (!deepLinkQ) return;
    setSearch(deepLinkQ);
    if (drivers.length === 0) {
      setExpandedDrivers(new Set([deepLinkQ]));
      return;
    }
    const qLower = deepLinkQ.toLowerCase();
    const match = drivers.find(d =>
      d.key.toLowerCase() === qLower
      || d.name.toLowerCase() === qLower
      || displayDriverName(d.name).toLowerCase() === qLower
    );
    if (match) {
      setExpandedDrivers(new Set([match.key, match.name, deepLinkQ]));
      loadExpandEvents(match);
    } else {
      setExpandedDrivers(new Set([deepLinkQ]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deep-link + drivers ready
  }, [deepLinkQ, drivers.length]);

  const debouncedSearch = useDebouncedValue(search, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const visible = deferredSearch
    ? drivers.filter(d => d.name.toLowerCase().includes(deferredSearch.toLowerCase()) || d.regNo.toLowerCase().includes(deferredSearch.toLowerCase()))
    : drivers;

  const pagination = useClientPagination(visible, 50, deferredSearch);

  const toggle = (driver: DriverProfile) => {
    setExpandedDrivers(prev => {
      const n = new Set(prev);
      const isOpen = n.has(driver.key) || n.has(driver.name);
      if (isOpen) {
        n.delete(driver.key);
        n.delete(driver.name);
      } else {
        n.add(driver.key);
        loadExpandEvents(driver);
      }
      return n;
    });
  };

  const categoryOf = (d: DriverProfile) =>
    finalOutcomeByDriverKey.get(d.key)?.category ?? d.consequence.category;
  const redCount = drivers.filter(d => categoryOf(d) === 'Red').length;
  const watchCloselyCount = drivers.filter(d => {
    const c = categoryOf(d);
    return c === 'Yellow' || c === 'Amber';
  }).length;
  const greenCount = drivers.filter(d => categoryOf(d) === 'Green').length;

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
        <div className="bpl-kpi-card" style={{ borderTop: `2px solid ${CATEGORY_COLORS.Red}` }}>
          <div className="bpl-kpi-label">High Risk</div>
          <div className="bpl-kpi-value" style={{ color: CATEGORY_COLORS.Red }}>{seedBusy ? <SkelValue /> : redCount}</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: `2px solid ${CATEGORY_COLORS.Yellow}` }}>
          <div className="bpl-kpi-label">Watch Closely</div>
          <div className="bpl-kpi-value" style={{ color: CATEGORY_COLORS.Yellow }}>{seedBusy ? <SkelValue /> : watchCloselyCount}</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: `2px solid ${CATEGORY_COLORS.Green}` }}>
          <div className="bpl-kpi-label">Low Risk</div>
          <div className="bpl-kpi-value" style={{ color: CATEGORY_COLORS.Green }}>{seedBusy ? <SkelValue /> : greenCount}</div>
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
        <PagePeriodBar
          value={dateRange}
          onChange={setDateRange}
          customFrom={customRange.from}
          customTo={customRange.to}
          onCustomFromChange={f => setCustomRange(r => ({ ...r, from: f }))}
          onCustomToChange={t => setCustomRange(r => ({ ...r, to: t }))}
          className="dm-period-bar"
        />
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
          {pagination.pageRows.map(d => {
            const outcome = finalOutcomeByDriverKey.get(d.key);
            return (
              <DriverCard
                key={d.key}
                driver={d}
                expanded={expandedDrivers.has(d.name) || expandedDrivers.has(d.key)}
                onToggle={() => toggle(d)}
                stats={periodCardStats(d, dateRange, customRange, periodTripMap)}
                latestWarning={driverWarnings.get(d.key) ?? null}
                recentEvents={expandEvents[d.key] ?? []}
                eventsLoading={!!expandLoading[d.key]}
                hosPoints={outcome?.hosPoints ?? 0}
                hosHeldMinutes={outcome?.hosHeldMinutes ?? 0}
                hosImpact={outcome?.hosImpact ?? 0}
                displayScore={outcome?.displayScore ?? d.consequence.displayScore}
                category={outcome?.category ?? d.consequence.category}
              />
            );
          })}
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
