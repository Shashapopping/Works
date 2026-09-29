import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import * as dotenv from 'dotenv'
import { startPolling, pollOnce, clearTriggeredEvent, resetState, getWarningEvents, getSessionTrips, getDriverDistanceSummary, getFleetSafetyExposure, getRiskDrivers, getEventTrends } from './scripts/mix-test.js'
import { getServedStat, startStatsScheduler } from './scripts/stats-store.js'
import { getAcknowledged, addAcknowledged, clearAcknowledged } from './scripts/db.js'
import { handleEventsLogQuery } from './scripts/events-log-api.js'
import { getFuelHistoryResponse, getFuelSeriesResponse } from './scripts/fuel-history-api.js'
import { getFleetDataResponse } from './scripts/fleet-data-api.js'
import { resolveEnvironment } from './scripts/environment-service.js'
import { computeConsumption } from './scripts/consumption-engine.js'
import { computeUtilization } from './scripts/util-engine.js'
import { importWeekSeed } from './scripts/import-seed.js'
import { bootstrapAdminIfNeeded } from './scripts/auth.js'
import { authExpressMiddleware } from './scripts/auth-http.js'
import { startReportAutomateScheduler } from './scripts/report-automate.js'
import {
  applySignedInTransporterScope,
  assetIdsQueryValue,
} from './scripts/transporter-scope.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Merge git-tracked week seed into runtime logs (no-op if already imported)
try {
  await importWeekSeed({ verbose: true })
} catch (e) {
  console.log('⚠️ Seed import skipped:', e?.message || e)
}

try {
  await bootstrapAdminIfNeeded()
} catch (e) {
  console.log('⚠️ Auth bootstrap skipped:', e?.message || e)
}

try {
  startReportAutomateScheduler()
} catch (e) {
  console.log('⚠️ Report Automate scheduler skipped:', e?.message || e)
}

const app = express()
const PORT = process.env.PORT || 3000
const API_SECRET = process.env.API_SECRET

// Behind nginx on DigitalOcean — real client IP for rate limits
app.set('trust proxy', 1)

app.use(express.json({ limit: '40mb' }))
app.use(authExpressMiddleware())

function isAuthorized(req) {
  return req.headers['x-api-secret'] === API_SECRET
}

function unauthorized(res) {
  res.status(401).end('Unauthorized')
}

function sendStoredStat(res, json) {
  res.type('application/json').send(json)
}

function storedStatFailed(res, err, label) {
  if (err?.code === 'STATS_WARMING') {
    res.set('Retry-After', '30')
    return res.status(503).json({ error: 'Stats are being prepared, retry shortly' })
  }
  console.error(`${label} failed`, err?.message || err)
  res.status(500).json({ error: `Failed to compute ${label}` })
}

// Block direct access to sensitive JSON files
app.use((req, res, next) => {
  const blocked = ['/data.json', '/metadata.json', '/drivers.json', '/vehicles.json', '/acknowledged.json']
  if (blocked.includes(req.path)) {
    return res.status(403).end('Forbidden')
  }
  next()
})

// Refresh
app.post('/api/refresh', async (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  const result = await pollOnce()
  res.json(result)
})

// Acknowledged GET
app.get('/api/acknowledged', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  res.json(getAcknowledged())
})

// Acknowledged POST
app.post('/api/acknowledged', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const { id } = req.body
    addAcknowledged(id)
    clearTriggeredEvent(id)
    res.json({ ok: true })
  } catch {
    res.status(400).end('Bad Request')
  }
})

// Reset
app.post('/api/reset', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  resetState()
  clearAcknowledged()
  res.json({ ok: true })
})

// Data
app.get('/api/data', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    res.setHeader('Content-Type', 'application/json')
    res.end(getFleetDataResponse({ view: req.query.view?.toString() || null }))
  } catch {
    res.status(404).end('Not Found')
  }
})

// Metadata
app.get('/api/metadata', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const data = fs.readFileSync(path.join(process.cwd(), 'public', 'metadata.json'), 'utf8')
    res.setHeader('Content-Type', 'application/json')
    res.end(data)
  } catch {
    res.status(404).end('Not Found')
  }
})

// Warning events
app.get('/api/events', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  res.json(getWarningEvents())
})

// Drivers
app.get('/api/drivers', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const driversPath = path.join(process.cwd(), 'public', 'drivers.json')
    if (!fs.existsSync(driversPath)) return res.json([])
    const data = fs.readFileSync(driversPath, 'utf8')
    res.setHeader('Content-Type', 'application/json')
    res.end(data)
  } catch {
    res.status(404).end('Not Found')
  }
})

// Events log — paged `{ entries, total }` when format=page; no limit + from/to = full export
app.get('/api/events/log', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const assetIds = assetIdsQueryValue(applySignedInTransporterScope(
      req,
      req.query.assetIds?.toString() || req.query.assetId?.toString() || null,
      req.query.siteScope?.toString() || null,
    ))
    res.json(handleEventsLogQuery({
      from: req.query.from,
      to: req.query.to,
      types: req.query.types,
      limit: req.query.limit,
      offset: req.query.offset,
      total: req.query.total,
      format: req.query.format,
      driver: req.query.driver,
      driverName: req.query.driverName,
      q: req.query.q,
      search: req.query.search,
      assetIds,
      siteScope: null,
      range: req.query.range,
      sites: req.query.sites,
      excludeHidden: req.query.excludeHidden,
    }))
  } catch (err) {
    console.error('events/log failed:', err?.message || err)
    res.status(500).end('Internal Server Error')
  }
})

// Environment context — weather + traffic at incident coordinates
app.get('/api/environment', async (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const lat = parseFloat(req.query.lat)
    const lng = parseFloat(req.query.lng)
    const hasCoords = !isNaN(lat) && !isNaN(lng)
    if (!hasCoords && !req.query.address) return res.status(400).json({ error: 'lat/lng or address required' })

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY
    const tomTomApiKey = process.env.TOMTOM_API_KEY || process.env.VITE_TOMTOM_API_KEY
    const environment = await resolveEnvironment({
      lat: hasCoords ? lat : null,
      lng: hasCoords ? lng : null,
      address: req.query.address || '',
      timestamp: req.query.timestamp || new Date().toISOString(),
      googleApiKey,
      tomTomApiKey,
    })
    res.json(environment)
  } catch {
    res.status(500).json({ error: 'Environment lookup failed' })
  }
})

// Trips — current session raw trips
app.get('/api/trips/session', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  res.json(getSessionTrips())
})

// Driver distance summary — strips journeys from wire payload
app.get('/api/driver-distance', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  const tripsParam = req.query.trips?.toString()
  const includeTrips = tripsParam === '1' || tripsParam === 'true'
  const summaryParam = req.query.summary?.toString()
  const summaryOnly = summaryParam === '1' || summaryParam === 'true' || summaryParam === 'totals'
  const summary = getDriverDistanceSummary({
    range: req.query.range?.toString() || '24h',
    month: req.query.month?.toString() || null,
    from: req.query.from?.toString() || null,
    to: req.query.to?.toString() || null,
    includeTrips,
    summaryOnly,
    assetIds: req.query.assetIds?.toString() || null,
    siteScope: req.query.siteScope?.toString() || req.query.sites?.toString() || null,
  })
  const includeJourneys = req.query.includeJourneys === '1' || req.query.includeJourneys === 'true'
  const slim = includeJourneys
    ? summary
    : { ...summary, assets: summary.assets.map(({ journeys, trips, ...rest }) => rest) }
  res.json(slim)
})

// Hours-of-Service — continuous-driving-time records for the day
app.get('/api/hos', async (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    sendStoredStat(res, await getServedStat('hos', { date: req.query.date?.toString() || null }))
  } catch (err) {
    storedStatFailed(res, err, 'HOS records')
  }
})

// Distance + HOS held minutes for the fleet safety score (same calendar window)
app.get('/api/safety-exposure', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const assetIds = assetIdsQueryValue(applySignedInTransporterScope(
      req,
      req.query.assetIds?.toString() || null,
      req.query.siteScope?.toString() || null,
    ))
    res.json(getFleetSafetyExposure({
      range: req.query.range?.toString() || '30d',
      from: req.query.from?.toString() || null,
      to: req.query.to?.toString() || null,
      assetIds,
      siteScope: null,
    }))
  } catch (err) {
    console.error('safety exposure failed', err)
    res.status(500).json({ error: 'Failed to compute safety exposure' })
  }
})

app.get('/api/safety/summary', async (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const assetIds = assetIdsQueryValue(applySignedInTransporterScope(
      req,
      req.query.assetIds?.toString() || null,
      req.query.siteScope?.toString() || null,
    ))
    sendStoredStat(res, await getServedStat('safety-summary', {
      range: req.query.range?.toString() || '30d',
      from: req.query.from?.toString() || null,
      to: req.query.to?.toString() || null,
      assetIds,
    }))
  } catch (err) {
    storedStatFailed(res, err, 'safety summary')
  }
})

app.get('/api/events/trends', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const types = req.query.types
      ? String(req.query.types).split(',').map(t => t.trim()).filter(Boolean)
      : null
    const assetIds = assetIdsQueryValue(applySignedInTransporterScope(
      req,
      req.query.assetIds?.toString() || null,
      req.query.siteScope?.toString() || null,
    ))
    res.json(getEventTrends({
      from: req.query.from?.toString() || null,
      to: req.query.to?.toString() || null,
      assetIds,
      siteScope: null,
      types,
    }))
  } catch (err) {
    console.error('events trends failed', err)
    res.status(500).json({ error: 'Failed to compute event trends' })
  }
})

app.get('/api/risk/drivers', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const assetIds = assetIdsQueryValue(applySignedInTransporterScope(
      req,
      req.query.assetIds?.toString() || null,
      req.query.siteScope?.toString() || null,
    ))
    res.json(getRiskDrivers({
      range: req.query.range?.toString() || '30d',
      from: req.query.from?.toString() || null,
      to: req.query.to?.toString() || null,
      assetIds,
      siteScope: null,
      groupBy: req.query.groupBy?.toString() || 'driver',
    }))
  } catch (err) {
    console.error('risk drivers failed', err)
    res.status(500).json({ error: 'Failed to compute driver risk' })
  }
})

// Per-asset journey detail
app.get('/api/driver-distance/journeys/:assetId', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  const summary = getDriverDistanceSummary({ range: req.query.range?.toString() || '24h' })
  const asset = summary.assets.find(a => a.assetId === req.params.assetId)
  if (!asset) return res.status(404).json({ error: 'Asset not found' })
  res.json(asset.journeys)
})

// Fuel history — returns time-series per vehicle for day/week/month or custom from/to
app.get('/api/fuel/history', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    res.json(getFuelHistoryResponse({
      period: req.query.period?.toString() || 'day',
      from: req.query.from?.toString() || null,
      to: req.query.to?.toString() || null,
      assetIds: req.query.assetIds?.toString() || null,
      siteScope: req.query.siteScope?.toString() || req.query.sites?.toString() || null,
    }))
  } catch (err) {
    if (err?.statusCode === 400) return res.status(400).json({ error: err.message })
    res.status(500).end('Internal Server Error')
  }
})

// Fuel history — returns time-series per vehicle for day/week/month or custom from/to
app.get('/api/fuel/series', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    res.json(getFuelSeriesResponse({
      period: req.query.period?.toString() || 'day',
      from: req.query.from?.toString() || null,
      to: req.query.to?.toString() || null,
      assetIds: req.query.assetIds?.toString() || null,
      siteScope: req.query.siteScope?.toString() || req.query.sites?.toString() || null,
    }))
  } catch (err) {
    if (err?.statusCode === 400) return res.status(400).json({ error: err.message })
    res.status(500).end('Internal Server Error')
  }
})


// Fuel consumption — asset/site metrics from fuel-history.log + trips.log
app.get('/api/fuel/consumption', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const period = req.query.period || 'week'
    const from = req.query.from
    const to = req.query.to
    const site = req.query.site || null
    const tripsParam = req.query.trips?.toString()
    const includeTrips = tripsParam === '1' || tripsParam === 'true'
    const data = computeConsumption({
      period,
      from,
      to,
      siteFilter: site,
      assetIds: req.query.assetIds?.toString() || null,
      siteScope: req.query.siteScope?.toString() || req.query.sites?.toString() || null,
      includeTrips,
    })
    const summaryParam = req.query.summary?.toString()
    const summaryOnly = summaryParam === '1' || summaryParam === 'true'
    res.json(summaryOnly ? {
      period: data.period,
      summary: data.summary,
      dailySeries: data.dailySeries,
      assets: [],
      trips: [],
      refuels: [],
      siteTotals: [],
    } : data)
  } catch {
    res.status(500).end('Internal Server Error')
  }
})

// Utilization — drive / idle / engine-on from trips
app.get('/api/utilization', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const data = computeUtilization({
      period: req.query.period || 'week',
      from: req.query.from,
      to: req.query.to,
      scope: req.query.scope || 'all',
      assetIds: req.query.assetIds?.toString() || null,
      siteScope: req.query.siteScope?.toString() || req.query.sites?.toString() || null,
    })
    const summaryParam = req.query.summary?.toString()
    const summaryOnly = summaryParam === '1' || summaryParam === 'true'
    res.json(summaryOnly ? {
      generatedAt: data.generatedAt,
      period: data.period,
      windowHours: data.windowHours,
      scope: data.scope,
      summary: data.summary,
    } : data)
  } catch {
    res.status(500).end('Internal Server Error')
  }
})

// Serve built frontend (dist is gitignored — always `npm run build` after deploy pull)
const distDir = path.join(__dirname, 'dist')
const distIndex = path.join(distDir, 'index.html')
if (!fs.existsSync(distIndex)) {
  console.warn('⚠️  dist/index.html missing — run: npm run build')
}
app.use(express.static(distDir))

// SPA fallback — never throw ENOENT into the error log when build is missing
app.use((req, res) => {
  if (!fs.existsSync(distIndex)) {
    return res
      .status(503)
      .type('text')
      .send('Frontend build missing. On the server run: npm run build && pm2 restart HBM-Dashboard')
  }
  res.sendFile(distIndex)
})

// Start server and polling
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 JMG Dashboard server running on port ${PORT}`)
  console.log(`📡 Starting MiX polling...`)
  startPolling({ maxRuns: null })
  startStatsScheduler()
})
