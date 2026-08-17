import { useState, useEffect, useMemo } from 'react';
import { Moon, Search, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { isActiveDriver, isActiveDriverId, displayDriverName } from '../../lib/driverUtils';
import { DEMO_BRANDING, demoDriverLabel } from '../../config/demoBranding';
import MockNamesBadge from '../../components/MockNamesBadge';
import InfoTip from '../../components/InfoTip';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useHosRecords } from '../../hooks/useHosRecords';
import { fmtHosMinutes, hosRuleLabels, type HosRecord, type HosStatus } from '../../lib/hos';
import { SkelValue, SkelTable } from '../../components/data/DataBusy';

type DaySel = 'today' | 'yesterday' | 'custom';

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
  Vehicle: 'Vehicle plate on their latest trip this day.',
  Site: 'Site or pool linked to that vehicle.',
  '4h continuous': 'Max 4 hours continuous driving. A parked gap of ≥30 minutes resets the block.',
  'Daily rest': 'Max 8 hours continuous driving inside a rolling 24-hour cycle.',
  'Weekly rest': 'At least 24 hours continuous off-duty rest required in every rolling 7-day week.',
  'Drive time': 'Driving credited inside the selected Lagos day only. Overnight trips are clipped at midnight — yesterday’s hours do not count toward today. Long open trips with almost no distance are also capped.',
  'Trip time': 'Sum of each trip’s clock time inside the selected day (clipped at midnight). Gaps between trips are not counted — so an overnight open trip cannot stretch Trip time to ~23h.',
  'Longest block': 'Longest continuous drive block this day toward the 4-hour limit. Hover for duration.',
  'Violation drive': 'Extra driving minutes past the 4-hour continuous limit.',
  'Violation trip': 'Clock time from when they hit 4 hours until that driving block ended.',
  'Current block': 'How full the live continuous drive block is toward 4 hours. Resets after a ≥30 min rest.',
  'Drive left': 'How much driving remains in the current continuous block before 4 hours.',
  '24h longest': 'Longest continuous drive in the rolling 24-hour window, shown toward the 8-hour limit.',
  'Drive in 24h': 'Total credited driving time in the rolling 24-hour window (all trips, not only the longest continuous block).',
  'Longest rest': 'Longest continuous off-duty gap in the last 7 days. Required: ≥24 hours.',
  'Days since 24h rest': 'How many days since the last ≥24h continuous rest ended. 0 = currently in a qualifying rest. 7+ = none found in the week.',
  Status: 'Compliant = under all limits. At risk = near 4h or 8h. Violation = 4h continuous, 8h in 24h, and/or missing 24h weekly rest.',
  Time: 'When the driver crossed the 4-hour continuous limit.',
};

type HosColGroup = '4h' | 'daily' | 'weekly';

const HOS_GROUPS: {
  id: HosColGroup;
  title: string;
  className: string;
  fields: { label: string; align: 'left' | 'right' }[];
}[] = [
  {
    id: '4h',
    title: '4h continuous',
    className: 'bpl-fatigue-group-4h',
    fields: [
      { label: 'Longest block', align: 'right' },
      { label: 'Current block', align: 'right' },
      { label: 'Drive left', align: 'right' },
      { label: 'Violation drive', align: 'right' },
    ],
  },
  {
    id: 'daily',
    title: 'Daily rest',
    className: 'bpl-fatigue-group-daily',
    fields: [
      { label: '24h longest', align: 'right' },
      { label: 'Drive in 24h', align: 'right' },
    ],
  },
  {
    id: 'weekly',
    title: 'Weekly rest',
    className: 'bpl-fatigue-group-weekly',
    fields: [
      { label: 'Longest rest', align: 'right' },
      { label: 'Days since 24h rest', align: 'right' },
    ],
  },
];

const HOS_FIELD_COUNT = HOS_GROUPS.reduce((n, g) => n + g.fields.length, 0);
const TABLE_COL_COUNT = 3 + HOS_FIELD_COUNT + 1;

function scrubHosRecords(list: HosRecord[]): HosRecord[] {
  if (!DEMO_BRANDING) return list;
  return list.map(r => ({
    ...r,
    driverName: isActiveDriver(r.driverName, r.id) ? demoDriverLabel(r.driverName) : r.driverName,
  }));
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function limitOf(record: HosRecord) {
  return record.driveLimitMinutes || 240;
}

function longestBlockMinutes(record: HosRecord) {
  if (record.maxContinuousMinutes > 0) return record.maxContinuousMinutes;
  if (record.continuousMinutes > 0) return record.continuousMinutes;
  return 0;
}

function currentBlockMinutes(record: HosRecord) {
  if (record.currentBlockMinutes != null) return Math.max(0, record.currentBlockMinutes);
  return Math.max(0, record.continuousMinutes ?? 0);
}

function pctOfLimit(minutes: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((minutes / limit) * 100));
}

function meterColor(minutes: number, limit: number, fallbackStatus?: HosStatus) {
  if (minutes >= limit) return '#CC0000';
  if (minutes >= limit - 30) return '#d97706';
  if (fallbackStatus === 'violation') return '#CC0000';
  if (fallbackStatus === 'warning') return '#d97706';
  return '#16a34a';
}

function FatigueMeter({
  minutes,
  limit,
  color,
  title,
  className,
}: {
  minutes: number;
  limit: number;
  color: string;
  title: string;
  className?: string;
}) {
  const pct = pctOfLimit(minutes, limit);
  return (
    <td className={className} title={title}>
      <div className="bpl-fatigue-meter">
        <div className="bpl-fatigue-meter-track">
          <div className="bpl-fatigue-meter-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
        <span>{pct}%</span>
      </div>
    </td>
  );
}

function ThLabel({
  label,
  align = 'left',
  className,
  rowSpan,
  colSpan,
}: {
  label: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  rowSpan?: number;
  colSpan?: number;
}) {
  return (
    <th rowSpan={rowSpan} colSpan={colSpan} className={className} style={{ textAlign: align }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
        {label}
        {COL_TIPS[label] && <InfoTip text={COL_TIPS[label]} label={label} />}
      </span>
    </th>
  );
}

export default function FatigueManagementPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [statusFilter, setStatusFilter] = useState<HosStatus | 'all'>('all');
  const [daySel, setDaySel] = useState<DaySel>('today');
  const [customDate, setCustomDate] = useState(lagosDateStr(0));

  const targetDate = daySel === 'today' ? lagosDateStr(0) : daySel === 'yesterday' ? lagosDateStr(1) : customDate;
  const isTodayView = targetDate === lagosDateStr(0);

  const { records: hosRaw, loading: hosLoading, lastTripDay } = useHosRecords(targetDate);

  // Today often has no trips if MiX trip sync is behind — jump once to the last day with data.
  const [didAutoJump, setDidAutoJump] = useState(false);
  useEffect(() => {
    if (didAutoJump || hosLoading) return;
    if (!isTodayView) return;
    if (hosRaw.length > 0) return;
    if (!lastTripDay || lastTripDay === targetDate) return;
    setCustomDate(lastTripDay);
    setDaySel('custom');
    setDidAutoJump(true);
  }, [didAutoJump, hosLoading, isTodayView, hosRaw.length, lastTripDay, targetDate]);

  const hosRecords = useMemo(() => {
    return scrubHosRecords(hosRaw).filter(r => {
      if (r.id) return isActiveDriverId(r.id);
      return isActiveDriver(r.driverName, null);
    });
  }, [hosRaw]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const list = hosRecords.filter(r => {
      if (statusFilter === 'violation') {
        const hasBreach =
          (r.breaches ?? 0) >= 1
          || r.status === 'violation'
          || r.cycle8hViolation
          || r.weeklyRestOk === false;
        if (!hasBreach) return false;
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
    list.sort((a, b) => {
      const ba = a.breaches ?? 0, bb = b.breaches ?? 0;
      if (ba !== bb) return bb - ba;
      const ca = a.continuousMinutes ?? 0, cb = b.continuousMinutes ?? 0;
      if (ca !== cb) return cb - ca;
      return b.driveMinutesToday - a.driveMinutesToday;
    });
    return list;
  }, [hosRecords, debouncedSearch, statusFilter]);

  const counts = useMemo(() => ({
    compliant: hosRecords.filter(r => r.status === 'compliant').length,
    warning: hosRecords.filter(r => r.status === 'warning').length,
    violation: isTodayView
      ? hosRecords.filter(r => r.status === 'violation').length
      : hosRecords.filter(r => (r.breaches ?? 0) > 0 || r.cycle8hViolation || r.weeklyRestOk === false).length,
    cycle8h: hosRecords.filter(r => r.cycle8hViolation).length,
    weeklyRest: hosRecords.filter(r => r.weeklyRestOk === false).length,
  }), [hosRecords, isTodayView]);

  const violationHistoryRows = useMemo(() => {
    if (statusFilter !== 'violation') return [];
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

  const kpiCards = [
    {
      label: 'Drivers tracked',
      value: hosRecords.length,
      hint: isTodayView ? 'On duty / HOS window' : 'Drove this day',
      color: '#0078D4',
      icon: Moon,
    },
    {
      label: 'Compliant',
      value: counts.compliant,
      hint: 'Under all HOS rules',
      color: '#16a34a',
      icon: CheckCircle,
    },
    {
      label: 'At risk',
      value: counts.warning,
      hint: isTodayView ? 'Near 4h or 8h' : 'Approached limit',
      color: '#d97706',
      icon: Clock,
    },
    {
      label: 'Violations',
      value: counts.violation,
      hint: '4h / daily / weekly',
      color: '#CC0000',
      icon: AlertTriangle,
    },
    {
      label: '8h in 24h',
      value: counts.cycle8h,
      hint: 'Daily rest breach',
      color: '#b45309',
      icon: AlertTriangle,
    },
    {
      label: 'Weekly rest miss',
      value: counts.weeklyRest,
      hint: 'No ≥24h rest in 7d',
      color: '#7c3aed',
      icon: Moon,
    },
  ];

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Moon size={18} color="#7c3aed" />
        Driver Management — Fatigue Management <MockNamesBadge />
      </div>
      <p style={{ fontSize: 13, color: 'var(--cd-text-muted)', marginBottom: 16 }}>
        Hours of service — 4h continuous (30-min rest resets), daily rest (8h in 24h), and weekly rest (≥24h off in 7 days).
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        {(['today', 'yesterday', 'custom'] as DaySel[]).map(d => (
          <button
            key={d}
            type="button"
            onClick={() => setDaySel(d)}
            style={{
              padding: '4px 12px', borderRadius: 9999, fontSize: 12,
              fontWeight: daySel === d ? 600 : 400, cursor: 'pointer',
              border: daySel === d ? '0.5px solid var(--cd-accent-2, #0078D4)' : '0.5px solid var(--cd-border)',
              background: daySel === d ? 'rgba(0,120,212,0.1)' : 'var(--cd-surface-2)',
              color: daySel === d ? '#2563eb' : 'var(--cd-text-muted)',
              textTransform: 'capitalize',
            }}
          >{d}</button>
        ))}
        {daySel === 'custom' && (
          <input
            type="date"
            value={customDate}
            max={lagosDateStr(0)}
            onChange={e => setCustomDate(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--cd-border)', fontSize: 12 }}
          />
        )}
        <span style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginLeft: 4 }}>
          Showing {new Date(targetDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
        </span>
      </div>

      {!hosLoading && hosRaw.length === 0 && lastTripDay && lastTripDay !== targetDate && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 8,
          border: '1px solid rgba(217,119,6,0.35)', background: 'rgba(217,119,6,0.08)',
          fontSize: 13, color: 'var(--cd-text)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        }}>
          <span>
            No trips synced for {new Date(targetDate + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.
            Latest trip day in the database is{' '}
            <strong>{new Date(lastTripDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>.
          </span>
          <button
            type="button"
            onClick={() => { setCustomDate(lastTripDay); setDaySel('custom'); }}
            style={{
              padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: '1px solid #d97706', background: '#fff', color: '#b45309',
            }}
          >
            View that day
          </button>
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

      {didAutoJump && lastTripDay && targetDate === lastTripDay && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 8,
          border: '1px solid rgba(0,120,212,0.3)', background: 'rgba(0,120,212,0.06)',
          fontSize: 13, color: 'var(--cd-text)',
        }}>
          Showing the latest day with trip data ({new Date(lastTripDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}) because today has no synced trips yet.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        {kpiCards.map(k => (
          <div key={k.label} style={{
            padding: '14px 16px', borderRadius: 10,
            background: `linear-gradient(180deg, ${k.color}0d, var(--cd-surface) 55%)`,
            border: '1px solid var(--cd-border)', borderTop: `3px solid ${k.color}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{k.label}</div>
              <k.icon size={14} style={{ color: k.color, opacity: 0.75, flexShrink: 0, marginTop: 1 }} />
            </div>
            <div
              style={{
                fontSize: 20, fontWeight: 700, color: k.color,
                animation: k.label === 'Violations' && counts.violation > 0 ? 'pulse 1.5s infinite' : 'none',
              }}
            >
              {hosLoading ? <SkelValue /> : k.value}
            </div>
            <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 2 }}>{k.hint}</div>
          </div>
        ))}
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
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All' : STATUS_META[s].label}
            </button>
          ))}
        </div>
      </div>

      {statusFilter === 'violation' && (
        <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: '0 2px 10px' }}>
          Showing drivers with any HOS breach ({filtered.length}) — 4h continuous, 8h continuous in 24h, or missing ≥24h weekly rest.
        </div>
      )}

      <div className="bpl-card bpl-table-scroll" style={{ padding: 0 }}>
        <table className="bpl-dispatch-table bpl-fatigue-table">
          <thead>
            <tr className="bpl-fatigue-group-row">
              <ThLabel label="Driver" className="bpl-fatigue-th-identity" rowSpan={2} />
              <ThLabel label="Vehicle" className="bpl-fatigue-th-identity" rowSpan={2} />
              <ThLabel label="Site" className="bpl-fatigue-th-identity" rowSpan={2} />
              {HOS_GROUPS.map(g => (
                <ThLabel
                  key={g.id}
                  label={g.title}
                  align="center"
                  colSpan={g.fields.length}
                  className={`bpl-fatigue-group ${g.className}`}
                />
              ))}
              <ThLabel label="Status" className="bpl-fatigue-th-status" rowSpan={2} />
            </tr>
            <tr className="bpl-fatigue-field-row">
              {HOS_GROUPS.map(g =>
                g.fields.map((f, i) => (
                  <ThLabel
                    key={`${g.id}-${f.label}`}
                    label={f.label}
                    align={f.align}
                    className={`bpl-fatigue-field-${g.id}${i === 0 ? ' bpl-fatigue-field-start' : ''}`}
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
            ) : filtered.map(record => {
              const st = STATUS_META[record.status];
              const limit = limitOf(record);
              const longestMin = longestBlockMinutes(record);
              const currentMin = currentBlockMinutes(record);
              const vDrive = record.violationDriveMinutes ?? 0;
              const cycle8Limit = record.cycle8hLimitMinutes || 480;
              const cycle8Min = record.maxContinuous24hMinutes ?? 0;
              const drive24h = record.driveMinutes24h ?? 0;
              const weekRestMin = record.longestRestWeekMinutes ?? 0;
              const weekNeed = record.weeklyRestRequiredMinutes || 1440;
              const daysSinceRest = record.daysSinceWeeklyRest;
              const ruleHints = hosRuleLabels(record.rulesBreached);
              return (
                <tr key={record.id}>
                  <td className="bpl-fatigue-cell-name" title={displayDriverName(record.driverName)}>
                    <strong>{displayDriverName(record.driverName)}</strong>
                  </td>
                  <td className="bpl-fatigue-cell-clip" title={record.vehicleReg || undefined}>{record.vehicleReg || '—'}</td>
                  <td className="bpl-fatigue-cell-clip" title={record.site || undefined}>{record.site || '—'}</td>

                  {/* 4h continuous */}
                  <FatigueMeter
                    className="bpl-fatigue-td-4h bpl-fatigue-td-meter bpl-fatigue-field-start"
                    minutes={longestMin}
                    limit={limit}
                    color={meterColor(longestMin, limit)}
                    title={`Longest continuous block: ${fmtHosMinutes(longestMin)} (${longestMin} min) toward the 4h limit`}
                  />
                  <FatigueMeter
                    className="bpl-fatigue-td-4h bpl-fatigue-td-meter"
                    minutes={currentMin}
                    limit={limit}
                    color={meterColor(currentMin, limit, record.status)}
                    title={
                      currentMin <= 0 && isTodayView
                        ? 'Current block reset after a ≥30 min rest (0 min)'
                        : `Current continuous block: ${fmtHosMinutes(currentMin)} (${currentMin} min) toward the 4h limit`
                    }
                  />
                  <td
                    className="bpl-fatigue-td-4h"
                    style={{ textAlign: 'right' }}
                    title={
                      currentMin <= 0 && isTodayView
                        ? 'Current block reset after a ≥30 min rest — full 4h available again'
                        : 'Driving time left in the current block before hitting the 4h continuous limit'
                    }
                  >
                    {!isTodayView
                      ? '—'
                      : record.restMinutesRemaining <= 0
                        ? 'Break now'
                        : `${fmtHosMinutes(record.restMinutesRemaining)} left`}
                  </td>
                  <td className="bpl-fatigue-td-4h" style={{ textAlign: 'right' }} title="Moving time driven past the 4h limit">
                    {vDrive > 0 ? fmtHosMinutes(vDrive) : '—'}
                  </td>

                  {/* Daily rest */}
                  <FatigueMeter
                    className="bpl-fatigue-td-daily bpl-fatigue-td-meter bpl-fatigue-field-start"
                    minutes={cycle8Min}
                    limit={cycle8Limit}
                    color={meterColor(cycle8Min, cycle8Limit)}
                    title={`Longest continuous in 24h: ${fmtHosMinutes(cycle8Min)} toward 8h limit`}
                  />
                  <td
                    className="bpl-fatigue-td-daily"
                    style={{ textAlign: 'right' }}
                    title={`Total credited driving in rolling 24h: ${fmtHosMinutes(drive24h)}`}
                  >
                    {fmtHosMinutes(drive24h)}
                  </td>

                  {/* Weekly rest */}
                  <td
                    className="bpl-fatigue-td-weekly bpl-fatigue-field-start"
                    style={{
                      textAlign: 'right',
                      color: record.weeklyRestOk === false ? '#CC0000' : 'inherit',
                      fontWeight: record.weeklyRestOk === false ? 600 : 400,
                    }}
                    title={
                      record.weeklyRestOk === false
                        ? `Longest rest in 7 days: ${fmtHosMinutes(weekRestMin)} — needs ≥${fmtHosMinutes(weekNeed)}`
                        : `Longest rest in 7 days: ${fmtHosMinutes(weekRestMin)} (meets ≥${fmtHosMinutes(weekNeed)})`
                    }
                  >
                    {fmtHosMinutes(weekRestMin)}
                  </td>
                  <td
                    className="bpl-fatigue-td-weekly"
                    style={{
                      textAlign: 'right',
                      color: daysSinceRest == null || daysSinceRest >= 3 ? '#CC0000' : 'inherit',
                      fontWeight: daysSinceRest == null || daysSinceRest >= 3 ? 600 : 400,
                    }}
                    title={
                      daysSinceRest == null
                        ? 'No ≥24h continuous rest found in the last 7 days'
                        : daysSinceRest === 0
                          ? 'Currently in (or just completed) a ≥24h continuous rest'
                          : `${daysSinceRest} day${daysSinceRest === 1 ? '' : 's'} since last ≥24h continuous rest ended`
                    }
                  >
                    {daysSinceRest == null ? '7+' : `${daysSinceRest}d`}
                  </td>

                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="bpl-dispatch-status" style={{ background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                      {(record.breaches ?? 0) >= 1 && (
                        <span
                          title={`Breached the 4h continuous limit ${record.breaches} time${record.breaches === 1 ? '' : 's'}`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 2,
                            fontSize: 11, fontWeight: 700, color: '#CC0000',
                            background: 'rgba(204,0,0,0.12)', borderRadius: 6, padding: '2px 6px',
                          }}
                        >
                          <AlertTriangle size={11} /> {record.breaches}
                        </span>
                      )}
                      {ruleHints.length > 0 && (
                        <span
                          title={ruleHints.join(' · ')}
                          style={{
                            fontSize: 10, fontWeight: 600, color: '#7c3aed',
                            background: 'rgba(124,58,237,0.1)', borderRadius: 6, padding: '2px 6px',
                          }}
                        >
                          {ruleHints.join(' · ')}
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {statusFilter === 'violation' && violationHistoryRows.length > 0 && (
        <div className="bpl-card bpl-table-scroll" style={{ padding: 0, marginTop: 14 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--cd-border)', fontWeight: 600, fontSize: 14 }}>
            Violation history — {new Date(targetDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
          <table className="bpl-dispatch-table bpl-fatigue-table">
            <thead>
              <tr>
                <ThLabel label="Time" />
                <ThLabel label="Driver" />
                <ThLabel label="Vehicle" />
                <ThLabel label="Site" />
                <ThLabel label="Violation drive" align="right" />
                <ThLabel label="Violation trip" align="right" />
              </tr>
            </thead>
            <tbody>
              {violationHistoryRows.map(row => (
                <tr key={row.key}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(row.breachAt)}</td>
                  <td className="bpl-fatigue-cell-name" title={displayDriverName(row.driverName)}>
                    <strong>{displayDriverName(row.driverName)}</strong>
                  </td>
                  <td className="bpl-fatigue-cell-clip">{row.vehicleReg}</td>
                  <td className="bpl-fatigue-cell-clip">{row.site}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtHosMinutes(row.violationDriveMinutes)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtHosMinutes(row.violationTripMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
