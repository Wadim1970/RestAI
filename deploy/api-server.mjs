// Мини-сервер вместо Vercel Functions: запускает обработчики из папки api/
// приложения как есть, без переписывания. Без внешних зависимостей.
//
//   node deploy/api-server.mjs --dir /opt/restai/RestAI --port 3001
//
// Маршруты строятся по файлам, как у Vercel: api/menu.js → /api/menu,
// api/waiter/suggest.js → /api/waiter/suggest. Папки с "_" (api/_lib) —
// служебные, наружу не публикуются. Переменные окружения берутся из
// <dir>/.env.production (тот же файл читает vite при сборке).
//
// Статику отдаёт nginx; этот процесс обслуживает только /api/*.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns'
import { pathToFileURL } from 'node:url'

// Кэш DNS для исходящих запросов (Supabase, DeepSeek, …). DNS хостера
// время от времени не отвечает, и каждый поиск адреса ждёт 5 с таймаута —
// а соединения к базе после паузы открываются заново, поэтому страница
// админки после простоя грузилась 5–20 с. Теперь адрес берётся из памяти;
// раз в 5 минут обновляется в фоне, не задерживая запрос; при сбое DNS
// остаётся последний известный. fetch в Node ищет адреса через dns.lookup.
const DNS_FRESH_MS = 5 * 60_000
const DNS_KEEP_MS = 24 * 3600_000
const dnsCache = new Map()
const systemLookup = dns.lookup.bind(dns)
function answer(entry, options, callback) {
  if (options.all) callback(null, entry.addresses)
  else callback(null, entry.addresses[0].address, entry.addresses[0].family)
}
dns.lookup = function cachedLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {} }
  if (typeof options === 'number') options = { family: options }
  options = options || {}
  const key = `${hostname}|${options.family || 0}`
  const hit = dnsCache.get(key)
  const age = hit ? Date.now() - hit.at : Infinity
  const refresh = (cb) => systemLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (!err && addresses?.length) dnsCache.set(key, { at: Date.now(), addresses })
    cb?.(err, addresses)
  })
  if (hit && age < DNS_KEEP_MS) {
    if (age > DNS_FRESH_MS && !hit.refreshing) {
      hit.refreshing = true
      refresh(() => { hit.refreshing = false })
    }
    process.nextTick(answer, hit, options, callback)
    return
  }
  refresh((err, addresses) => {
    if (err || !addresses?.length) return callback(err || new Error(`DNS: нет адреса для ${hostname}`))
    answer({ addresses }, options, callback)
  })
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : def
}

const appDir = path.resolve(arg('dir', process.cwd()))
const port = Number(arg('port', 3001))

// .env.production → process.env (не перезатираем уже заданные переменные).
const envFile = path.join(appDir, '.env.production')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

// Таблица маршрутов: /api/<путь> → абсолютный путь к файлу обработчика.
function collectRoutes(dir, prefix = '/api') {
  const routes = new Map()
  if (!fs.existsSync(dir)) return routes
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      for (const [k, v] of collectRoutes(full, `${prefix}/${entry.name}`)) routes.set(k, v)
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      routes.set(`${prefix}/${entry.name.replace(/\.m?js$/, '')}`, full)
    }
  }
  return routes
}

const routes = collectRoutes(path.join(appDir, 'api'))
const handlers = new Map()

async function loadHandler(route) {
  if (!handlers.has(route)) {
    const mod = await import(pathToFileURL(routes.get(route)).href)
    handlers.set(route, mod.default)
  }
  return handlers.get(route)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 1_000_000) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// Надстройки над req/res в стиле Vercel: req.query, req.body,
// res.status(), res.json(), res.send().
function decorate(req, res, url, rawBody) {
  req.query = Object.fromEntries(url.searchParams)
  const type = String(req.headers['content-type'] || '')
  if (rawBody && type.includes('application/json')) {
    try { req.body = JSON.parse(rawBody) } catch { req.body = rawBody }
  } else {
    req.body = rawBody || undefined
  }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(obj))
    return res
  }
  res.send = (body) => {
    if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body)
    res.end(body)
    return res
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const route = url.pathname.replace(/\/+$/, '')

  if (route === '/api/__health') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, routes: [...routes.keys()] }))
    return
  }
  if (!routes.has(route)) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  try {
    const rawBody = ['GET', 'HEAD'].includes(req.method) ? '' : await readBody(req)
    decorate(req, res, url, rawBody)
    const handler = await loadHandler(route)
    await handler(req, res)
    if (!res.writableEnded) res.end()
  } catch (err) {
    console.error(`[${route}]`, err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
    }
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'internal error' }))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`api-server: ${appDir} → http://127.0.0.1:${port} (${[...routes.keys()].join(', ')})`)
})
