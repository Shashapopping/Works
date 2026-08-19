import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import * as dotenv from 'dotenv'
import { startPolling, pollOnce, clearTriggeredEvent, resetState, getWarningEvents, getSessionTrips, getDriverDistanceSummary, getHosRecords, getFleetSafetyExposure, getSafetySummary, getRiskDrivers } from './scripts/mix-test.js'
import { getAcknowledged, addAcknowledged, clearAcknowledged, getFuelHistory } from './scripts/db.js'
import { handleEventsLogQuery } from './scripts/events-log-api.js'
import { resolveEnvironment } from './scripts/environment-service.js'
import { computeConsumption } from './scripts/consumption-engine.js'
import { computeKpi } from './scripts/kpi-engine.js'
import { importWeekSeed } from './scripts/import-seed.js'
import { bootstrapAdminIfNeeded } from './scripts/auth.js'
import { authExpressMiddleware } from './scripts/auth-http.js'
import { startReportAutomateScheduler } from './scripts/report-automate.js'

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
    const data = fs.readFileSync(path.join(process.cwd(), 'public', 'data.json'), 'utf8')
    res.setHeader('Content-Type', 'application/json')
    res.end(data)
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
    res.json(handleEventsLogQuery({
      from: req.query.from,
      to: req.query.to,
      types: req.query.types,
      limit: req.query.limit,
      offset: req.query.offset,
      format: req.query.format,
      driver: req.query.driver,
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
  const includeTrips = tripsParam !== '0' && tripsParam !== 'false'
  const summary = getDriverDistanceSummary({
    range: req.query.range?.toString() || '24h',
    month: req.query.month?.toString() || null,
    from: req.query.from?.toString() || null,
    to: req.query.to?.toString() || null,
    includeTrips,
  })
  const includeJourneys = req.query.includeJourneys === '1' || req.query.includeJourneys === 'true'
  const slim = includeJourneys
    ? summary
    : { ...summary, assets: summary.assets.map(({ journeys, trips, ...rest }) => rest) }
  res.json(slim)
})

// Hours-of-Service — continuous-driving-time records for the day
app.get('/api/hos', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    res.json(getHosRecords(req.query.date?.toString() || undefined))
  } catch (err) {
    console.error('hos records failed', err)
    res.status(500).json({ error: 'Failed to compute HOS records' })
  }
})

// Distance + HOS held minutes for the fleet safety score (same calendar window)
app.get('/api/safety-exposure', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    res.json(getFleetSafetyExposure({
      range: req.query.range?.toString() || '30d',
      from: req.query.from?.toString() || null,
      to: req.query.to?.toString() || null,
      assetIds: req.query.assetIds?.toString() || null,
    }))
  } catch (err) {
    console.error('safety exposure failed', err)
    res.status(500).json({ error: 'Failed to compute safety exposure' })
  }
})

app.get('/api/safety/summary', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    res.json(getSafetySummary({
      range: req.query.range?.toString() || '30d',
      from: req.query.from?.toString() || null,
      to: req.query.to?.toString() || null,
      assetIds: req.query.assetIds?.toString() || null,
    }))
  } catch (err) {
    console.error('safety summary failed', err)
    res.status(500).json({ error: 'Failed to compute safety summary' })
  }
})

app.get('/api/risk/drivers', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    res.json(getRiskDrivers({
      range: req.query.range?.toString() || '30d',
      from: req.query.from?.toString() || null,
      to: req.query.to?.toString() || null,
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
    const period = req.query.period || 'day'
    const fromQ = req.query.from
    const toQ = req.query.to
    const now = Date.now()

    let cutoffStart
    let cutoffEnd = now
    if (fromQ && toQ) {
      cutoffStart = new Date(fromQ).getTime()
      const toDate = new Date(toQ)
      toDate.setHours(23, 59, 59, 999)
      cutoffEnd = toDate.getTime()
      if (Number.isNaN(cutoffStart) || Number.isNaN(cutoffEnd)) {
        return res.status(400).json({ error: 'Invalid from/to dates' })
      }
    } else {
      const cutoffs = { day: 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000, month: 30 * 24 * 60 * 60 * 1000 }
      cutoffStart = now - (cutoffs[period] || cutoffs.day)
    }

    // All probe rows (5min / 1min / trip start-end). Restricting to 5min
    // dropped assets that still have live fuel and a drawable series.
    const entries = getFuelHistory({
      fromIso: new Date(cutoffStart).toISOString(),
      toIso: new Date(cutoffEnd).toISOString(),
    })

    // Build per-vehicle series, filtered to period
    const seriesMap = new Map()
    entries.forEach(entry => {
      if (!seriesMap.has(entry.assetId)) seriesMap.set(entry.assetId, [])
      seriesMap.get(entry.assetId).push({ time: entry.timestamp, level: entry.level })
    })

    // Enrich with regNo from data.json
    const vehicleLookup = new Map()
    try {
      const dataPath = path.join(process.cwd(), 'public', 'data.json')
      if (fs.existsSync(dataPath)) {
        JSON.parse(fs.readFileSync(dataPath, 'utf8')).forEach(v => {
          vehicleLookup.set(v.id?.toString(), { regNo: v.regNo, assetName: v.assetName, zone: v.zone })
        })
      }
    } catch { }

    const result = []
    seriesMap.forEach((data, assetId) => {
      data.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
      const info = vehicleLookup.get(assetId) || {}
      result.push({
        assetId,
        regNo: (info.regNo || assetId).toString().trim(),
        assetName: info.assetName || '',
        zone: info.zone || '',
        data,
      })
    })

    res.json(result)
  } catch {
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
    const includeTrips = tripsParam !== '0' && tripsParam !== 'false'
    const data = computeConsumption({ period, from, to, siteFilter: site, includeTrips })
    res.json(data)
  } catch {
    res.status(500).end('Internal Server Error')
  }
})

// Operational KPIs — utilization, availability, harsh braking, overspeeding, fatigue
app.get('/api/kpi', (req, res) => {
  if (!isAuthorized(req)) return unauthorized(res)
  try {
    const data = computeKpi({
      period: req.query.period || 'week',
      from: req.query.from,
      to: req.query.to,
      scope: req.query.scope || 'quarry',
    })
    res.json(data)
  } catch {
    res.status(500).end('Internal Server Error')
  }
})

// Serve built frontend
app.use(express.static(path.join(__dirname, 'dist')))

// All other routes serve index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// Start server and polling
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 JMG Dashboard server running on port ${PORT}`)
  console.log(`📡 Starting MiX polling...`)
  startPolling({ maxRuns: null })
})