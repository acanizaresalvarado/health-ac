import { createServer } from 'node:http'
import { existsSync, statSync, createReadStream, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')
const ROOT_DIR = resolve(__dirname, '..')
const DIST_DIR = resolve(ROOT_DIR, 'dist')
const ENV_PATH = resolve(ROOT_DIR, '.env')

loadDotEnv(ENV_PATH)

const PORT = toInteger(process.env.PORT, 8787)
const API_PATH = (process.env.SYNC_API_PATH || '/api/sheets-sync').trim()
const HEALTH_PATH = (process.env.HEALTH_API_PATH || '/api/health').trim()
const SHEETS_WEBHOOK_URL = (process.env.SHEETS_WEBHOOK_URL || '').trim()
const SHEETS_WRITE_TOKEN = (process.env.SHEETS_WRITE_TOKEN || '').trim()
const REQUEST_TIMEOUT_MS = toInteger(process.env.SYNC_PROXY_TIMEOUT_MS, 12000)
const MAX_ITEMS_PER_REQUEST = toInteger(process.env.SYNC_PROXY_MAX_ITEMS, 500)
const MAX_BODY_BYTES = toInteger(process.env.SYNC_PROXY_MAX_BODY_BYTES, 1_500_000)
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.SYNC_ALLOWED_ORIGINS || '')
const SERVE_STATIC = (process.env.SERVE_STATIC || 'true').toLowerCase() !== 'false'
const FRONTEND_BASE_PATH = normalizeBasePath(process.env.FRONTEND_BASE_PATH || '/health-ac/')
const API_PATH_WITH_BASE = withBasePathPrefix(API_PATH)
const HEALTH_PATH_WITH_BASE = withBasePathPrefix(HEALTH_PATH)

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon'
}

function loadDotEnv(path) {
  if (!existsSync(path)) return
  const raw = readFileSync(path, 'utf8')

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return

    const index = trimmed.indexOf('=')
    if (index <= 0) return

    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  })
}

function toInteger(input, fallback) {
  const parsed = Number.parseInt(String(input || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseAllowedOrigins(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeBasePath(value) {
  const trimmed = (value || '').trim()
  if (!trimmed || trimmed === '/') return '/'
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading
}

function withBasePathPrefix(pathname) {
  if (!pathname || pathname === '/') return FRONTEND_BASE_PATH === '/' ? '/' : FRONTEND_BASE_PATH
  if (FRONTEND_BASE_PATH === '/') return pathname
  const clean = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${FRONTEND_BASE_PATH}${clean}`
}

function isAllowedOrigin(origin) {
  if (!origin) return false
  if (!ALLOWED_ORIGINS.length) return true
  return ALLOWED_ORIGINS.includes(origin)
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

async function readRequestJson(req, maxBytes) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = []
    let totalBytes = 0

    req.on('data', (chunk) => {
      totalBytes += chunk.length
      if (totalBytes > maxBytes) {
        rejectPromise(new Error('request_body_too_large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        const parsed = raw ? JSON.parse(raw) : {}
        resolvePromise(parsed)
      } catch (error) {
        rejectPromise(new Error('invalid_json_body'))
      }
    })

    req.on('error', () => {
      rejectPromise(new Error('request_stream_error'))
    })
  })
}

function createProxyPayload(body) {
  const payload = body && typeof body === 'object' ? { ...body } : {}
  payload.token = SHEETS_WRITE_TOKEN
  return payload
}

async function forwardToSheetsWebhook(body) {
  if (!SHEETS_WEBHOOK_URL || !SHEETS_WRITE_TOKEN) {
    return {
      status: 503,
      payload: {
        ok: false,
        error: 'backend_not_configured',
        detail: 'Define SHEETS_WEBHOOK_URL y SHEETS_WRITE_TOKEN en el backend.'
      }
    }
  }

  const items = Array.isArray(body?.items) ? body.items : []
  if (items.length > MAX_ITEMS_PER_REQUEST) {
    return {
      status: 413,
      payload: {
        ok: false,
        error: 'too_many_items',
        max: MAX_ITEMS_PER_REQUEST,
        received: items.length
      }
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const upstream = await fetch(SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(createProxyPayload(body)),
      signal: controller.signal
    })

    const rawText = await upstream.text()
    let parsed
    try {
      parsed = rawText ? JSON.parse(rawText) : {}
    } catch {
      parsed = {
        ok: false,
        error: 'invalid_upstream_json',
        status: upstream.status,
        raw: rawText.slice(0, 2000)
      }
    }

    return {
      status: upstream.status,
      payload: parsed
    }
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError'
    return {
      status: 504,
      payload: {
        ok: false,
        error: isAbort ? 'upstream_timeout' : 'upstream_network_error',
        detail: error instanceof Error ? error.message : 'unknown_error'
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

function safePathFromUrl(urlPathname) {
  const decoded = decodeURIComponent(urlPathname || '/')
  const clean = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '')
  return clean.startsWith('/') ? clean.slice(1) : clean
}

function stripBasePrefix(pathname) {
  if (!pathname) return '/'
  if (FRONTEND_BASE_PATH === '/') return pathname
  if (pathname === FRONTEND_BASE_PATH || pathname === `${FRONTEND_BASE_PATH}/`) return '/'
  if (pathname.startsWith(`${FRONTEND_BASE_PATH}/`)) {
    return pathname.slice(FRONTEND_BASE_PATH.length)
  }
  return pathname
}

function serveFile(res, absolutePath) {
  const extension = extname(absolutePath).toLowerCase()
  const contentType = MIME_BY_EXT[extension] || 'application/octet-stream'
  res.statusCode = 200
  res.setHeader('Content-Type', contentType)
  createReadStream(absolutePath).pipe(res)
}

function tryServeStatic(req, res) {
  if (!SERVE_STATIC) return false
  if (!existsSync(DIST_DIR)) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') return false

  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const effectivePath = stripBasePrefix(requestUrl.pathname)
  const cleanPath = safePathFromUrl(effectivePath)
  const candidatePath = cleanPath ? join(DIST_DIR, cleanPath) : join(DIST_DIR, 'index.html')

  if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
    serveFile(res, candidatePath)
    return true
  }

  if (!extname(cleanPath)) {
    const indexPath = join(DIST_DIR, 'index.html')
    if (existsSync(indexPath)) {
      serveFile(res, indexPath)
      return true
    }
  }

  return false
}

const server = createServer(async (req, res) => {
  setCorsHeaders(req, res)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'GET' && (url.pathname === HEALTH_PATH || url.pathname === HEALTH_PATH_WITH_BASE)) {
    sendJson(res, 200, {
      ok: true,
      status: 'healthy',
      configured: Boolean(SHEETS_WEBHOOK_URL && SHEETS_WRITE_TOKEN),
      mode: 'backend_proxy',
      syncPath: API_PATH,
      time: new Date().toISOString()
    })
    return
  }

  if (req.method === 'POST' && (url.pathname === API_PATH || url.pathname === API_PATH_WITH_BASE)) {
    try {
      const body = await readRequestJson(req, MAX_BODY_BYTES)
      const result = await forwardToSheetsWebhook(body)
      sendJson(res, result.status, result.payload)
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : 'invalid_request'
      })
    }
    return
  }

  if (tryServeStatic(req, res)) {
    return
  }

  sendJson(res, 404, { ok: false, error: 'not_found' })
})

server.listen(PORT, () => {
  const configured = Boolean(SHEETS_WEBHOOK_URL && SHEETS_WRITE_TOKEN)
  console.log(`[sync-proxy] listening on http://localhost:${PORT}`)
  console.log(`[sync-proxy] endpoint: ${API_PATH}`)
  console.log(`[sync-proxy] endpoint(base): ${API_PATH_WITH_BASE}`)
  console.log(`[sync-proxy] health:   ${HEALTH_PATH}`)
  console.log(`[sync-proxy] health(base):   ${HEALTH_PATH_WITH_BASE}`)
  console.log(`[sync-proxy] configured: ${configured ? 'yes' : 'no'}`)
})
