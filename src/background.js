const os = require('os')
const path = require('path')
const system = require('./system')
const classify = require('./classify')
const format = require('./format')

const { MIB, NBSP } = format
const SCAN_MS = 4000
const COMMAND_MS = 8000
const DOCKER_FORMAT = '{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Ports}}\t{{.Label "com.docker.compose.project"}}'
const OWN_ROWS = new Set(['gradle', 'flutter', 'claude', 'simulator', 'emulator', 'vm', 'dashboard'])
const NAMED_PARTS = new Set(['gradle', 'flutter', 'vm'])
const SHELL = /^(zsh|bash|sh|dash|fish|ksh|tcsh|csh)$/
const APPLE_HOST = /^Core Audio Driver/
const USER_TOOL = /^\/(usr\/)?bin\//
const VAGUE_LABEL_ENDS = new Set(['agent', 'daemon', 'helper', 'service', 'server', 'update', 'updater'])
const CONTAINER_BADGES = {
  restarting: { label: 'Restarting', level: 'warning' },
  paused: { label: 'Paused', level: 'warning' },
  unhealthy: { label: 'Unhealthy', level: 'critical' },
  starting: { label: 'Starting', level: 'warning' },
}

function programName(file) {
  const command = file.split(/\s+-/)[0]
  const name = path.basename(command.startsWith('/') ? command : command.split(/\s+/)[0])
  return name.replace(/^-/, '').replace(/:$/, '') || 'unknown'
}

function folderName(proc, cwd) {
  const folder = cwd.get(proc.pid)
  return folder && folder !== '/' && folder !== os.homedir() ? path.basename(folder) : ''
}

function serviceName(label) {
  const runner = /^actions\.runner\.([^.]+)\./.exec(label)
  if (runner) return `GitHub runner ${runner[1]}`
  const parts = label.split('.')
  const last = parts[parts.length - 1]
  return parts.length > 1 && VAGUE_LABEL_ENDS.has(last.toLowerCase()) ? parts.slice(-2).join('.') : last
}

function isSystemFile(file) {
  return classify.SYSTEM_PREFIXES.some((prefix) => file.startsWith(prefix))
}

function sizeText(bytes) {
  if (!bytes) return ''
  return bytes >= MIB / 2 ? format.memory(bytes) : `<1${NBSP}MB`
}

function cpuText(cpu, cores) {
  const share = cpu / Math.max(1, cores)
  return share >= 1 ? `${format.percent(share)} CPU` : ''
}

function portsText(ports) {
  return ports.map((port) => `:${port}`).join(' ')
}

function listText(items) {
  if (items.length < 2) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function placeProcesses({ processes, facts, context, scan }) {
  const byPid = new Map(processes.map((proc) => [proc.pid, proc]))
  const owned = new Map()
  const ownOf = (proc) => {
    if (!owned.has(proc.pid)) owned.set(proc.pid, classify.own(proc, context))
    return owned.get(proc.pid)
  }
  const dockerRunning = processes.some((proc) => ownOf(proc).group === 'docker')
  const units = new Map()
  const placed = new Map()

  const unit = (key, section, name, note = '') => {
    if (!units.has(key)) units.set(key, { key, section, name, note, procs: [] })
    return units.get(key)
  }
  const macos = () => unit('macos', 'rest', 'macOS')
  const program = (name) => unit(`program:${name}`, 'programs', name)

  const project = (proc, mine) => {
    const folder = classify.projectOf(proc, byPid, context.cwd)
    const entry = unit(`dev:${folder}`, 'programs', folder)
    if (!entry.kind || (mine.strong && !entry.strongKind)) {
      const known = facts.projects.get(folder)
      entry.kind = mine.part
      entry.strongKind = mine.strong
      entry.note = known && known.detached ? `${mine.part}, no window` : mine.part
    }
    return entry
  }

  const decide = (proc, above) => {
    const file = proc.path
    const mine = ownOf(proc)
    const label = scan.services.get(proc.pid)
    const apple = Boolean(label) && label.startsWith('com.apple.')
    if (label && !apple) return unit(`service:${label}`, 'services', serviceName(label), label)
    if (mine.group === 'docker' || (mine.group === 'vm' && dockerRunning)) return unit('docker', 'docker', 'Docker Desktop', 'Virtual machine and helpers')
    const bundle = system.bundleRoot(file)
    if (bundle && scan.foreground.has(bundle)) return unit(`open:${classify.appLabel(file)}`, 'open', classify.appLabel(file))
    if (apple || APPLE_HOST.test(file)) return macos()
    if (above && above.section === 'services') return above
    if (mine.group === 'webkit') return unit('open:webkit', 'open', classify.groupName('webkit'))
    if (OWN_ROWS.has(mine.group)) return unit(mine.group, 'programs', classify.groupName(mine.group))
    const server = scan.ports.has(proc.pid)
    if (mine.group === 'dev' && (mine.strong || server || !above || above.section !== 'programs')) return project(proc, mine)
    if (bundle && !file.includes('/Contents/Developer/')) return isSystemFile(file) ? macos() : unit(`app:${classify.appLabel(file)}`, 'apps', classify.appLabel(file))
    const name = programName(file)
    if (server && (!above || above.section !== 'rest') && (mine.group !== 'macos' || USER_TOOL.test(file))) return program(name)
    if (above && (above.section !== 'rest' || mine.group === 'macos')) return above
    if (SHELL.test(name)) return unit('shells', 'programs', 'Shells')
    return mine.group === 'macos' ? macos() : program(name)
  }

  const place = (proc) => {
    if (placed.has(proc.pid)) return placed.get(proc.pid)
    const parent = proc.ppid > 1 ? byPid.get(proc.ppid) : null
    const result = decide(proc, parent ? place(parent) : null)
    placed.set(proc.pid, result)
    return result
  }

  const names = new Map()
  for (const proc of processes) {
    place(proc).procs.push(proc)
    const mine = ownOf(proc)
    names.set(proc.pid, NAMED_PARTS.has(mine.group) ? mine.part : programName(proc.path))
  }
  if (units.has('claude')) units.get('claude').note = format.plural(facts.sessions, 'session', 'sessions')
  if (units.has('simulator')) units.get('simulator').note = facts.devices ? `${format.plural(facts.devices, 'device', 'devices')} running` : 'No device running'
  return { units: [...units.values()], names }
}

function processRow(unit, scan, cores, names, cwd) {
  let bytes = 0
  let cpu = 0
  let age = 0
  const ports = new Set()
  for (const proc of unit.procs) {
    bytes += proc.mem
    cpu += proc.cpu
    age = Math.max(age, proc.age)
    for (const port of scan.ports.get(proc.pid) || []) ports.add(port)
  }
  const single = unit.procs.length === 1
  const count = single ? `PID ${unit.procs[0].pid}` : format.plural(unit.procs.length, 'process', 'processes')
  const parts = single
    ? []
    : [...unit.procs]
        .sort((a, b) => Math.round((b.mem - a.mem) / MIB) || a.pid - b.pid)
        .map((proc) => ({
          key: String(proc.pid),
          name: names.get(proc.pid),
          note: [folderName(proc, cwd), `PID ${proc.pid}`, portsText(scan.ports.get(proc.pid) || [])].filter(Boolean).join(', '),
          size: sizeText(proc.mem),
        }))
  return {
    key: unit.key,
    name: unit.name,
    note: [unit.note, count].filter(Boolean).join(', '),
    badge: null,
    ports: unit.key === 'docker' ? '' : portsText([...ports].sort((a, b) => a - b)),
    age: format.duration(age),
    cpu: cpuText(cpu, cores),
    size: sizeText(bytes),
    bytes,
    parts,
  }
}

function containerRow(item, measured, cores) {
  return {
    key: `container:${item.name}`,
    name: item.name,
    note: [item.image, item.project && `project ${item.project}`].filter(Boolean).join(', '),
    badge: CONTAINER_BADGES[item.health] || CONTAINER_BADGES[item.state] || null,
    ports: portsText(item.ports),
    age: item.uptime ? format.duration(item.uptime) : '',
    cpu: measured ? cpuText(measured.cpu, cores) : '',
    size: measured ? sizeText(measured.bytes) : '',
    bytes: measured ? measured.bytes : 0,
    parts: [],
  }
}

function sumBytes(rows) {
  return rows.reduce((total, row) => total + row.bytes, 0)
}

function byMemory(rows) {
  return [...rows].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
}

function metaText(rows, one, many) {
  return rows.length ? `${format.plural(rows.length, one, many)}, ${format.memory(sumBytes(rows))}` : ''
}

function publicRows(rows) {
  return rows.map(({ bytes, ...row }) => row)
}

function dockerSection(scan, engine, containers) {
  if (scan.docker.state === 'missing' && !engine && !containers.length) return null
  const stopped = scan.docker.state === 'stopped'
  return {
    key: 'docker',
    title: 'Docker',
    tip: 'Docker Desktop and the containers it is running. A container’s memory is part of Docker’s virtual machine, so it is also inside the Docker Desktop row.',
    meta: metaText(containers, 'container', 'containers'),
    total: sizeText(engine ? engine.bytes : sumBytes(containers)),
    rows: publicRows([...(engine ? [engine] : []), ...containers]),
    empty: stopped
      ? { title: 'Docker isn’t running', text: 'Containers appear here when you start Docker.' }
      : { title: 'No containers running', text: 'Containers appear here when you start them.' },
    failed: scan.docker.state === 'failed' ? { title: 'Couldn’t read Docker’s containers', text: `${scan.docker.error} It tries again in a few seconds.` } : null,
  }
}

function groupOf(section) {
  const badges = section.rows.map((row) => row.badge).filter(Boolean)
  const shown = section.failed ? { label: 'Failed', level: 'critical' } : badges.find((badge) => badge.level === 'critical') || badges[0] || { label: section.total, level: null }
  return { key: section.key, label: section.label || section.title, total: shown.label, level: shown.level }
}

function buildView({ processes, facts, context, cores, scan, error = null }) {
  const { units, names } = placeProcesses({ processes, facts, context, scan })
  const rowsOf = (section) => byMemory(units.filter((unit) => unit.section === section).map((unit) => processRow(unit, scan, cores, names, context.cwd)))
  const stats = new Map(((context.docker && context.docker.containers) || []).map((item) => [item.name, item]))
  const engine = rowsOf('docker')[0] || null
  const containers = byMemory(scan.docker.containers.map((item) => containerRow(item, stats.get(item.name), cores)))
  const programs = rowsOf('programs')
  const services = rowsOf('services')
  const apps = rowsOf('apps')
  const open = rowsOf('open')
  const macos = rowsOf('rest')[0] || null
  const macosCount = macos ? units.find((unit) => unit.key === 'macos').procs.length : 0
  const openProcs = units.filter((unit) => unit.section === 'open').flatMap((unit) => unit.procs)
  const memory = sumBytes([...(engine ? [engine] : []), ...programs, ...services, ...apps])
  const things = containers.length + programs.length + services.length + apps.length
  const counts = [
    [containers.length, 'container', 'containers'],
    [programs.length, 'program', 'programs'],
    [services.length, 'service', 'services'],
    [apps.length, 'app', 'apps'],
  ]
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => format.plural(count, one, many))
  const macosText = `macOS runs ${format.plural(macosCount, 'process', 'processes')} of its own.`
  const everythingElse = []
  if (macos) everythingElse.push({ ...macos, note: `Apple’s own services, ${format.plural(macosCount, 'process', 'processes')}` })
  if (open.length) {
    everythingElse.push({
      key: 'open-apps',
      name: 'Open apps',
      note: `${format.plural(open.length, 'app', 'apps')} with a Dock icon, ${format.plural(openProcs.length, 'process', 'processes')}`,
      badge: null,
      ports: '',
      age: '',
      cpu: cpuText(openProcs.reduce((total, proc) => total + proc.cpu, 0), cores),
      size: sizeText(sumBytes(open)),
      bytes: sumBytes(open),
      parts: open.map((app) => ({ key: app.key, name: app.name, note: [app.note, app.ports].filter(Boolean).join(', '), size: app.size })),
    })
  }
  const sections = [
    dockerSection(scan, engine, containers),
    {
      key: 'programs',
      title: 'Programs',
      tip: 'Servers, build tools and scripts started from a terminal, an editor or another tool. A number like :3000 is a port the program is listening on, and the time is how long it has been running.',
      meta: metaText(programs, 'program', 'programs'),
      total: sizeText(sumBytes(programs)),
      rows: publicRows(programs),
      empty: { title: 'No programs running', text: 'Dev servers, build tools and scripts appear here while they run.' },
      failed: null,
    },
    {
      key: 'services',
      title: 'Services',
      tip: 'Programs macOS starts and keeps running through launchd, because you or an app installed them. Apple’s own services are under Everything else.',
      meta: metaText(services, 'service', 'services'),
      total: sizeText(sumBytes(services)),
      rows: publicRows(services),
      empty: { title: 'No services running', text: 'Services that you or your apps install appear here while they run.' },
      failed: null,
    },
    {
      key: 'apps',
      label: 'Apps',
      title: 'Apps with no Dock icon',
      tip: 'Menu bar apps, and helpers still running from apps you closed.',
      meta: metaText(apps, 'app', 'apps'),
      total: sizeText(sumBytes(apps)),
      rows: publicRows(apps),
      empty: { title: 'No hidden apps running', text: 'Menu bar apps and leftover helpers appear here while they run.' },
      failed: null,
    },
    {
      key: 'rest',
      title: 'Everything else',
      tip: 'macOS’s own services and the apps you have open, with their helpers. They aren’t counted at the top of this page. Open a row to see what is inside it.',
      meta: `${format.plural(processes.length, 'process', 'processes')} in total`,
      total: sizeText(sumBytes(everythingElse)),
      rows: publicRows(everythingElse),
      empty: { title: 'Nothing else running', text: 'macOS services and open apps appear here.' },
      failed: null,
    },
  ].filter(Boolean)
  return {
    ready: true,
    title: things ? `${format.plural(things, 'thing', 'things')} ${things === 1 ? 'is' : 'are'} running in the background` : 'Only macOS is running in the background',
    text: things ? `${listText(counts)}, using ${format.memory(memory)} of memory.` : macosText,
    groups: sections.map(groupOf),
    sections,
    error: [error, ...scan.errors].filter(Boolean).join(' ') || null,
  }
}

function reason(failure) {
  if (failure.killed) return 'It did not answer in time.'
  const lines = String(failure.message || '').trim().split('\n')
  return lines[lines.length - 1]
}

async function readDocker() {
  try {
    const out = await system.run('docker', ['ps', '--format', DOCKER_FORMAT], { timeout: COMMAND_MS })
    return { state: 'ready', containers: system.parseContainers(out), error: null }
  } catch (failure) {
    if (failure.code === 'ENOENT') return { state: 'missing', containers: [], error: null }
    if (/daemon|docker API/i.test(String(failure.message))) return { state: 'stopped', containers: [], error: null }
    return { state: 'failed', containers: [], error: reason(failure) }
  }
}

async function readScan() {
  const errors = []
  const read = (what, run, parse, empty) =>
    run()
      .then(parse)
      .catch((failure) => {
        errors.push(`Couldn’t read ${what}: ${reason(failure)}`)
        return empty
      })
  const listeners = () =>
    system.run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], { timeout: COMMAND_MS }).catch((failure) => {
      if (failure.killed || typeof failure.code !== 'number') throw failure
      return failure.stdout || ''
    })
  const [foreground, userServices, systemServices, ports, docker] = await Promise.all([
    read('the open apps', () => system.run('lsappinfo', ['list'], { timeout: COMMAND_MS }), system.parseForegroundApps, new Set()),
    read('your services', () => system.run('launchctl', ['list'], { timeout: COMMAND_MS }), system.parseServices, new Map()),
    read('the system services', () => system.run('launchctl', ['print', 'system'], { timeout: COMMAND_MS }), system.parseServices, new Map()),
    read('the open ports', listeners, system.parseListeners, new Map()),
    readDocker(),
  ])
  const services = new Map([...systemServices, ...userServices].filter(([, label]) => !label.startsWith('application.')))
  return { foreground, services, ports, docker, errors }
}

function createBackground(sampler) {
  let scan = null
  let scannedAt = 0
  let scanning = false

  function refresh() {
    if (scanning || Date.now() - scannedAt < SCAN_MS) return
    scanning = true
    readScan()
      .then((result) => {
        scan = result
        scannedAt = Date.now()
      })
      .finally(() => {
        scanning = false
      })
  }

  function view() {
    refresh()
    const details = sampler.details()
    const { error } = sampler.snapshot()
    if (!details || !scan) return { ready: false, error }
    return buildView({ ...details, scan, error })
  }

  return { view }
}

module.exports = { createBackground, buildView }
