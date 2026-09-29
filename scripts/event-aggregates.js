/**
 * SQL census for facts (score, incident totals, risk). Never returns event rows.
 */
import { getAcknowledged, getDb, pushAssetIdScope, pushEventTextSearch } from './db.js';
import { OVERSPEED_MIN_KPH } from './overspeed-filter.js';

export const SCORING_LABELS = [
  'Harsh Braking',
  'Harsh Acceleration',
  'Overspeeding',
  'Overspeed Tiered',
  'Road Speed Overspeeding',
  'Overspeeding — Excessive Speed',
  'Harsh Cornering',
];

/** Labels plotted on incident trend charts (excludes panic / excessive-speed variant). */
export const TREND_LABELS = [
  'Harsh Braking',
  'Harsh Acceleration',
  'Overspeeding',
  'Overspeed Tiered',
  'Road Speed Overspeeding',
  'Harsh Cornering',
];

const OS_SQL_LABELS = [
  'Overspeeding',
  'Overspeed Tiered',
  'Road Speed Overspeeding',
  'Overspeeding — Excessive Speed',
];

function rangeConditions(from, to, col = 'event_time') {
  const conditions = [];
  const params = [];
  if (from) { conditions.push(`${col} >= ?`); params.push(from); }
  if (to) { conditions.push(`${col} <= ?`); params.push(to); }
  return { conditions, params };
}

function overspeedKeepSql(labelCol = 'label', speedCol = 'speed') {
  const inList = OS_SQL_LABELS.map(() => '?').join(',');
  return {
    sql: `(${labelCol} NOT IN (${inList}) OR ${speedCol} IS NULL OR ${speedCol} = '' OR CAST(${speedCol} AS REAL) >= ${OVERSPEED_MIN_KPH})`,
    params: [...OS_SQL_LABELS],
  };
}

export function countMatchingEvents(filters = {}) {
  const database = getDb();
  const { from, to, types, driver } = filters;
  const excludeHidden = filters.excludeHidden === true || filters.excludeHidden === '1' || filters.excludeHidden === 'true';
  const hiddenIds = excludeHidden ? getAcknowledged() : [];
  const { conditions, params } = rangeConditions(from, to);
  const assetFilter = pushAssetIdFilter(conditions, params, filters.assetIds);
  if (assetFilter.empty) return 0;
  if (driver) {
    conditions.push('driver_name = ?');
    params.push(driver);
  }
  pushEventTextSearch(conditions, params, {
    q: filters.searchQ || filters.q || null,
    matchedAssetIds: filters.searchAssetIds || null,
  });
  if (hiddenIds.length) {
    conditions.push(`event_id NOT IN (${hiddenIds.map(() => '?').join(',')})`);
    params.push(...hiddenIds);
  }
  const includeEvents = !types || types.length === 0 || types.some(t => t && t !== 'Panic');
  const includePanic = !types || types.length === 0 || types.includes('Panic');

  let eventsN = 0;
  if (includeEvents) {
    const eventTypes = types?.filter(t => t && t !== 'Panic') || [];
    const extra = [...conditions];
    const extraParams = [...params];
    if (eventTypes.length) {
      extra.push(`label IN (${eventTypes.map(() => '?').join(',')})`);
      extraParams.push(...eventTypes);
    }
    const osKeep = overspeedKeepSql();
    extra.push(osKeep.sql);
    extraParams.push(...osKeep.params);
    const where = extra.length ? `WHERE ${extra.join(' AND ')}` : '';
    eventsN = database.prepare(`SELECT COUNT(*) n FROM events ${where}`).get(...extraParams).n;
  }

  let panicN = 0;
  if (includePanic) {
    panicN = 0;
  }
  return eventsN + panicN;
}

/** Per-label counts with the same filters as countMatchingEvents (ignores `types`). */
export function countMatchingEventsByLabel(filters = {}) {
  const database = getDb();
  const { from, to, driver } = filters;
  const excludeHidden = filters.excludeHidden === true || filters.excludeHidden === '1' || filters.excludeHidden === 'true';
  const hiddenIds = excludeHidden ? getAcknowledged() : [];
  const { conditions, params } = rangeConditions(from, to);
  const assetFilter = pushAssetIdFilter(conditions, params, filters.assetIds);
  if (assetFilter.empty) return {};
  if (driver) {
    conditions.push('driver_name = ?');
    params.push(driver);
  }
  pushEventTextSearch(conditions, params, {
    q: filters.searchQ || filters.q || null,
    matchedAssetIds: filters.searchAssetIds || null,
  });
  if (hiddenIds.length) {
    conditions.push(`event_id NOT IN (${hiddenIds.map(() => '?').join(',')})`);
    params.push(...hiddenIds);
  }
  const osKeep = overspeedKeepSql();
  conditions.push(osKeep.sql);
  params.push(...osKeep.params);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = database.prepare(`SELECT label, COUNT(*) n FROM events ${where} GROUP BY label`).all(...params);
  const byLabel = {};
  for (const r of rows) byLabel[r.label] = r.n;
  return byLabel;
}

function pushAssetIdFilter(conditions, params, assetIds, col = 'asset_id') {
  return pushAssetIdScope(conditions, params, assetIds, col);
}

export function querySafetyEventAggregates({ from = null, to = null, assetIds = null } = {}) {
  const empty = {
    incidentTotal: 0,
    scoringCount: 0,
    byLabel: {},
    panicCount: 0,
    assetCount: 0,
    driverCount: 0,
  };
  const database = getDb();
  const { conditions, params } = rangeConditions(from, to);
  const assetFilter = pushAssetIdFilter(conditions, params, assetIds);
  if (assetFilter.empty) return empty;
  conditions.push(`label IN (${SCORING_LABELS.map(() => '?').join(',')})`);
  params.push(...SCORING_LABELS);
  const osKeep = overspeedKeepSql();
  conditions.push(osKeep.sql);
  params.push(...osKeep.params);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = database.prepare(`SELECT label, COUNT(*) n FROM events ${where} GROUP BY label`).all(...params);
  const byLabel = {};
  let scoringCount = 0;
  for (const r of rows) {
    byLabel[r.label] = r.n;
    scoringCount += r.n;
  }
  const panicCount = 0;
  const assetCount = database.prepare(`SELECT COUNT(DISTINCT asset_id) n FROM events ${where}`).get(...params).n;
  const driverCount = database.prepare(`SELECT COUNT(DISTINCT driver_id) n FROM events ${where}`).get(...params).n;
  return {
    incidentTotal: scoringCount,
    scoringCount,
    byLabel,
    panicCount,
    assetCount,
    driverCount,
  };
}

export function queryRiskAggregates({ from = null, to = null, groupBy = 'driver', assetIds = null } = {}) {
  const database = getDb();
  const { conditions, params } = rangeConditions(from, to);
  const assetFilter = pushAssetIdFilter(conditions, params, assetIds);
  if (assetFilter.empty) return [];
  conditions.push(`label IN (${SCORING_LABELS.map(() => '?').join(',')})`);
  params.push(...SCORING_LABELS);
  const osKeep = overspeedKeepSql();
  conditions.push(osKeep.sql);
  params.push(...osKeep.params);
  const where = `WHERE ${conditions.join(' AND ')}`;

  const byAsset = groupBy === 'asset';
  const groupExpr = byAsset
    ? `COALESCE(NULLIF(asset_id, ''), 'unknown')`
    : `COALESCE(NULLIF(driver_id, ''), NULLIF(driver_name, ''), NULLIF(asset_id, ''), 'unknown')`;

  const rows = database.prepare(`
    SELECT
      ${groupExpr} AS id,
      MAX(driver_id) AS driver_id,
      MAX(driver_name) AS driver_name,
      MAX(asset_id) AS asset_id,
      SUM(CASE WHEN label = 'Harsh Braking' THEN 1 ELSE 0 END) AS harshBraking,
      SUM(CASE WHEN label = 'Harsh Acceleration' THEN 1 ELSE 0 END) AS harshAcceleration,
      SUM(CASE WHEN label = 'Harsh Cornering' THEN 1 ELSE 0 END) AS harshCornering,
      SUM(CASE WHEN label = 'Overspeed Tiered' THEN 1 ELSE 0 END) AS overspeedTiered,
      SUM(CASE WHEN label IN ('Overspeeding', 'Road Speed Overspeeding', 'Overspeeding — Excessive Speed') THEN 1 ELSE 0 END) AS overspeeding,
      COUNT(*) AS total
    FROM events ${where}
    GROUP BY ${groupExpr}
  `).all(...params);

  return rows
    .map(r => ({
      id: String(r.id),
      driverId: r.driver_id || null,
      driverName: r.driver_name || 'N/A',
      assetId: r.asset_id || null,
      harshBraking: r.harshBraking || 0,
      harshAcceleration: r.harshAcceleration || 0,
      harshCornering: r.harshCornering || 0,
      overspeedTiered: r.overspeedTiered || 0,
      overspeeding: r.overspeeding || 0,
      total: r.total || 0,
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Daily event counts by label (Africa/Lagos calendar day via UTC+1 offset).
 * Returns sparse rows: { dayKey, label, count }.
 */
export function queryEventTrendBuckets({ from = null, to = null, assetIds = null, types = null } = {}) {
  const database = getDb();
  const { conditions, params } = rangeConditions(from, to);
  const assetFilter = pushAssetIdFilter(conditions, params, assetIds);
  if (assetFilter.empty) return [];

  const labelList = (types && types.length)
    ? types.filter(t => TREND_LABELS.includes(t))
    : TREND_LABELS;
  if (!labelList.length) return [];

  conditions.push(`label IN (${labelList.map(() => '?').join(',')})`);
  params.push(...labelList);
  const osKeep = overspeedKeepSql();
  conditions.push(osKeep.sql);
  params.push(...osKeep.params);
  const where = `WHERE ${conditions.join(' AND ')}`;

  return database.prepare(`
    SELECT date(datetime(event_time, '+1 hour')) AS day_key, label, COUNT(*) AS n
    FROM events ${where}
    GROUP BY day_key, label
    ORDER BY day_key ASC
  `).all(...params).map(r => ({
    dayKey: r.day_key,
    label: r.label,
    count: r.n,
  }));
}
