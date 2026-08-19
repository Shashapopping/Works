import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pollOnce, startPolling, clearTriggeredEvent, resetState, getWarningEvents, getSessionTrips, getDriverDistanceSummary, getHosRecords, getFleetSafetyExposure, getSafetySummary, getRiskDrivers } from './scripts/mix-test.js'
import { resolveEnvironment } from './scripts/environment-service.js'
import { computeConsumption } from './scripts/consumption-engine.js'
import { computeKpi } from './scripts/kpi-engine.js'
import { getFuelHistory } from './scripts/db.js'
import { handleEventsLogQuery } from './scripts/events-log-api.js'
import { bootstrapAdminIfNeeded } from './scripts/auth.js'
import { authViteMiddleware } from './scripts/auth-http.js'
import { startReportAutomateScheduler } from './scripts/report-automate.js'
import * as dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

dotenv.config({ override: true })

const ACKNOWLEDGED_FILE = path.join(process.cwd(), 'public', 'acknowledged.json')
const API_SECRET = process.env.API_SECRET

function loadAcknowledged(): string[] {
  try {
    if (fs.existsSync(ACKNOWLEDGED_FILE)) {
      return JSON.parse(fs.readFileSync(ACKNOWLEDGED_FILE, 'utf8'))
    }
  } catch { }
  return []
}

function saveAcknowledged(ids: string[]) {
  fs.writeFileSync(ACKNOWLEDGED_FILE, JSON.stringify(ids, null, 2))
}

function isAuthorized(req: any): boolean {
  const secret = req.headers['x-api-secret']
  return secret === API_SECRET
}

let pollingStarted = false

export default defineConfig({
  server: {
    host: true,
    watch: {
      ignored: ['**/scripts/mix-test.js', '**/public/data.json', '**/public/metadata.json', '**/public/acknowledged.json', '**/public/drivers.json', '**/public/vehicles.json', '**/events.log', '**/panic.log', '**/kpi-events.log'],
    },
  },
  plugins: [
    react(),
    {
      name: 'mix-data-poller',
      configureServer(server) {
        if (!pollingStarted) {
          startPolling({ maxRuns: null })
          pollingStarted = true
          bootstrapAdminIfNeeded().catch((e: any) => {
            console.log('⚠️ Auth bootstrap skipped:', e?.message || e)
          })
          try {
            startReportAutomateScheduler()
          } catch (e: any) {
            console.log('⚠️ Report Automate scheduler skipped:', e?.message || e)
          }
        }

        // Auth / users / roles (session cookies)
        server.middlewares.use(authViteMiddleware())

        // POST /api/refresh
        server.middlewares.use('/api/refresh', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          const result = await pollOnce()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
        })

        // GET|POST /api/acknowledged
        server.middlewares.use('/api/acknowledged', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(loadAcknowledged()))
            return
          }
          if (req.method === 'POST') {
            let body = ''
            req.on('data', (chunk: Buffer) => { body += chunk.toString() })
            req.on('end', () => {
              try {
                const { id } = JSON.parse(body)
                const ids = loadAcknowledged()
                if (!ids.includes(id)) { ids.push(id); saveAcknowledged(ids) }
                clearTriggeredEvent(id)
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok: true }))
              } catch { res.statusCode = 400; res.end('Bad Request') }
            })
            return
          }
          res.statusCode = 405; res.end('Method Not Allowed')
        })

        // POST /api/reset
        server.middlewares.use('/api/reset', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          resetState()
          saveAcknowledged([])
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        })

        // GET /api/data
        server.middlewares.use('/api/data', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const data = fs.readFileSync(path.join(process.cwd(), 'public', 'data.json'), 'utf8')
            res.setHeader('Content-Type', 'application/json')
            res.end(data)
          } catch { res.statusCode = 404; res.end('Not Found') }
        })

        // GET /api/metadata
        server.middlewares.use('/api/metadata', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const data = fs.readFileSync(path.join(process.cwd(), 'public', 'metadata.json'), 'utf8')
            res.setHeader('Content-Type', 'application/json')
            res.end(data)
          } catch { res.statusCode = 404; res.end('Not Found') }
        })

        // GET /api/events — in-memory warning events
        server.middlewares.use('/api/events', (req, res, next) => {
          if ((req.url || '').startsWith('/log')) { next(); return }
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(getWarningEvents()))
        })

        // GET /api/events/log — SQLite (same shape as production server.js)
        server.middlewares.use('/api/events/log', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const qs = (req.originalUrl || req.url || '').split('?')[1] || ''
            const params = new URLSearchParams(qs)
            const body = handleEventsLogQuery({
              from: params.get('from'),
              to: params.get('to'),
              types: params.get('types'),
              limit: params.get('limit'),
              offset: params.get('offset'),
              format: params.get('format'),
              driver: params.get('driver'),
            })
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(body))
          } catch (err) {
            console.error('events/log failed:', (err as Error)?.message || err)
            res.statusCode = 500
            res.end('Internal Server Error')
          }
        })

        // GET /api/fuel/history?period=day|week|month OR ?from=YYYY-MM-DD&to=YYYY-MM-DD
        server.middlewares.use('/api/fuel/history', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const qs = (req.originalUrl || req.url || '').split('?')[1] || ''
            const params = new URLSearchParams(qs)
            const period = params.get('period') || 'day'
            const fromQ = params.get('from')
            const toQ = params.get('to')
            const now = Date.now()

            let cutoffStart: number
            let cutoffEnd = now
            if (fromQ && toQ) {
              cutoffStart = new Date(fromQ).getTime()
              const toDate = new Date(toQ)
              toDate.setHours(23, 59, 59, 999)
              cutoffEnd = toDate.getTime()
              if (Number.isNaN(cutoffStart) || Number.isNaN(cutoffEnd)) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'Invalid from/to dates' }))
                return
              }
            } else {
              const cutoffs: Record<string, number> = { day: 86400000, week: 604800000, month: 2592000000 }
              cutoffStart = now - (cutoffs[period] || cutoffs.day)
            }

            // All probe rows (5min / 1min / trip start-end). Restricting to 5min
            // dropped assets that still have live fuel and a drawable series.
            const entries = getFuelHistory({
              fromIso: new Date(cutoffStart).toISOString(),
              toIso: new Date(cutoffEnd).toISOString(),
            })

            const seriesMap = new Map<string, { time: string; level: number }[]>()
            entries.forEach(entry => {
              if (!seriesMap.has(entry.assetId)) seriesMap.set(entry.assetId, [])
              seriesMap.get(entry.assetId)!.push({ time: entry.timestamp, level: Math.max(0, entry.level) })
            })

            const vehicleLookup = new Map<string, any>()
            try {
              const dataPath = path.join(process.cwd(), 'public', 'data.json')
              if (fs.existsSync(dataPath)) {
                JSON.parse(fs.readFileSync(dataPath, 'utf8')).forEach((v: any) => {
                  vehicleLookup.set(v.id?.toString(), { regNo: v.regNo, assetName: v.assetName, zone: v.zone })
                })
              }
            } catch { }

            const result: any[] = []
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

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
          } catch { res.statusCode = 500; res.end('Internal Server Error') }
        })

        // GET /api/fuel/consumption?period=day|week|month&site=QUARRY+EWEKORO OR ?from=&to=
        server.middlewares.use('/api/fuel/consumption', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const qs = (req.originalUrl || req.url || '').split('?')[1] || ''
            const params = new URLSearchParams(qs)
            const period = params.get('period') || 'week'
            const from = params.get('from')
            const to = params.get('to')
            const site = params.get('site')
            const tripsParam = params.get('trips')
            const includeTrips = tripsParam !== '0' && tripsParam !== 'false'
            const data = computeConsumption({ period, from, to, siteFilter: site, includeTrips })
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
          } catch { res.statusCode = 500; res.end('Internal Server Error') }
        })

        // GET /api/kpi?period=day|week|month&scope=quarry|all OR ?from=&to=
        server.middlewares.use('/api/kpi', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const qs = (req.originalUrl || req.url || '').split('?')[1] || ''
            const params = new URLSearchParams(qs)
            const data = computeKpi({
              period: params.get('period') || 'week',
              from: params.get('from'),
              to: params.get('to'),
              scope: params.get('scope') || 'quarry',
            })
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
          } catch { res.statusCode = 500; res.end('Internal Server Error') }
        })

        // GET /api/environment — weather + traffic at incident coordinates
        server.middlewares.use('/api/environment', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const qs = (req.originalUrl || req.url || '').split('?')[1] || ''
            const params = new URLSearchParams(qs)
            const lat = parseFloat(params.get('lat') || '')
            const lng = parseFloat(params.get('lng') || '')
            const hasCoords = !isNaN(lat) && !isNaN(lng)
            const address = params.get('address') || ''
            if (!hasCoords && !address) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'lat/lng or address required' }))
              return
            }
            const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY
            const tomTomApiKey = process.env.TOMTOM_API_KEY || process.env.VITE_TOMTOM_API_KEY
            const environment = await resolveEnvironment({
              lat: hasCoords ? lat : null,
              lng: hasCoords ? lng : null,
              address,
              timestamp: params.get('timestamp') || new Date().toISOString(),
              googleApiKey,
              tomTomApiKey,
            })
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(environment))
          } catch {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Environment lookup failed' }))
          }
        })

        // GET /api/trips/session
        server.middlewares.use('/api/trips/session', (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(getSessionTrips()))
        })

        // GET /api/driver-distance?range=today|7d|24h|currentMonth|lastMonth|month&month=YYYY-MM (or from/to)
        server.middlewares.use('/api/driver-distance', (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          const qs = (req.originalUrl || req.url || '').split('?')[1] || ''
          const params = new URLSearchParams(qs)
          // Strip journeys arrays — kept in-memory for per-asset detail route
          if ((req.originalUrl || req.url || '').includes('/journeys/')) { res.statusCode = 404; res.end('Not Found'); return }
          const tripsParam = params.get('trips')
          const includeTrips = tripsParam !== '0' && tripsParam !== 'false'
          const summary = getDriverDistanceSummary({
            range: params.get('range') || '24h',
            month: params.get('month') || null,
            from: params.get('from') || null,
            to: params.get('to') || null,
            includeTrips,
          })
          const includeJourneys = params.get('includeJourneys') === '1' || params.get('includeJourneys') === 'true'
          const slim = includeJourneys
            ? summary
            : { ...summary, assets: summary.assets.map(({ journeys, trips, ...rest }: any) => rest) }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(slim))
        })

        // GET /api/hos?date=YYYY-MM-DD — hours-of-service continuous-driving records
        server.middlewares.use('/api/hos', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const qs = (req.originalUrl || req.url || '').split('?')[1] || ''
            const params = new URLSearchParams(qs)
            const data = getHosRecords(params.get('date') || undefined)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
          } catch { res.statusCode = 500; res.end('Internal Server Error') }
        })

        // GET /api/safety-exposure?range=30d|prev30d — km + HOS held minutes
        server.middlewares.use('/api/safety-exposure', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const qs = (req.originalUrl || req.url || '').split('?')[1] || ''
            const params = new URLSearchParams(qs)
            const data = getFleetSafetyExposure({
              range: params.get('range') || '30d',
              from: params.get('from') || null,
              to: params.get('to') || null,
              assetIds: params.get('assetIds') || null,
            })
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
          } catch { res.statusCode = 500; res.end('Internal Server Error') }
        })

        server.middlewares.use('/api/safety/summary', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const qs = (req.originalUrl || req.url || '').split('?')[1] || ''
            const params = new URLSearchParams(qs)
            const data = getSafetySummary({
              range: params.get('range') || '30d',
              from: params.get('from') || null,
              to: params.get('to') || null,
              assetIds: params.get('assetIds') || null,
            })
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
          } catch { res.statusCode = 500; res.end('Internal Server Error') }
        })

        server.middlewares.use('/api/risk/drivers', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const qs = (req.originalUrl || req.url || '').split('?')[1] || ''
            const params = new URLSearchParams(qs)
            const data = getRiskDrivers({
              range: params.get('range') || '30d',
              from: params.get('from') || null,
              to: params.get('to') || null,
            })
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
          } catch { res.statusCode = 500; res.end('Internal Server Error') }
        })

        // GET /api/drivers
        server.middlewares.use('/api/drivers', async (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          try {
            const driversPath = path.join(process.cwd(), 'public', 'drivers.json')
            if (!fs.existsSync(driversPath)) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([])); return }
            res.setHeader('Content-Type', 'application/json')
            res.end(fs.readFileSync(driversPath, 'utf8'))
          } catch { res.statusCode = 404; res.end('Not Found') }
        })
      },
    },
  ],
})
