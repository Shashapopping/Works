import { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Moon, Search, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { isActiveDriver, isActiveDriverId, displayDriverName } from '../../lib/driverUtils';
import MockNamesBadge from '../../components/MockNamesBadge';
import InfoTip from '../../components/InfoTip';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useClientPagination } from '../../hooks/useClientPagination';
import { useHosRecords } from '../../hooks/useHosRecords';
import { fmtHosMinutes, hosHeldMinutesFromRecord, type HosRecord, type HosRuleId, type HosStatus } from '../../lib/hos';
import { hosPointsFromHeldMinutes, type FleetScoreConfig } from '../../lib/fleetSafetyScore';
import { useFleet } from '../../context/FleetContext';
import { filterHosRecordsByAssignedSite } from '../../lib/siteScope';
import { SkelValue, SkelTable } from '../../components/data/DataBusy';
import PageControls from '../../components/PageControls';

type FatigueViewFilter = 'all' | HosStatus | HosRuleId;
const FATIGUE_PAGE_SIZE = 40;
const FOUR_H_WARNING_MINUTES = 20;

type FatigueSortKey =
  | 'driver'
  | 'site'
  | 'driveTimeToday'
  | 'presentBlock'
  | 'driveLeft'
  | 'violationValue'
  | 'since8hRest'
  | 'dailyHoursLeft'
  | 'weeklyRest'
  | 'weeklyHoursLeft'
  | 'hosPoints';
type FatigueSortDir = 'asc' | 'desc';
type FatigueSortState = { key: FatigueSortKey; dir: FatigueSortDir } | null;

const RULE_MEANING: Record<'violation' | HosRuleId, { title: string; body: string }> = {
  violation: {
    title: 'HOS violation',
    body: 'This driver is over at least one hours-of-service limit. Park for a qualifying rest, then check 4h continuous, daily rest, and weekly rest.',
  },
  '4h_continuous': {
    title: '4-hour continuous driving',
    body: 'They drove more than 4 hours without a 20-minute rest. Park now and take a 20-minute break to reset the block.',
  },
  '8h_24h': {
    title: 'Daily rest',
    body: 'It has been 24 hours or more since the driver last had an 8-hour continuous rest. Do not assign another long block until they have recovered.',
  },
  weekly_rest: {
    title: 'Weekly rest miss',
    body: 'No 24-hour continuous off-duty rest in the last 7 days. Schedule a full day off before the next shift.',
  },
};

/** Lagos (UTC+1) calendar date, N days back, as YYYY-MM-DD. */
function lagosDateStr(daysBack = 0) {
  return new Date(Date.now() + 60 * 60 * 1000 - daysBack * 86400000).toISOString().slice(0, 10);
}

const STATUS_META: Record<HosStatus, { label: string; bg: string; color: string }> = {
  compliant: { label: 'Compliant', bg: 'rgba(22,163,74,0.12)', color: '#16a34a' },
  warning: { label: 'At risk', bg: 'rgba(217,119,6,0.12)', color: '#d97706' },
  violation: { label: 'Violation', bg: 'rgba(204,0,0,0.12)', color: '#CC0000' },
};

const COL_TIPS: Record<string, string> = {
  Driver: 'Driver name from completed trips.',
  Site: 'Driver roster site from MiX (the driver’s assigned site, not the truck they last drove).',
  '4h continuous': 'Max 4 hours continuous driving. A parked gap of ≥20 minutes resets the block.',
  'Daily rest': 'Driver needs at least 8 hours continuous rest inside each rolling 24-hour cycle.',
  'Weekly rest': 'At least 24 hours continuous off-duty rest required in every rolling 7-day week.',
  'Drive time today': 'Total minutes driven today, clipped to the current Lagos calendar day.',
  'Trip time': 'Sum of each trip’s clock time inside the selected day (clipped at midnight). Gaps between trips are not counted — so an overnight open trip cannot stretch Trip time to ~23h.',
  'Violation value': 'Extra driving minutes past the 4-hour continuous limit.',
  'Violation trip': 'Clock time from when they hit 4 hours until that driving block ended.',
  'Present Block': 'How full the continuous drive block is toward 4 hours. The time under the bar is the actual minutes in the block. Resets after a >=20 min rest.',
  'Drive left': 'Time left before the 4h continuous-driving breach. Negative time means the 4h limit has already been passed.',
  'Since 8h rest': 'Elapsed time since the last >=8h continuous rest ended. The bar breaches at 24h and can show over 100%.',
  '24h rest': 'Rolling 7-day lookback ending now. Green marks the qualifying 24-hour rest block; all red means no 24-hour rest was found.',
  'Hours left': 'Time left before the relevant rest deadline. For weekly rest this is the 144-hour start point for the required 24h rest.',
  'HOS points': 'HOS score = floor(over-limit minutes ÷ slice length) × points per slice. Default: 1 point for every full 10 minutes past the 4h continuous, daily-rest, or weekly-rest limits (minutes from all three rules are added first). Same rule feeds the Drivers page score. Slice length and points are adjustable in Settings → Scoring.',
  Time: 'When the driver crossed the 4-hour continuous limit.',
};

type HosColGroup = '4h' | 'daily' | 'weekly';

const HOS_GROUPS: {
  id: HosColGroup;
  title: string;
  className: string;
  fields: { label: string; align: 'left' | 'right' | 'center'; sortKey: FatigueSortKey }[];
}[] = [
  {
    id: '4h',
    title: '4h continuous',
    className: 'bpl-fatigue-group-4h',
    fields: [
      { label: 'Drive time today', align: 'right', sortKey: 'driveTimeToday' },
      { label: 'Present Block', align: 'right', sortKey: 'presentBlock' },
      { label: 'Drive left', align: 'right', sortKey: 'driveLeft' },
    ],
  },
  {
    id: 'daily',
    title: 'Daily rest',
    className: 'bpl-fatigue-group-daily',
    fields: [
      { label: 'Since 8h rest', align: 'right', sortKey: 'since8hRest' },
      { label: 'Hours left', align: 'right', sortKey: 'dailyHoursLeft' },
    ],
  },
  {
    id: 'weekly',
    title: 'Weekly rest',
    className: 'bpl-fatigue-group-weekly',
    fields: [
      { label: '24h rest', align: 'center', sortKey: 'weeklyRest' },
      { label: 'Hours left', align: 'right', sortKey: 'weeklyHoursLeft' },
    ],
  },
];

const HOS_FIELD_COUNT = HOS_GROUPS.reduce((n, g) => n + g.fields.length, 0);
const TABLE_COL_COUNT = 2 + HOS_FIELD_COUNT + 1;

function scrubHosRecords(list: HosRecord[]): HosRecord[] {
  return list;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtSignedHosMinutes(min: number) {
  if (min < 0) return `-${fmtHosMinutes(Math.abs(min))}`;
  return fmtHosMinutes(min);
}

function fmtDaysHours(min: number) {
  const totalHours = Math.round(Math.max(0, min) / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}d ${hours}h`;
}

function fmtSignedHours(min: number) {
  const sign = min < 0 ? '-' : '';
  const totalMin = Math.round(Math.abs(min));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return minutes ? `${sign}${hours}h ${minutes}m` : `${sign}${hours}h`;
}

function fmtPoints(value: number) {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

type HosPointDetail = {
  hosHeldMinutes: number;
  hosPoints: number;
  infractions: { key: string; label: string; detail: string }[];
  breakdown: string;
};

const EMPTY_HOS_POINT_DETAIL: HosPointDetail = {
  hosHeldMinutes: 0,
  hosPoints: 0,
  infractions: [],
  breakdown: 'No HOS infractions',
};

function buildHosPointDetail(pointRecord: HosRecord | undefined, scoreConfig: FleetScoreConfig): HosPointDetail {
  if (!pointRecord) return EMPTY_HOS_POINT_DETAIL;
  const pointDailyRestWindow = pointRecord.dailyRestWindowMinutes || 1440;
  const pointDailyRestElapsed = pointRecord.dailyRestElapsedMinutes ?? pointRecord.minutesSinceDailyRest ?? (7 * 24 * 60);
  const pointWeeklyRestWindow = pointRecord.weeklyRestWindowMinutes || (7 * 24 * 60);
  const pointWeeklyRestElapsed = pointRecord.weeklyRestElapsedMinutes
    ?? (pointRecord.daysSinceWeeklyRest == null ? pointWeeklyRestWindow : pointRecord.daysSinceWeeklyRest * 24 * 60);
  const fourHOverMinutes = Math.max(0, pointRecord.violationDriveMinutes ?? 0);
  const dailyOverMinutes = Math.max(0, pointDailyRestElapsed - pointDailyRestWindow);
  const weeklyOverMinutes = Math.max(0, pointWeeklyRestElapsed - pointWeeklyRestWindow);
  const hosHeldMinutes = hosHeldMinutesFromRecord(pointRecord);
  const hosPoints = hosPointsFromHeldMinutes(hosHeldMinutes, scoreConfig);
  const infractions = [
    fourHOverMinutes > 0 ? { key: '4h', label: '4H', detail: fmtHosMinutes(fourHOverMinutes) } : null,
    dailyOverMinutes > 0 ? { key: 'daily', label: 'Daily', detail: fmtHosMinutes(dailyOverMinutes) } : null,
    weeklyOverMinutes > 0 ? { key: 'weekly', label: 'Weekly', detail: fmtDaysHours(weeklyOverMinutes) } : null,
  ].filter(Boolean) as HosPointDetail['infractions'];
  return {
    hosHeldMinutes,
    hosPoints,
    infractions,
    breakdown: infractions.length ? infractions.map(i => `${i.label}: ${i.detail}`).join(' | ') : 'No HOS infractions',
  };
}

function compactDateLabel(day: string) {
  return new Date(day + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function hosDayOptionLabel(day: string, daysBack: number) {
  if (daysBack === 0) return 'Today';
  if (daysBack === 1) return 'Yesterday';
  return new Date(day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function limitOf(record: HosRecord) {
  return record.driveLimitMinutes || 240;
}

function currentBlockMinutes(record: HosRecord) {
  if (record.currentBlockMinutes != null) return Math.max(0, record.currentBlockMinutes);
  return Math.max(0, record.continuousMinutes ?? 0);
}

function displayBlockMinutes(record: HosRecord, isTodayView: boolean) {
  const current = currentBlockMinutes(record);
  if (isTodayView) return current;
  return Math.max(current, record.continuousMinutes ?? 0, record.maxContinuousMinutes ?? 0);
}

function dailyRestElapsedOf(record: HosRecord) {
  return record.dailyRestElapsedMinutes ?? record.minutesSinceDailyRest ?? (7 * 24 * 60);
}

function dailyRestLeftOf(record: HosRecord) {
  return (record.dailyRestWindowMinutes || 1440) - dailyRestElapsedOf(record);
}

function weeklyRestElapsedOf(record: HosRecord) {
  const weeklyRestWindow = record.weeklyRestWindowMinutes || (7 * 24 * 60);
  return record.weeklyRestElapsedMinutes
    ?? (record.daysSinceWeeklyRest == null ? weeklyRestWindow : record.daysSinceWeeklyRest * 24 * 60);
}

function weeklyRestLeftOf(record: HosRecord) {
  const weeklyRestWindow = record.weeklyRestWindowMinutes || (7 * 24 * 60);
  const weeklyRestRequired = record.weeklyRestRequiredMinutes || (24 * 60);
  const weeklyRestStartDeadline = Math.max(0, weeklyRestWindow - weeklyRestRequired);
  return weeklyRestStartDeadline - weeklyRestElapsedOf(record);
}

function fatigueSortValue(
  record: HosRecord,
  key: FatigueSortKey,
  isTodayView: boolean,
  hosDetail: HosPointDetail,
): string | number {
  if (key === 'driver') return displayDriverName(record.driverName).toLowerCase();
  if (key === 'site') return (record.site || '').toLowerCase();
  if (key === 'driveTimeToday') return record.driveMinutesToday || 0;
  if (key === 'presentBlock') return displayBlockMinutes(record, isTodayView);
  if (key === 'driveLeft') return limitOf(record) - displayBlockMinutes(record, isTodayView);
  if (key === 'violationValue') return record.violationDriveMinutes || 0;
  if (key === 'since8hRest') return dailyRestElapsedOf(record);
  if (key === 'dailyHoursLeft') return dailyRestLeftOf(record);
  if (key === 'weeklyRest') return weeklyRestElapsedOf(record);
  if (key === 'weeklyHoursLeft') return weeklyRestLeftOf(record);
  if (key === 'hosPoints') return hosDetail.hosPoints;
  return 0;
}

function pctOfLimit(minutes: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((minutes / limit) * 100));
}

function rawPctOfLimit(minutes: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.max(0, Math.round((minutes / limit) * 100));
}

function meterColor(minutes: number, limit: number, fallbackStatus?: HosStatus) {
  if (minutes >= limit) return '#CC0000';
  if (minutes >= limit - FOUR_H_WARNING_MINUTES) return '#d97706';
  if (fallbackStatus === 'violation') return '#CC0000';
  if (fallbackStatus === 'warning') return '#d97706';
  return '#16a34a';
}

function dailyRestProgressColor(minutes: number, limit: number) {
  if (minutes >= limit) return '#CC0000';
  if (minutes >= limit - 240) return '#d97706';
  return '#16a34a';
}

function isDailyRestViolation(record: HosRecord) {
  return record.dailyRestViolation ?? record.cycle8hViolation ?? false;
}

function hasAnyBreach(record: HosRecord) {
  return (record.breaches ?? 0) >= 1
    || record.status === 'violation'
    || isDailyRestViolation(record)
    || record.weeklyRestOk === false;
}

function hasRule(record: HosRecord, rule: HosRuleId) {
  if (record.rulesBreached?.includes(rule)) return true;
  if (rule === '4h_continuous') return (record.breaches ?? 0) >= 1;
  if (rule === '8h_24h') return isDailyRestViolation(record);
  if (rule === 'weekly_rest') return record.weeklyRestOk === false;
  return false;
}

function FatigueMeter({
  minutes,
  limit,
  color,
  title,
  className,
  showTime,
  allowOverLimitPct,
  overLimitVisualMaxPct,
  formatTime = fmtHosMinutes,
}: {
  minutes: number;
  limit: number;
  color: string;
  title: string;
  className?: string;
  showTime?: boolean;
  allowOverLimitPct?: boolean;
  overLimitVisualMaxPct?: number;
  formatTime?: (minutes: number) => string;
}) {
  const pct = allowOverLimitPct ? rawPctOfLimit(minutes, limit) : pctOfLimit(minutes, limit);
  const visualMaxPct = overLimitVisualMaxPct && overLimitVisualMaxPct > 100 ? overLimitVisualMaxPct : 100;
  const fillPct = allowOverLimitPct && visualMaxPct > 100
    ? Math.min(100, Math.round((pct / visualMaxPct) * 100))
    : pctOfLimit(minutes, limit);
  const breachMarkerPct = allowOverLimitPct && visualMaxPct > 100
    ? Math.min(100, Math.round((100 / visualMaxPct) * 100))
    : null;
  return (
    <td className={className} title={title}>
      <div className="bpl-fatigue-meter">
        <div className="bpl-fatigue-meter-row">
          <div className="bpl-fatigue-meter-track">
            <div className="bpl-fatigue-meter-fill" style={{ width: `${fillPct}%`, background: color }} />
            {breachMarkerPct != null && (
              <span className="bpl-fatigue-meter-marker" style={{ left: `${breachMarkerPct}%` }} />
            )}
          </div>
          <span>{pct}%</span>
        </div>
        {showTime && (
          <div className="bpl-fatigue-meter-time">{formatTime(minutes)}</div>
        )}
      </div>
    </td>
  );
}

function WeeklyRestCalendar({ record }: { record: HosRecord }) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const fallbackEnd = Date.parse(record.lastUpdated || '') || Date.now();
  const endMs = Date.parse(record.weeklyRestLookbackEnd || '') || fallbackEnd;
  const startMs = Date.parse(record.weeklyRestLookbackStart || '') || (endMs - 7 * DAY_MS);
  const explicitRestStartMs = Date.parse(record.weeklyRestStart || '');
  const explicitRestEndMs = Date.parse(record.weeklyRestEnd || '');
  const fallbackRestEndMs = record.minutesSinceWeeklyRest != null && record.weeklyRestOk !== false
    ? endMs - record.minutesSinceWeeklyRest * 60 * 1000
    : NaN;
  const restEndMs = Number.isFinite(explicitRestEndMs) ? explicitRestEndMs : fallbackRestEndMs;
  const restStartMs = Number.isFinite(explicitRestStartMs)
    ? explicitRestStartMs
    : restEndMs - (record.weeklyRestRequiredMinutes || 24 * 60) * 60 * 1000;
  const hasRest = Number.isFinite(restStartMs) && Number.isFinite(restEndMs) && restEndMs > restStartMs;
  const span = Math.max(DAY_MS, endMs - startMs);
  const cellMs = span / 7;
  const sinceLabel = record.minutesSinceWeeklyRest == null
    ? 'No 24h rest in 7d'
    : `${fmtDaysHours(record.weeklyRestElapsedMinutes ?? record.minutesSinceWeeklyRest)} since`;
  const title = hasRest
    ? `24h weekly rest: ${new Date(restStartMs).toLocaleString()} to ${new Date(restEndMs).toLocaleString()}`
    : 'No >=24h continuous rest found in the last 7 days.';

  return (
    <td className="bpl-fatigue-td-weekly bpl-fatigue-week-calendar-cell bpl-fatigue-field-start" title={title}>
      <div className={`bpl-fatigue-week-calendar${hasRest ? '' : ' is-missed'}`}>
        {Array.from({ length: 7 }, (_, i) => {
          const cellStart = startMs + i * cellMs;
          const cellEnd = i === 6 ? endMs : cellStart + cellMs;
          const overlapStart = hasRest ? Math.max(cellStart, restStartMs) : 0;
          const overlapEnd = hasRest ? Math.min(cellEnd, restEndMs) : 0;
          const overlapMs = Math.max(0, overlapEnd - overlapStart);
          const left = overlapMs > 0 ? ((overlapStart - cellStart) / (cellEnd - cellStart)) * 100 : 0;
          const width = overlapMs > 0 ? (overlapMs / (cellEnd - cellStart)) * 100 : 0;
          const labelDate = new Date(i === 6 ? endMs : cellStart + 12 * 60 * 60 * 1000);
          const label = i === 6
            ? 'Now'
            : labelDate.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3);
          return (
            <div key={i} className="bpl-fatigue-week-day">
              {hasRest && width > 0 && (
                <span className="bpl-fatigue-week-rest" style={{ left: `${left}%`, width: `${width}%` }} />
              )}
              <span className="bpl-fatigue-week-label">{label}</span>
            </div>
          );
        })}
      </div>
      <div className={`bpl-fatigue-week-caption${hasRest ? '' : ' is-missed'}`}>{sinceLabel}</div>
    </td>
  );
}

function SortIndicator({ dir }: { dir: FatigueSortDir }) {
  const Icon = dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: 999,
        background: 'rgba(0,120,212,0.12)',
        color: '#0078D4',
        border: '1px solid rgba(0,120,212,0.28)',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <Icon size={11} strokeWidth={2.5} />
    </span>
  );
}

function ThLabel({
  label,
  align = 'left',
  className,
  rowSpan,
  colSpan,
  sortKey,
  sortState,
  onSort,
}: {
  label: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  rowSpan?: number;
  colSpan?: number;
  sortKey?: FatigueSortKey;
  sortState?: FatigueSortState;
  onSort?: (key: FatigueSortKey) => void;
}) {
  const sortDir = sortKey && sortState?.key === sortKey ? sortState.dir : null;
  const content = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start' }}>
      {label}
      {sortDir && <SortIndicator dir={sortDir} />}
      {COL_TIPS[label] && <InfoTip text={COL_TIPS[label]} label={label} />}
    </span>
  );
  return (
    <th
      rowSpan={rowSpan}
      colSpan={colSpan}
      className={className}
      style={{ textAlign: align }}
      aria-sort={sortDir ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          style={{
            appearance: 'none',
            border: 0,
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontWeight: 'inherit',
            padding: 0,
            cursor: 'pointer',
            width: '100%',
            textAlign: align,
          }}
          title={`Sort ${label} ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
        >
          {content}
        </button>
      ) : content}
    </th>
  );
}

export default function FatigueManagementPage() {
  const {
    scoreConfig,
    vehicles,
    selectedSites,
    hosRecords: ctxHos,
    hosLoading: ctxHosLoading,
    hosLastTripDay: ctxLastTripDay,
  } = useFleet();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const [statusFilter, setStatusFilter] = useState<FatigueViewFilter>('all');
  const [hosPointsDate, setHosPointsDate] = useState(lagosDateStr(0));
  const [sortState, setSortState] = useState<FatigueSortState>(null);
  const todayDate = lagosDateStr(0);
  const targetDate = todayDate;
  const isTodayView = true;
  const hosRaw = ctxHos;
  const hosLoading = ctxHosLoading && hosRaw.length === 0;
  const lastTripDay = ctxLastTripDay;
  const isPointsToday = hosPointsDate === todayDate;
  const { records: fetchedPoints, loading: fetchedPointsLoading } = useHosRecords(
    hosPointsDate,
    { enabled: !isPointsToday },
  );
  const hosPointsRaw = isPointsToday ? ctxHos : fetchedPoints;
  const hosPointsLoading = isPointsToday ? hosLoading : fetchedPointsLoading;

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) setSearch(q);
  }, [searchParams]);

  const siteFilterActive = selectedSites.length > 0;

  const hosRecords = useMemo(() => {
    const activeRecords = scrubHosRecords(hosRaw).filter(r => {
      if (r.id) return isActiveDriverId(r.id);
      return isActiveDriver(r.driverName, null);
    });
    return filterHosRecordsByAssignedSite(activeRecords, vehicles, siteFilterActive);
  }, [hosRaw, vehicles, siteFilterActive]);

  const scopedHosPointsRecords = useMemo(
    () => filterHosRecordsByAssignedSite(scrubHosRecords(hosPointsRaw), vehicles, siteFilterActive),
    [hosPointsRaw, vehicles, siteFilterActive],
  );

  const hosPointDetailsByKey = useMemo(() => {
    const map = new Map<string, HosPointDetail>();
    const add = (key: string | null | undefined, detail: HosPointDetail) => {
      const k = (key || '').trim();
      if (k && !map.has(k)) map.set(k, detail);
    };
    scopedHosPointsRecords
      .filter(r => (r.id ? isActiveDriverId(r.id) : isActiveDriver(r.driverName, null)))
      .forEach(r => {
        const detail = buildHosPointDetail(r, scoreConfig);
        add(r.id, detail);
        add(r.driverName, detail);
      });
    return map;
  }, [scopedHosPointsRecords, scoreConfig]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const list = hosRecords.filter(r => {
      if (statusFilter === 'violation') {
        if (!hasAnyBreach(r)) return false;
      } else if (statusFilter === '4h_continuous' || statusFilter === '8h_24h' || statusFilter === 'weekly_rest') {
        if (!hasRule(r, statusFilter)) return false;
      } else if (statusFilter !== 'all') {
        if (r.status !== statusFilter) return false;
      }
      if (!q) return true;
      return (
        r.driverName.toLowerCase().includes(q)
        || r.vehicleReg.toLowerCase().includes(q)
        || r.site.toLowerCase().includes(q)
      );
    });
    if (sortState) {
      list.sort((a, b) => {
        const aDetail = hosPointDetailsByKey.get(a.id)
          || hosPointDetailsByKey.get((a.driverName || '').trim())
          || EMPTY_HOS_POINT_DETAIL;
        const bDetail = hosPointDetailsByKey.get(b.id)
          || hosPointDetailsByKey.get((b.driverName || '').trim())
          || EMPTY_HOS_POINT_DETAIL;
        const av = fatigueSortValue(a, sortState.key, isTodayView, aDetail);
        const bv = fatigueSortValue(b, sortState.key, isTodayView, bDetail);
        const cmp = typeof av === 'string' || typeof bv === 'string'
          ? String(av).localeCompare(String(bv))
          : av - bv;
        return sortState.dir === 'asc' ? cmp : -cmp;
      });
    } else {
      list.sort((a, b) => {
        const ba = a.breaches ?? 0, bb = b.breaches ?? 0;
        if (ba !== bb) return bb - ba;
        const ca = a.continuousMinutes ?? 0, cb = b.continuousMinutes ?? 0;
        if (ca !== cb) return cb - ca;
        return b.driveMinutesToday - a.driveMinutesToday;
      });
    }
    return list;
  }, [hosRecords, deferredSearch, statusFilter, sortState, hosPointDetailsByKey, isTodayView]);

  const pagination = useClientPagination(
    filtered,
    FATIGUE_PAGE_SIZE,
    `${targetDate}|${hosPointsDate}|${statusFilter}|${deferredSearch}|${sortState?.key || 'default'}|${sortState?.dir || ''}`,
  );

  const counts = useMemo(() => ({
    fourH: hosRecords.filter(r => hasRule(r, '4h_continuous')).length,
    compliant: hosRecords.filter(r => r.status === 'compliant').length,
    warning: hosRecords.filter(r => r.status === 'warning').length,
    violation: isTodayView
      ? hosRecords.filter(r => r.status === 'violation').length
      : hosRecords.filter(r => (r.breaches ?? 0) > 0 || isDailyRestViolation(r) || r.weeklyRestOk === false).length,
    dailyRest: hosRecords.filter(isDailyRestViolation).length,
    weeklyRest: hosRecords.filter(r => r.weeklyRestOk === false).length,
  }), [hosRecords, isTodayView]);

  const violationHistoryRows = useMemo(() => {
    if (statusFilter !== 'violation' && statusFilter !== '4h_continuous') return [];
    const rows: {
      key: string;
      driverName: string;
      vehicleReg: string;
      site: string;
      breachAt: string;
      violationDriveMinutes: number;
      violationTripMinutes: number;
    }[] = [];
    for (const r of filtered) {
      for (const ev of r.violationHistory ?? []) {
        rows.push({
          key: `${r.id}-${ev.breachAt}`,
          driverName: r.driverName,
          vehicleReg: r.vehicleReg,
          site: r.site,
          breachAt: ev.breachAt,
          violationDriveMinutes: ev.violationDriveMinutes,
          violationTripMinutes: ev.violationTripMinutes,
        });
      }
    }
    rows.sort((a, b) => new Date(b.breachAt).getTime() - new Date(a.breachAt).getTime());
    return rows;
  }, [filtered, statusFilter]);
  const violationPagination = useClientPagination(
    violationHistoryRows,
    FATIGUE_PAGE_SIZE,
    `${targetDate}|${statusFilter}|${deferredSearch}|violations`,
  );

  const toggleFilter = (next: FatigueViewFilter) => {
    setStatusFilter(prev => (prev === next ? 'all' : next));
  };

  const toggleSort = (key: FatigueSortKey) => {
    setSortState(prev => {
      if (prev?.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'desc' };
    });
  };

  type FatigueKpiCard = {
    key: FatigueViewFilter;
    label: string;
    value: number;
    hint: string;
    color: string;
    icon: typeof Moon;
  };

  const kpiCards: FatigueKpiCard[] = [
    {
      key: 'all',
      label: 'Drivers tracked',
      value: hosRecords.length,
      hint: isTodayView ? 'On duty / HOS window' : 'Drove this day',
      color: '#0078D4',
      icon: Moon,
    },
    {
      key: 'warning',
      label: 'At risk',
      value: counts.warning,
      hint: isTodayView ? 'Near 4h or rest' : 'Approached limit',
      color: '#d97706',
      icon: Clock,
    },
    {
      key: 'violation',
      label: 'Violations',
      value: counts.violation,
      hint: '4h / daily / weekly',
      color: '#CC0000',
      icon: AlertTriangle,
    },
    {
      key: 'compliant',
      label: 'Compliant',
      value: counts.compliant,
      hint: 'Under all HOS rules',
      color: '#16a34a',
      icon: CheckCircle,
    },
  ];

  const ruleCards: FatigueKpiCard[] = [
    {
      key: '4h_continuous',
      label: '4H',
      value: counts.fourH,
      hint: 'Continuous drive breach',
      color: '#CC0000',
      icon: AlertTriangle,
    },
    {
      key: '8h_24h',
      label: 'Daily rest',
      value: counts.dailyRest,
      hint: 'No 8h rest in 24h',
      color: '#b45309',
      icon: AlertTriangle,
    },
    {
      key: 'weekly_rest',
      label: 'Weekly rest',
      value: counts.weeklyRest,
      hint: 'No 24h rest in 7d',
      color: '#7c3aed',
      icon: Moon,
    },
  ];

  const ruleFocus = statusFilter === '4h_continuous' || statusFilter === '8h_24h' || statusFilter === 'weekly_rest' || statusFilter === 'violation'
    ? statusFilter
    : null;
  const showAtRiskBanner = statusFilter === 'warning';
  const tableFocusClass = statusFilter === '4h_continuous'
    ? ' bpl-fatigue-focus-4h'
    : statusFilter === '8h_24h'
      ? ' bpl-fatigue-focus-daily'
      : statusFilter === 'weekly_rest'
        ? ' bpl-fatigue-focus-weekly'
        : '';
  const hosDayOptions = useMemo(
    () => {
      const opts = Array.from({ length: 7 }, (_, daysBack) => {
        const day = lagosDateStr(daysBack);
        return { day, label: hosDayOptionLabel(day, daysBack) };
      });
      if (!opts.some(opt => opt.day === hosPointsDate)) {
        opts.push({ day: hosPointsDate, label: compactDateLabel(hosPointsDate) });
      }
      return opts;
    },
    [hosPointsDate],
  );
  const onHosDayChange = (day: string) => {
    setHosPointsDate(day);
  };

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Moon size={18} color="#7c3aed" />
        Driver Management — Fatigue Management <MockNamesBadge />
      </div>
      <p style={{ fontSize: 13, color: 'var(--cd-text-muted)', marginBottom: 16 }}>
        Hours of service — 4h continuous (20-min rest resets), daily rest (8h rest in 24h), and weekly rest (at least 24h off in 7 days).
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>
          HOS points are inspected from {compactDateLabel(hosPointsDate)}; the rest of the table keeps today.
        </span>
      </div>

      {!hosLoading && hosRaw.length === 0 && lastTripDay && lastTripDay !== targetDate && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 8,
          border: '1px solid rgba(217,119,6,0.35)', background: 'rgba(217,119,6,0.08)',
          fontSize: 13, color: 'var(--cd-text)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        }}>
          <span>
            No trips synced for {compactDateLabel(targetDate)}.
            Latest trip day in the database is{' '}
            <strong>{new Date(lastTripDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>.
          </span>
        </div>
      )}

      {!hosLoading && hosRaw.length === 0 && (!lastTripDay || lastTripDay === targetDate) && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 8,
          border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)',
          fontSize: 13, color: 'var(--cd-text-muted)',
        }}>
          No trips for this day yet. HOS is built from trip history — live vehicle positions can still show Moving while trips catch up.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 12 }}>
        {kpiCards.map(k => {
          const active = statusFilter === k.key;
          return (
            <button
              key={k.key}
              type="button"
              className={`bpl-fatigue-kpi${active ? ' active' : ''}`}
              style={{
                padding: '14px 16px', borderRadius: 10,
                background: `linear-gradient(180deg, ${k.color}0d, var(--cd-surface) 55%)`,
                border: active ? `1.5px solid ${k.color}` : '1px solid var(--cd-border)',
                borderTop: `3px solid ${k.color}`,
                ['--fatigue-kpi-color' as string]: k.color,
              }}
              onClick={() => toggleFilter(k.key)}
              aria-pressed={active}
              title={`Show ${k.label.toLowerCase()}`}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{k.label}</div>
                <k.icon size={14} style={{ color: k.color, opacity: 0.75, flexShrink: 0, marginTop: 1 }} />
              </div>
              <div
                style={{
                  fontSize: 20, fontWeight: 700, color: k.color,
                  animation: k.key === 'violation' && counts.violation > 0 ? 'pulse 1.5s infinite' : 'none',
                }}
              >
                {hosLoading ? <SkelValue /> : k.value}
              </div>
              <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 2 }}>{k.hint}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        {ruleCards.map(k => {
          const active = statusFilter === k.key;
          return (
            <button
              key={k.key}
              type="button"
              className={`bpl-fatigue-kpi${active ? ' active' : ''}`}
              style={{
                padding: '14px 16px', borderRadius: 10,
                background: active ? 'var(--cd-surface-2)' : 'var(--cd-surface)',
                border: active ? '1.5px solid rgba(100,116,139,0.65)' : '1px solid var(--cd-border)',
                borderTop: '1px solid var(--cd-border)',
                ['--fatigue-kpi-color' as string]: '#64748b',
              }}
              onClick={() => toggleFilter(k.key)}
              aria-pressed={active}
              title={`Show ${k.label.toLowerCase()}`}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{k.label}</div>
                <k.icon size={14} style={{ color: 'var(--cd-text-muted)', opacity: 0.65, flexShrink: 0, marginTop: 1 }} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cd-text)' }}>
                {hosLoading ? <SkelValue /> : k.value}
              </div>
              <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 2 }}>{k.hint}</div>
            </button>
          );
        })}
      </div>

      <div className="bpl-card bpl-fatigue-toolbar">
        <div className="bpl-fatigue-search">
          <Search size={15} />
          <input
            type="search"
            placeholder="Search driver, vehicle, site…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search fatigue records"
          />
        </div>
        <div className="bpl-fatigue-filters">
          {(['all', 'compliant', 'warning', 'violation'] as const).map(s => (
            <button
              key={s}
              type="button"
              className={`bpl-fatigue-filter-btn${statusFilter === s ? ' active' : ''}`}
              onClick={() => toggleFilter(s)}
            >
              {s === 'all' ? 'All' : STATUS_META[s].label}
            </button>
          ))}
        </div>
      </div>

      {ruleFocus && (
        <div style={{
          margin: '0 2px 10px', padding: '10px 14px', borderRadius: 8,
          border: '1px solid rgba(204,0,0,0.28)', background: 'rgba(204,0,0,0.06)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#CC0000', marginBottom: 2 }}>
            {RULE_MEANING[ruleFocus].title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--cd-text)', lineHeight: 1.45 }}>
            {RULE_MEANING[ruleFocus].body}
          </div>
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginTop: 6 }}>
            Showing {filtered.length} driver{filtered.length === 1 ? '' : 's'} in this view. Click the badge again to clear.
          </div>
        </div>
      )}

      {showAtRiskBanner && (
        <div style={{
          margin: '0 2px 10px', padding: '10px 14px', borderRadius: 8,
          border: '1px solid rgba(217,119,6,0.3)', background: 'rgba(217,119,6,0.07)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#d97706', marginBottom: 2 }}>
            Act now
          </div>
          <div style={{ fontSize: 12, color: 'var(--cd-text)', lineHeight: 1.45 }}>
            These drivers are approaching a rest or driving limit. Plan recovery before they move into violation.
          </div>
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginTop: 6 }}>
            Showing {filtered.length} at-risk driver{filtered.length === 1 ? '' : 's'} in this view. Click At risk again to clear.
          </div>
        </div>
      )}

      <div className="bpl-card bpl-table-scroll" style={{ padding: 0 }}>
        <table className={`bpl-dispatch-table bpl-fatigue-table${tableFocusClass}`}>
          <thead>
            <tr className="bpl-fatigue-group-row">
              <ThLabel
                label="Driver"
                className="bpl-fatigue-th-identity"
                rowSpan={2}
                sortKey="driver"
                sortState={sortState}
                onSort={toggleSort}
              />
              <ThLabel
                label="Site"
                className="bpl-fatigue-th-identity"
                rowSpan={2}
                sortKey="site"
                sortState={sortState}
                onSort={toggleSort}
              />
              {HOS_GROUPS.map(g => (
                <ThLabel
                  key={g.id}
                  label={g.title}
                  align="center"
                  colSpan={g.fields.length}
                  className={`bpl-fatigue-group ${g.className}`}
                />
              ))}
              <th
                rowSpan={2}
                className="bpl-fatigue-th-status bpl-fatigue-hos-points-head"
                aria-sort={sortState?.key === 'hosPoints' ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                <span className="bpl-fatigue-hos-head-wrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('hosPoints')}
                    style={{
                      appearance: 'none',
                      border: 0,
                      background: 'transparent',
                      color: 'inherit',
                      font: 'inherit',
                      fontWeight: 'inherit',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                    title={`Sort HOS points ${sortState?.key === 'hosPoints' && sortState.dir === 'asc' ? 'descending' : 'ascending'}`}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                      HOS points
                      {sortState?.key === 'hosPoints' && <SortIndicator dir={sortState.dir} />}
                      <InfoTip
                        text={`HOS score = floor(over-limit minutes ÷ ${scoreConfig.hosSliceMinutes}) × ${scoreConfig.hosPointsPer10Min}. Over-limit minutes are the sum of time past the 4h continuous, daily-rest, and weekly-rest limits. Default is 1 point for every full 10 minutes held. Same points reduce the Drivers page score (normalized per 100 km). Change slice length / points in Settings → Scoring.`}
                        label="HOS points"
                      />
                    </span>
                  </button>
                  <select
                    className="bpl-fatigue-hos-day-select"
                    value={hosPointsDate}
                    onChange={e => onHosDayChange(e.target.value)}
                    aria-label="Inspect HOS points day"
                  >
                    {hosDayOptions.map(opt => (
                      <option key={opt.day} value={opt.day}>{opt.label}</option>
                    ))}
                  </select>
                </span>
              </th>
            </tr>
            <tr className="bpl-fatigue-field-row">
              {HOS_GROUPS.map(g =>
                g.fields.map((f, i) => (
                  <ThLabel
                    key={`${g.id}-${f.label}`}
                    label={f.label}
                    align={f.align}
                    className={`bpl-fatigue-field-${g.id}${i === 0 ? ' bpl-fatigue-field-start' : ''}`}
                    sortKey={f.sortKey}
                    sortState={sortState}
                    onSort={toggleSort}
                  />
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {hosLoading ? (
              <tr>
                <td colSpan={TABLE_COL_COUNT} style={{ padding: 12 }}><SkelTable rows={5} /></td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COL_COUNT} style={{ textAlign: 'center', padding: 28, color: 'var(--cd-text-muted)' }}>
                  No drivers match your filters.
                </td>
              </tr>
            ) : pagination.pageRows.map(record => {
              const limit = limitOf(record);
              const currentMin = displayBlockMinutes(record, isTodayView);
              const driveMinutesLeft = limit - currentMin;
              const dailyRestWindow = record.dailyRestWindowMinutes || 1440;
              const dailyRestElapsed = dailyRestElapsedOf(record);
              const dailyRestMinutesLeft = dailyRestLeftOf(record);
              const weeklyRestMinutesLeft = weeklyRestLeftOf(record);
              const hosDetail = hosPointDetailsByKey.get(record.id)
                || hosPointDetailsByKey.get((record.driverName || '').trim())
                || EMPTY_HOS_POINT_DETAIL;
              const { hosHeldMinutes, hosPoints, infractions: hosInfractions, breakdown: hosBreakdown } = hosDetail;
              return (
                <tr key={record.id}>
                  <td className="bpl-fatigue-cell-name" title={displayDriverName(record.driverName)}>
                    <strong>{displayDriverName(record.driverName)}</strong>
                  </td>
                  <td className="bpl-fatigue-cell-clip" title={record.site || undefined}>{record.site || '—'}</td>

                  {/* 4h continuous */}
                  <td
                    className="bpl-fatigue-td-4h bpl-fatigue-field-start"
                    style={{ textAlign: 'right' }}
                    title={COL_TIPS['Drive time today']}
                  >
                    {fmtHosMinutes(record.driveMinutesToday)}
                  </td>
                  <FatigueMeter
                    className="bpl-fatigue-td-4h bpl-fatigue-td-meter"
                    minutes={currentMin}
                    limit={limit}
                    color={meterColor(currentMin, limit)}
                    title={
                      currentMin <= 0 && isTodayView
                        ? 'Present block reset after a >=20 min rest (0 min)'
                        : `Present continuous block: ${fmtHosMinutes(currentMin)} (${currentMin} min) toward the 4h limit`
                    }
                    showTime
                    allowOverLimitPct
                    overLimitVisualMaxPct={200}
                  />
                  <td
                    className="bpl-fatigue-td-4h"
                    style={{
                      textAlign: 'right',
                      color: driveMinutesLeft < 0 ? '#CC0000' : driveMinutesLeft <= FOUR_H_WARNING_MINUTES ? '#d97706' : 'inherit',
                      fontWeight: driveMinutesLeft <= FOUR_H_WARNING_MINUTES ? 600 : 400,
                    }}
                    title={
                      currentMin <= 0 && isTodayView
                        ? 'Present block reset after a >=20 min rest — full 4h available again'
                        : driveMinutesLeft < 0
                          ? `4h continuous-driving limit is overdue by ${fmtHosMinutes(Math.abs(driveMinutesLeft))}`
                          : `${fmtHosMinutes(driveMinutesLeft)} left before the 4h continuous-driving breach`
                    }
                  >
                    {!isTodayView
                      ? '—'
                      : fmtSignedHosMinutes(driveMinutesLeft)}
                  </td>
                  {/* Daily rest */}
                  <FatigueMeter
                    className="bpl-fatigue-td-daily bpl-fatigue-td-meter bpl-fatigue-field-start"
                    minutes={dailyRestElapsed}
                    limit={dailyRestWindow}
                    color={dailyRestProgressColor(dailyRestElapsed, dailyRestWindow)}
                    title={
                      record.minutesSinceDailyRest == null
                        ? `No >=8h continuous rest found in the last 7 days. Showing at least ${fmtHosMinutes(dailyRestElapsed)} since rest.`
                        : `${fmtHosMinutes(dailyRestElapsed)} since last >=8h continuous rest ended, toward the 24h daily-rest breach point.`
                    }
                    showTime
                    allowOverLimitPct
                  />
                  <td
                    className="bpl-fatigue-td-daily"
                    style={{
                      textAlign: 'right',
                      color: dailyRestMinutesLeft < 0 ? '#CC0000' : dailyRestMinutesLeft <= 240 ? '#d97706' : 'inherit',
                      fontWeight: dailyRestMinutesLeft <= 240 ? 600 : 400,
                    }}
                    title={
                      dailyRestMinutesLeft < 0
                        ? `Daily rest is overdue by ${fmtHosMinutes(Math.abs(dailyRestMinutesLeft))}`
                        : `${fmtHosMinutes(dailyRestMinutesLeft)} left before daily-rest breach`
                    }
                  >
                    {fmtSignedHosMinutes(dailyRestMinutesLeft)}
                  </td>

                  {/* Weekly rest */}
                  <WeeklyRestCalendar record={record} />
                  <td
                    className="bpl-fatigue-td-weekly"
                    style={{
                      textAlign: 'right',
                      color: weeklyRestMinutesLeft < 0 ? '#CC0000' : weeklyRestMinutesLeft <= 24 * 60 ? '#d97706' : 'inherit',
                      fontWeight: weeklyRestMinutesLeft <= 24 * 60 ? 600 : 400,
                    }}
                    title={
                      weeklyRestMinutesLeft < 0
                        ? `Weekly rest start point is overdue by ${fmtSignedHours(Math.abs(weeklyRestMinutesLeft))}`
                        : `${fmtSignedHours(weeklyRestMinutesLeft)} left before the 24h weekly rest must start`
                    }
                  >
                    {fmtSignedHours(weeklyRestMinutesLeft)}
                  </td>

                  <td
                    className="bpl-fatigue-hos-points-cell"
                    style={{
                      textAlign: 'left',
                      color: hosPoints > 0 ? '#CC0000' : 'var(--cd-text-muted)',
                      fontWeight: hosPoints > 0 ? 700 : 500,
                      whiteSpace: 'normal',
                    }}
                    title={`${hosBreakdown}. ${fmtHosMinutes(hosHeldMinutes)} total over HOS limits on ${compactDateLabel(hosPointsDate)} = ${fmtPoints(hosPoints)} HOS points`}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                      <span style={{ color: hosPoints > 0 ? '#CC0000' : 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
                        {hosPointsLoading ? <SkelValue /> : `${fmtPoints(hosPoints)} pts`}
                      </span>
                      <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {hosInfractions.length ? hosInfractions.map(i => (
                          <span key={i.key} className="bpl-fatigue-hos-chip">
                            <AlertTriangle size={10} /> {i.label} {i.detail}
                          </span>
                        )) : (
                          <span className="bpl-fatigue-hos-chip is-empty">None</span>
                        )}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!hosLoading && filtered.length > FATIGUE_PAGE_SIZE && (
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

      {violationHistoryRows.length > 0 && (
        <div className="bpl-card bpl-table-scroll" style={{ padding: 0, marginTop: 14 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--cd-border)', fontWeight: 600, fontSize: 14 }}>
            Violation history — {new Date(targetDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
          <table className="bpl-dispatch-table bpl-fatigue-table">
            <thead>
              <tr>
                <ThLabel label="Time" />
                <ThLabel label="Driver" />
                <ThLabel label="Site" />
                <ThLabel label="Violation value" align="right" />
                <ThLabel label="Violation trip" align="right" />
              </tr>
            </thead>
            <tbody>
              {violationPagination.pageRows.map(row => (
                <tr key={row.key}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(row.breachAt)}</td>
                  <td className="bpl-fatigue-cell-name" title={displayDriverName(row.driverName)}>
                    <strong>{displayDriverName(row.driverName)}</strong>
                  </td>
                  <td className="bpl-fatigue-cell-clip">{row.site}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtHosMinutes(row.violationDriveMinutes)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtHosMinutes(row.violationTripMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {violationHistoryRows.length > FATIGUE_PAGE_SIZE && (
            <PageControls
              page={violationPagination.page}
              pageCount={violationPagination.pageCount}
              from={violationPagination.from}
              to={violationPagination.to}
              total={violationPagination.total}
              hasPrev={violationPagination.hasPrev}
              hasNext={violationPagination.hasNext}
              onPrev={violationPagination.prev}
              onNext={violationPagination.next}
              itemLabel="violations"
            />
          )}
        </div>
      )}
    </div>
  );
}
