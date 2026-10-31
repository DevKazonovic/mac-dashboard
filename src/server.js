const fs = require('fs')
const http = require('http')
const path = require('path')
const { spawn } = require('child_process')
const { createSampler } = require('./sampler')
const { createStorage } = require('./storage')
const { createDemoSampler, createDemoStorage } = require('./demo')
const { APP_ID, HOST } = require('./paths')
const { version: VERSION } = require('../package.json')

const PORT_ATTEMPTS = 20
const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const PAGE = ['index.html', 'text/html; charset=utf-8']
const STATIC_FILES = {
  '/': PAGE,
  '/index.html': PAGE,
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
}
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
}

function send(res, status, body, type) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type })
  res.end(body)
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8')
}

function sameOrigin(req) {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin') return false
  return req.headers.origin === `http://${req.headers.host}`
}

function createHandler(sampler, storage, port, log) {
  const allowedHosts = new Set([`${HOST}:${port}`, `localhost:${port}`])
  return (req, res) => {
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8')
    const url = new URL(req.url, `http://${req.headers.host}`)
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(res, 200, { app: APP_ID, version: VERSION, status: 'ready', pid: process.pid })
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return sendJson(res, 200, sampler.snapshot(storage.view()))
      if (req.method === 'POST' && url.pathname === '/api/storage/measure') {
        if (!sameOrigin(req)) return sendJson(res, 403, { error: 'This request did not come from the dashboard page.' })
        storage.measure()
        return sendJson(res, 202, storage.view())
      }
      if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8')
      const file = STATIC_FILES[url.pathname]
      if (!file) return send(res, 404, 'Not found', 'text/plain; charset=utf-8')
      return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, file[0])), file[1])
    } catch (error) {
      log(`${req.method} ${url.pathname} failed: ${error.message}`)
      return sendJson(res, 500, { error: 'The dashboard server hit an error. Its log says what happened.' })
    }
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, HOST)
  })
}

function health(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: '/api/health', headers: { host: `${HOST}:${port}` }, timeout: 1500 }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        try {
          const info = JSON.parse(body)
          resolve(info && info.app === APP_ID ? info : null)
        } catch {
          resolve(null)
        }
      })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
  })
}

function openBrowser(url) {
  const child = spawn('open', [url], { detached: true, stdio: 'ignore' })
  child.on('error', () => console.log(`Could not open a browser. Open ${url} yourself.`))
  child.unref()
}

function saveState(file, port, url) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, port, url, startedAt: Date.now() }))
  process.on('exit', () => {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (saved.pid === process.pid) fs.rmSync(file, { force: true })
    } catch {}
  })
}

async function start(options) {
  for (let port = options.port; port < options.port + PORT_ATTEMPTS; port++) {
    const url = `http://${HOST}:${port}/`
    if (await health(port)) {
      console.log(`Mac dashboard is already running at ${url}`)
      if (options.open) openBrowser(url)
      return
    }
    const sampler = options.demo ? createDemoSampler() : createSampler()
    const storage = options.demo ? createDemoStorage() : createStorage({ projectDirs: options.projectDirs })
    const server = http.createServer(createHandler(sampler, storage, port, (text) => console.error(text)))
    try {
      await listen(server, port)
    } catch (error) {
      if (error.code === 'EADDRINUSE') continue
      throw error
    }
    sampler.start()
    storage.start()
    if (options.stateFile) saveState(options.stateFile, port, url)
    console.log(`Mac dashboard running at ${url}${options.demo ? ' with made-up demo data' : ''}`)
    if (port !== options.port) console.log(`Port ${options.port} is in use, so the dashboard runs on port ${port}`)
    if (options.foreground && process.stdout.isTTY) console.log('Press Ctrl+C to stop it.')
    if (options.open) openBrowser(url)
    const quit = () => {
      sampler.stop()
      storage.stop()
      server.close()
      process.exit(0)
    }
    process.once('SIGINT', quit)
    process.once('SIGTERM', quit)
    return
  }
  throw new Error(`Ports ${options.port} to ${options.port + PORT_ATTEMPTS - 1} are all in use. Pick another one with --port.`)
}

module.exports = { start, health, openBrowser }
