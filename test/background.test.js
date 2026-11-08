const test = require('node:test')
const assert = require('node:assert/strict')
const { buildView } = require('../src/background')

const MB = 1024 ** 2

function proc(pid, ppid, file, args = '', mem = 100 * MB) {
  return { pid, ppid, path: file, args, mem, cpu: 0, age: 600 }
}

function view(processes, scan = {}) {
  return buildView({
    processes,
    facts: { projects: new Map(), sessions: 0, devices: 0 },
    context: { selfPid: -1, cwd: new Map(scan.cwd || []), docker: null },
    cores: 10,
    scan: {
      foreground: new Set(scan.foreground || []),
      services: new Map(scan.services || []),
      ports: new Map(scan.ports || []),
      docker: scan.docker || { state: 'ready', containers: [], error: null },
      errors: scan.errors || [],
    },
  })
}

function rows(result, key) {
  return result.sections.find((section) => section.key === key).rows
}

test('a launchd job holds its whole process tree as one service', () => {
  const result = view([proc(10, 1, '/bin/bash'), proc(11, 10, './externals/node24/bin/node'), proc(12, 11, '/Users/me/runner/bin/Runner.Listener')], {
    services: [[10, 'actions.runner.shop-app.mini-shop']],
  })
  const [service] = rows(result, 'services')
  assert.equal(service.name, 'GitHub runner shop-app')
  assert.equal(service.parts.length, 3)
  assert.equal(rows(result, 'programs').length, 0)
})

test('open apps and macOS stay out of the count at the top', () => {
  const chrome = '/Applications/Google Chrome.app'
  const result = view(
    [
      proc(1, 0, '/sbin/launchd'),
      proc(20, 1, `${chrome}/Contents/MacOS/Google Chrome`),
      proc(21, 20, `${chrome}/Contents/Frameworks/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)`, '--type=renderer'),
      proc(30, 1, '/usr/libexec/trustd'),
      proc(31, 1, 'autofsd'),
    ],
    { foreground: [chrome], services: [[31, 'com.apple.autofsd']] },
  )
  assert.equal(result.title, 'Only macOS is running in the background')
  const [macos, open] = rows(result, 'rest')
  assert.equal(macos.note, 'Apple’s own services, 3 processes')
  assert.equal(open.note, '1 app with a Dock icon, 2 processes')
  assert.equal(open.parts[0].name, 'Chrome')
})

test('a dev server started in an app’s terminal is listed by its folder', () => {
  const iterm = '/Applications/iTerm.app'
  const node = '/opt/homebrew/bin/node'
  const result = view(
    [proc(40, 1, `${iterm}/Contents/MacOS/iTerm2`), proc(41, 40, '/bin/zsh'), proc(42, 41, node, `${node} /tmp/node_modules/.bin/vite`), proc(43, 42, '/tmp/node_modules/esbuild/bin/esbuild')],
    { foreground: [iterm], ports: [[42, [5173, 24678]]], cwd: [[42, '/Users/me/Projects/shop-web']] },
  )
  const [server] = rows(result, 'programs')
  assert.equal(server.name, 'shop-web')
  assert.equal(server.note, 'Vite dev server, 2 processes')
  assert.equal(server.ports, ':5173 :24678')
  assert.equal(rows(result, 'rest')[0].parts[0].name, 'iTerm')
})

test('a program that holds a port is listed even when an app started it', () => {
  const iterm = '/Applications/iTerm.app'
  const result = view([proc(50, 1, `${iterm}/Contents/MacOS/iTerm2`), proc(51, 50, '/opt/homebrew/bin/redis-server'), proc(52, 50, '/opt/homebrew/bin/rg')], {
    foreground: [iterm],
    ports: [[51, [6379]]],
  })
  assert.deepEqual(rows(result, 'programs').map((row) => row.name), ['redis-server'])
})

test('a bundle with no Dock icon is a hidden app, and Apple’s are macOS', () => {
  const result = view([proc(60, 1, '/Applications/Rectangle.app/Contents/MacOS/Rectangle'), proc(61, 1, '/System/Library/CoreServices/WiFiAgent.app/Contents/MacOS/WiFiAgent')])
  assert.deepEqual(rows(result, 'apps').map((row) => row.name), ['Rectangle'])
  assert.equal(rows(result, 'rest')[0].name, 'macOS')
})

test('a process name never carries its arguments to the page', () => {
  const result = view([proc(70, 1, 'npm run deploy --token=SECRET'), proc(71, 1, '/usr/local/bin/worker --password=SECRET', '/usr/local/bin/worker --password=SECRET'), proc(72, 1, 'nginx: master process -c /etc/SECRET.conf')])
  assert.ok(!JSON.stringify(result).includes('SECRET'))
})

test('a full path never reaches the page, only names', () => {
  const home = '/Users/me/Library/Application Support/Old Editor'
  const result = view([proc(80, 1, `${home}/Old Editor.app/Contents/MacOS/Old Editor`), proc(81, 1, `/Users/me/Applications/Open.app/Contents/MacOS/Open`), proc(82, 1, '/Users/me/bin/worker')], {
    foreground: ['/Users/me/Applications/Open.app'],
    cwd: [[82, '/Users/me/Projects/shop']],
  })
  assert.ok(!JSON.stringify(result).includes('/Users/me'))
  assert.deepEqual(rows(result, 'apps').map((row) => row.name), ['Old Editor'])
})

test('Docker’s state decides what its section says', () => {
  const launchd = [proc(1, 0, '/sbin/launchd')]
  const docker = (state, error = null) => view(launchd, { docker: { state, containers: [], error } }).sections.find((section) => section.key === 'docker')
  assert.equal(docker('missing'), undefined)
  assert.equal(docker('stopped').empty.title, 'Docker isn’t running')
  assert.equal(docker('ready').empty.title, 'No containers running')
  assert.equal(docker('failed', 'Permission denied.').failed.text, 'Permission denied. It tries again in a few seconds.')
})

test('each group in the small sidebar shows its memory, or its worst problem', () => {
  const launchd = [proc(1, 0, '/sbin/launchd'), proc(90, 1, '/opt/homebrew/bin/redis-server')]
  const container = (name, state, status) => ({ name, image: 'shop', project: '', state, health: status, uptime: 60, ports: [] })
  const group = (result, key) => result.groups.find((item) => item.key === key)
  const healthy = view(launchd)
  assert.deepEqual(healthy.groups.map((item) => item.label), ['Docker', 'Programs', 'Services', 'Apps', 'Everything else'])
  assert.deepEqual(group(healthy, 'programs'), { key: 'programs', label: 'Programs', total: '100 MB', level: null })
  assert.equal(group(healthy, 'docker').total, '')
  const docker = { state: 'ready', containers: [container('web', 'restarting', ''), container('db', 'running', 'unhealthy')], error: null }
  assert.deepEqual(group(view(launchd, { docker }), 'docker'), { key: 'docker', label: 'Docker', total: 'Unhealthy', level: 'critical' })
  const failed = { state: 'failed', containers: [], error: 'Permission denied.' }
  assert.deepEqual(group(view(launchd, { docker: failed }), 'docker'), { key: 'docker', label: 'Docker', total: 'Failed', level: 'critical' })
})

test('a failed read reaches the page instead of looking empty', () => {
  const result = view([proc(1, 0, '/sbin/launchd')], { errors: ['Couldn’t read the open ports: It did not answer in time.'] })
  assert.equal(result.error, 'Couldn’t read the open ports: It did not answer in time.')
})
