import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pollOnce, startPolling, clearTriggeredEvent, resetState, getWarningEvents, getSessionTrips, getDriverDistanceSummary } from './scripts/mix-test.js'
import { resolveEnvironment } from './scripts/environment-service.js'
import { computeConsumption } from './scripts/consumption-engine.js'
import { computeKpi } from './scripts/kpi-engine.js'
import { getFuelHistory, getAllEvents } from './scripts/db.js'
import { bootstrapAdminIfNeeded } from './scripts/auth.js'
import { authViteMiddleware } from './scripts/auth-http.js'
import { startReportAutomateScheduler } from './scripts/report-automate.js'
import * as dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

dotenv.config()

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
            const typesRaw = params.get('types')
            const filters = {
              from: params.get('from') || null,
              to: params.get('to') || null,
              types: typesRaw ? typesRaw.split(',').map(t => t.trim()).filter(Boolean) : null,
              limit: params.get('limit') || 5000,
            }

            const vehicleLookup = new Map<string, any>()
            try {
              const dataPath = path.join(process.cwd(), 'public', 'data.json')
              if (fs.existsSync(dataPath)) {
                JSON.parse(fs.readFileSync(dataPath, 'utf8')).forEach((v: any) => {
                  vehicleLookup.set(v.id?.toString(), {
                    regNo: v.regNo || 'N/A',
                    assetName: v.assetName || 'Unknown Vehicle',
                    transporter: v.transporter || 'N/A',
                    position: v.position,
                  })
                })
              }
            } catch { }

            const entries = getAllEvents(filters).map((entry: any) => {
              const vehicle = vehicleLookup.get(entry.asset_id?.toString()) || {}
              const enriched = {
                timestamp: entry.timestamp,
                assetId: entry.asset_id,
                driverId: entry.driver_id,
                driverName: entry.driver_name,
                driverPhone: entry.driver_phone,
                eventId: entry.event_id,
                eventType: entry.event_type,
                label: entry.label,
                eventTime: entry.event_time,
                receivedAt: entry.received_at,
                latitude: entry.latitude,
                longitude: entry.longitude,
                address: entry.address || vehicle.position?.address || null,
                type: entry.type,
                regNo: vehicle.regNo || 'N/A',
                assetName: vehicle.assetName || 'Unknown Vehicle',
                transporter: vehicle.transporter || 'N/A',
              }
              if ((enriched.latitude == null || enriched.longitude == null) && vehicle.position) {
                enriched.latitude = vehicle.position.latitude
                enriched.longitude = vehicle.position.longitude
              }
              if (!enriched.address && vehicle.position?.address) {
                enriched.address = vehicle.position.address
              }
              return enriched
            })

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(entries))
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

            const entries = getFuelHistory({
              fromIso: new Date(cutoffStart).toISOString(),
              toIso: new Date(cutoffEnd).toISOString(),
              eventType: '5min_ticker',
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
            const data = computeConsumption({ period, from, to, siteFilter: site })
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

        // GET /api/driver-distance?range=24h|currentMonth|lastMonth|month&month=YYYY-MM
        server.middlewares.use('/api/driver-distance', (req, res) => {
          if (!isAuthorized(req)) { res.statusCode = 401; res.end('Unauthorized'); return }
          if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          const qs = (req.originalUrl || req.url || '').split('?')[1] || ''
          const params = new URLSearchParams(qs)
          // Strip journeys arrays — kept in-memory for per-asset detail route
          if ((req.originalUrl || req.url || '').includes('/journeys/')) { res.statusCode = 404; res.end('Not Found'); return }
          const summary = getDriverDistanceSummary({
            range: params.get('range') || '24h',
            month: params.get('month') || null,
            from: params.get('from') || null,
            to: params.get('to') || null,
          })
          const slim = { ...summary, assets: summary.assets.map(({ journeys, ...rest }: any) => rest) }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(slim))
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
