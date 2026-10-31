const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const system = require('./system')
const paths = require('./paths')
const { health, openBrowser } = require('./server')
const { version: VERSION } = require('../package.json')

const SOURCE = 'github:DevKazonovic/mac-dashboard'
const NPM_PERMISSIONS = 'https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally'
const START_TIMEOUT_MS = 20000
const STOP_TIMEOUT_MS = 5000
const STABLE_NODES = ['/opt/homebrew/bin/node', '/usr/local/bin/node']
const VERSION_MANAGERS = ['/.nvm/', '/.fnm/', '/.volta/', '/.asdf/', '/.nodenv/', '/n/versions/', '/mise/']
const DOMAIN = `gui/${process.getuid()}`
const SERVICE = `${DOMAIN}/${paths.LABEL}`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(paths.STATE_FILE, 'utf8'))
    return state && Number.isInteger(state.port) ? state : null
  } catch {
    return null
  }
}

function installKind() {
  if (__dirname.includes(`${path.sep}_npx${path.sep}`)) return 'npx'
  if (__dirname.includes(`${path.sep}node_modules${path.sep}`)) return 'global'
  return 'clone'
}

function commandName() {
  const kind = installKind()
  if (kind === 'npx') return `npx -y ${SOURCE}`
  if (kind === 'global') return 'mac-dashboard'
  return `node ${path.relative(process.cwd(), paths.BIN) || paths.BIN}`
}

function lastLog(lines) {
  try {
    return fs.readFileSync(paths.LOG_FILE, 'utf8').trim().split('\n').slice(-lines).join('\n')
  } catch {
    return ''
  }
}

async function findRunning(port) {
  const state = readState()
  for (const candidate of new Set([state && state.port, port].filter(Boolean))) {
    const info = await health(candidate)
    if (info) return { pid: info.pid, port: candidate, url: `http://${paths.HOST}:${candidate}/` }
  }
  return null
}

async function waitForRunning(port) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    const running = await findRunning(port)
    if (running) return running
    await sleep(250)
  }
  return null
}

async function isDashboard(pid) {
  const command = await system.run('ps', ['-p', String(pid), '-o', 'args=']).catch(() => '')
  return command.includes('mac-dashboard')
}

async function stopProcess(running) {
  if (!Number.isInteger(running.pid)) {
    throw new Error(`An older copy of the dashboard runs at ${running.url}. Stop it, then try again.`)
  }
  if (!(await isDashboard(running.pid))) {
    throw new Error(`Process ${running.pid} answers at ${running.url} but is not mac-dashboard, so it was left alone.`)
  }
  try {
    process.kill(running.pid, 'SIGTERM')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
  const startedAt = Date.now()
  while (alive(running.pid) && Date.now() - startedAt < STOP_TIMEOUT_MS) await sleep(100)
  if (alive(running.pid)) process.kill(running.pid, 'SIGKILL')
}

async function agentLoaded() {
  try {
    await system.run('launchctl', ['print', SERVICE])
    return true
  } catch {
    return false
  }
}

function startupFailed() {
  console.error('The dashboard did not start.')
  const tail = lastLog(8)
  if (tail) console.error(tail)
  console.error(`Full log: ${paths.home(paths.LOG_FILE)}`)
  process.exitCode = 1
}

function serverArgs(options) {
  return [
    paths.BIN,
    '--no-open',
    '--port',
    String(options.port),
    '--state-file',
    paths.STATE_FILE,
    ...options.projectDirs.flatMap((dir) => ['--projects-dir', path.resolve(dir)]),
  ]
}

async function start(options) {
  const running = await findRunning(options.port)
  if (running) {
    console.log(`Mac dashboard is already running at ${running.url}`)
    if (options.open) openBrowser(running.url)
    return
  }
  if (await agentLoaded()) {
    await system.run('launchctl', ['kickstart', SERVICE])
  } else {
    fs.mkdirSync(paths.LOG_DIR, { recursive: true })
    const log = fs.openSync(paths.LOG_FILE, 'a')
    const child = spawn(process.execPath, serverArgs(options), { detached: true, stdio: ['ignore', log, log] })
    fs.closeSync(log)
    child.unref()
  }
  const started = await waitForRunning(options.port)
  if (!started) return startupFailed()
  console.log(`Mac dashboard is running at ${started.url}`)
  console.log(`It keeps running after you close this terminal. Stop it with ${commandName()} stop`)
  if (options.open) openBrowser(started.url)
}

async function stop(options) {
  const running = await findRunning(options.port)
  if (!running) {
    console.log('Mac dashboard is not running.')
    return
  }
  await stopProcess(running)
  console.log(`Stopped Mac dashboard at ${running.url}`)
  if (fs.existsSync(paths.AGENT_FILE)) console.log('It starts again the next time you log in.')
}

async function restart(options) {
  if (await agentLoaded()) {
    await system.run('launchctl', ['kickstart', '-k', SERVICE])
    const started = await waitForRunning(options.port)
    if (!started) return startupFailed()
    console.log(`Restarted Mac dashboard at ${started.url}`)
    return
  }
  const running = await findRunning(options.port)
  if (running) await stopProcess(running)
  await start({ ...options, open: false })
}

async function status(options) {
  const running = await findRunning(options.port)
  console.log(running ? `Running at ${running.url}` : `Not running. Start it with ${commandName()} start`)
  console.log(
    fs.existsSync(paths.AGENT_FILE)
      ? `Starts by itself when you log in. Log: ${paths.home(paths.LOG_FILE)}`
      : `Doesn’t start at login. Turn that on with ${commandName()} enable`,
  )
}

async function nodeVersion(file) {
  try {
    const out = await system.run(file, ['--version'], { timeout: 5000 })
    return Number((/^v(\d+)/.exec(out.trim()) || [])[1]) || 0
  } catch {
    return 0
  }
}

async function nodeForAgent() {
  const current = process.execPath
  if (!VERSION_MANAGERS.some((part) => current.includes(part))) return current
  for (const candidate of STABLE_NODES) {
    if (fs.existsSync(candidate) && (await nodeVersion(candidate)) >= 18) return candidate
  }
  return current
}

function xml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function agentPlist(node, options) {
  const args = [node, ...serverArgs(options)]
  const envPath = [path.dirname(node), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    .filter((dir, index, all) => all.indexOf(dir) === index)
    .join(':')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(paths.LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xml(arg)}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(envPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(paths.LOG_FILE)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(paths.LOG_FILE)}</string>
</dict>
</plist>
`
}

async function bootstrap() {
  let lastError = null
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await system.run('launchctl', ['bootstrap', DOMAIN, paths.AGENT_FILE])
      return
    } catch (error) {
      lastError = error
      await sleep(500)
    }
  }
  throw new Error(`macOS refused to load the login item: ${String(lastError.stderr || lastError.message).trim()}`)
}

async function enable(options) {
  if (installKind() === 'npx') {
    console.error(`Starting at login needs an installed copy. Install it with npm install -g ${SOURCE}, then run mac-dashboard enable`)
    process.exitCode = 1
    return
  }
  const loaded = await agentLoaded()
  const running = await findRunning(options.port)
  if (running && !loaded) await stopProcess(running)
  const node = await nodeForAgent()
  for (const dir of [path.dirname(paths.AGENT_FILE), paths.LOG_DIR, paths.STATE_DIR]) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(paths.AGENT_FILE, agentPlist(node, options))
  if (loaded) await system.run('launchctl', ['bootout', SERVICE]).catch(() => null)
  await bootstrap()
  const started = await waitForRunning(options.port)
  if (!started) return startupFailed()
  console.log(`Mac dashboard is running at ${started.url}, and it starts by itself every time you log in.`)
  console.log(`It runs with the Node.js at ${paths.home(node)}. If you remove that Node.js, run ${commandName()} enable again.`)
  if (options.open) openBrowser(started.url)
}

async function disable() {
  const loaded = await agentLoaded()
  if (loaded) await system.run('launchctl', ['bootout', SERVICE]).catch(() => null)
  const existed = fs.existsSync(paths.AGENT_FILE)
  fs.rmSync(paths.AGENT_FILE, { force: true })
  if (!loaded && !existed) {
    console.log('Mac dashboard was not set to start at login.')
    return
  }
  console.log('Mac dashboard no longer starts at login, and it is stopped now.')
  console.log(`Run it any time with ${commandName()} start`)
}

function installedVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}

function npm(args) {
  return new Promise((resolve) => {
    const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', (error) => resolve({ ok: false, output: error.message }))
    child.on('close', (code) => resolve({ ok: code === 0, output }))
  })
}

async function update() {
  const kind = installKind()
  if (kind === 'npx') return console.log('npx already runs the newest version each time, so there is nothing to update.')
  if (kind === 'clone') return console.log('This copy runs from a cloned folder. Update it with git pull in that folder.')
  console.log('Installing the newest version from GitHub…')
  const result = await npm(['install', '-g', SOURCE])
  if (!result.ok) {
    console.error('The update failed.')
    const tail = result.output.trim().split('\n').slice(-6).join('\n')
    if (tail) console.error(tail)
    if (result.output.includes('EACCES')) console.error(`npm cannot write to its global folder. Do not use sudo; follow ${NPM_PERMISSIONS}`)
    process.exitCode = 1
    return
  }
  console.log(`Installed the newest version from GitHub (mac-dashboard ${installedVersion() || VERSION}).`)
  if (await agentLoaded()) {
    await system.run('launchctl', ['kickstart', '-k', SERVICE]).catch(() => null)
    console.log('Restarted the dashboard so it runs the new version.')
  }
}

module.exports = { start, stop, restart, status, enable, disable, update }
