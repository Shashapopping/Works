/**
 * SQL census for facts (score, incident totals, risk). Never returns event rows.
 */
import { getDb } from './db.js';
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
  const { conditions, params } = rangeConditions(from, to);
  if (driver) {
    conditions.push('driver_name = ?');
    params.push(driver);
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
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    panicN = database.prepare(`SELECT COUNT(*) n FROM panic ${where}`).get(...params).n;
  }
  return eventsN + panicN;
}

function normalizeAssetIds(assetIds) {
  if (assetIds == null) return null;
  const ids = [...new Set(
    (Array.isArray(assetIds) ? assetIds : String(assetIds).split(','))
      .map(id => String(id || '').trim())
      .filter(Boolean),
  )];
  return ids;
}

function pushAssetIdFilter(conditions, params, assetIds, col = 'asset_id') {
  const ids = normalizeAssetIds(assetIds);
  if (!ids) return { empty: false };
  if (ids.length === 0) return { empty: true };
  conditions.push(`${col} IN (${ids.map(() => '?').join(',')})`);
  params.push(...ids);
  return { empty: false };
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
  const panicRange = rangeConditions(from, to);
  const panicFilter = pushAssetIdFilter(panicRange.conditions, panicRange.params, assetIds);
  if (panicFilter.empty) return { ...empty, byLabel, incidentTotal: scoringCount, scoringCount };
  const panicWhere = panicRange.conditions.length ? `WHERE ${panicRange.conditions.join(' AND ')}` : '';
  const panicCount = database.prepare(`SELECT COUNT(*) n FROM panic ${panicWhere}`).get(...panicRange.params).n;
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

export function queryRiskAggregates({ from = null, to = null, groupBy = 'driver' } = {}) {
  const database = getDb();
  const { conditions, params } = rangeConditions(from, to);
  conditions.push(`label IN (${SCORING_LABELS.map(() => '?').join(',')})`);
  params.push(...SCORING_LABELS);
  const osKeep = overspeedKeepSql();
  conditions.push(osKeep.sql);
  params.push(...osKeep.params);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const keyCol = groupBy === 'asset' ? 'asset_id' : 'driver_id';
  const rows = database.prepare(`
    SELECT ${keyCol} AS id, driver_id, driver_name, asset_id, label, COUNT(*) n
    FROM events ${where}
    GROUP BY ${keyCol}, driver_id, driver_name, asset_id, label
  `).all(...params);

  const map = new Map();
  for (const r of rows) {
    const id = (r.id || r.driver_name || r.asset_id || 'unknown').toString();
    if (!map.has(id)) {
      map.set(id, {
        id,
        driverId: r.driver_id || null,
        driverName: r.driver_name || 'N/A',
        assetId: r.asset_id || null,
        harshBraking: 0,
        harshAcceleration: 0,
        overspeeding: 0,
        overspeedTiered: 0,
        harshCornering: 0,
        total: 0,
      });
    }
    const row = map.get(id);
    if (r.driver_name && r.driver_name !== 'N/A') row.driverName = r.driver_name;
    if (r.asset_id) row.assetId = r.asset_id;
    const n = r.n || 0;
    row.total += n;
    if (r.label === 'Harsh Braking') row.harshBraking += n;
    else if (r.label === 'Harsh Acceleration') row.harshAcceleration += n;
    else if (r.label === 'Harsh Cornering') row.harshCornering += n;
    else if (r.label === 'Overspeed Tiered') row.overspeedTiered += n;
    else row.overspeeding += n;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
