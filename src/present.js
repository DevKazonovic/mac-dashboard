const format = require('./format')
const checks = require('./checks')

const { MIB } = format
const SHOWN_GROUPS = 9
const MIN_GROUP_BYTES = 100 * MIB
const PART_LIMIT = 8
const IDLE_NOTE_SECONDS = 60

function sum(values) {
  return values.reduce((total, value) => total + value, 0)
}

function memoryTile(memory) {
  const { pages, total, swap } = memory
  const wired = pages['Pages wired down'] || 0
  const compressed = pages['Pages occupied by compressor'] || 0
  const reclaimable =
    (pages['File-backed pages'] || 0) + (pages['Pages purgeable'] || 0) + (pages['Pages free'] || 0) + (pages['Pages speculative'] || 0)
  const available = Math.max(0, Math.min(reclaimable, total - wired - compressed))
  const apps = Math.max(0, total - wired - compressed - available)
  const parts = [
    { key: 'apps', name: 'Apps', bytes: apps },
    { key: 'system', name: 'macOS', bytes: wired },
    { key: 'compressed', name: 'Compressed', bytes: compressed },
    { key: 'available', name: 'Available', bytes: available },
  ].map((part) => ({ key: part.key, name: part.name, size: format.memory(part.bytes), share: total ? part.bytes / total : 0 }))
  return {
    pressure: checks.pressureOf(memory.pressureLevel),
    total: format.memory(total),
    parts,
    label: `${format.memory(total)} of RAM: ${parts.map((part) => `${part.name} ${part.size}`).join(', ')}`,
    swap: format.memory(swap.used),
  }
}

function cpuTile(cpuBusy, groups, cores) {
  const busy = cpuBusy === null ? 0 : cpuBusy
  const level = busy >= 90 ? 'critical' : busy >= 70 ? 'warning' : 'normal'
  const busiest = groups.filter((group) => group.key !== 'macos').sort((a, b) => b.cpu - a.cpu)[0]
  const share = busiest ? busiest.cpu / Math.max(1, cores) : 0
  const note = busiest && share >= 1 ? `Busiest: ${busiest.name}, ${format.percent(share)}` : `${format.plural(cores, 'core', 'cores')}, mostly idle`
  return { value: format.percent(busy), share: busy / 100, level, note }
}

function diskTile(disk) {
  if (!disk) return null
  const used = disk.size - disk.free
  return {
    value: `${format.disk(disk.free)} free`,
    share: used / disk.size,
    level: checks.diskLevel(disk),
    note: `${format.disk(used)} of ${format.disk(disk.size)} used`,
  }
}

function partsOf(group, notes = {}, limit = PART_LIMIT) {
  const parts = [...group.parts.values()].filter((part) => part.bytes > 0).sort((a, b) => b.bytes - a.bytes)
  const shown = parts.slice(0, limit).map((part) => ({ key: part.key, name: part.name, note: notes[part.key] || '', size: format.memory(part.bytes) }))
  const rest = parts.slice(limit)
  if (rest.length) {
    shown.push({ key: 'rest', name: 'Everything else', note: format.plural(sum(rest.map((part) => part.count)), 'process', 'processes'), size: format.memory(sum(rest.map((part) => part.bytes))) })
  }
  return shown
}

function dockerView(facts, context) {
  const containers = [...facts.containers].sort((a, b) => b.bytes - a.bytes)
  const limit = context.dockerLimit
  const note = containers.length
    ? `${format.plural(containers.length, 'container', 'containers')}${limit ? `, up to ${format.memory(limit)}` : ''}`
    : 'Running, no container data yet'
  const parts = containers.map((item) => ({ key: `container-${item.name}`, name: item.name, note: 'Container', size: format.memory(item.bytes) }))
  const kept = facts.vmBytes - facts.containersBytes
  if (facts.docker && kept > 0) parts.push({ key: 'kept', name: 'Held by Docker, not used by containers', note: '', size: format.memory(kept) })
  if (facts.dockerAppBytes > 0) parts.push({ key: 'app', name: 'Docker Desktop app', note: '', size: format.memory(facts.dockerAppBytes) })
  return { note, parts }
}

function gradleView(facts, trackers, now) {
  const parts = [...facts.gradle]
    .sort((a, b) => b.bytes - a.bytes)
    .map((item) => {
      const since = trackers.idle.get(item.pid)
      const idleFor = since ? (now - since) / 1000 : 0
      return { key: `gradle-${item.pid}`, name: item.label, note: idleFor >= IDLE_NOTE_SECONDS ? `Idle for ${format.duration(idleFor)}` : 'Working', size: format.memory(item.bytes) }
    })
  return { note: format.plural(facts.gradle.length, 'background process', 'background processes'), parts }
}

function devView(facts) {
  const projects = [...facts.projects.values()].sort((a, b) => b.bytes - a.bytes)
  const parts = projects.map((project) => ({
    key: `project-${project.name}`,
    name: project.name,
    note: project.detached ? `${project.kind}, no window` : project.kind,
    size: format.memory(project.bytes),
  }))
  return { note: format.plural(projects.length, 'project', 'projects'), parts }
}

function describe(group, facts, context, trackers, now) {
  if (group.key.startsWith('browser:')) {
    const pages = format.plural(facts.pages[group.key] || 0, 'page', 'pages')
    const profiles = group.key === 'browser:Chrome' && context.chromeProfiles > 1 ? `, ${format.count(context.chromeProfiles)} profiles` : ''
    return { note: `${pages}${profiles}`, parts: partsOf(group, { Pages: pages }) }
  }
  if (group.key.startsWith('editor:')) {
    const windows = format.plural(facts.windows[group.key] || 0, 'window', 'windows')
    return { note: windows, parts: partsOf(group, { Windows: windows }) }
  }
  switch (group.key) {
    case 'claude':
      return { note: format.plural(facts.sessions, 'session', 'sessions'), parts: partsOf(group, { Sessions: format.plural(facts.sessions, 'session', 'sessions') }) }
    case 'docker':
      return dockerView(facts, context)
    case 'gradle':
      return gradleView(facts, trackers, now)
    case 'dev':
      return devView(facts)
    case 'flutter': {
      const parts = partsOf(group)
      return { note: parts.slice(0, 2).map((part) => part.name).join(', '), parts }
    }
    case 'macos':
      return { note: 'System services', parts: partsOf(group, {}, 6) }
    case 'simulator':
      return {
        note: facts.devices ? `${format.plural(facts.devices, 'device', 'devices')} running` : 'No device running',
        parts: partsOf(group, { Devices: format.plural(facts.devices, 'device', 'devices') }),
      }
    default:
      return {
        note: group.count > 1 ? format.plural(group.count, 'process', 'processes') : '',
        parts: group.parts.size > 1 ? partsOf(group, {}, 6) : [],
      }
  }
}

function usage(result, context, trackers, now) {
  const sorted = [...result.groups].sort((a, b) => b.bytes - a.bytes)
  const shown = sorted.filter((group) => group.key !== 'other' && group.bytes >= MIN_GROUP_BYTES).slice(0, SHOWN_GROUPS)
  const shownKeys = new Set(shown.map((group) => group.key))
  const rest = sorted.filter((group) => !shownKeys.has(group.key) && group.bytes > 0)
  const rows = shown.map((group) => ({ key: group.key, name: group.name, size: format.memory(group.bytes), bytes: group.bytes, ...describe(group, result.facts, context, trackers, now) }))
  if (rest.length) {
    rows.push({
      key: 'rest',
      name: 'Everything else',
      size: format.memory(sum(rest.map((group) => group.bytes))),
      bytes: sum(rest.map((group) => group.bytes)),
      note: format.plural(sum(rest.map((group) => group.count)), 'process', 'processes'),
      parts: rest.slice(0, 6).map((group) => ({ key: group.key, name: group.name, note: '', size: format.memory(group.bytes) })),
    })
  }
  const max = Math.max(1, ...rows.map((row) => row.bytes))
  return rows.map(({ bytes, ...row }) => ({ ...row, share: bytes / max }))
}

function snapshot({ now, sample, result, context, trackers, history, memory, disk }) {
  const pressure = checks.pressureOf(memory.pressureLevel)
  const growth = checks.growthOf(history, result.groups, now, memory.total)
  return {
    ready: true,
    updatedAt: now,
    verdict: checks.verdict({ pressure, demand: memory.demand, total: memory.total, swapUsed: memory.swap.used, disk }),
    memory: memoryTile(memory),
    cpu: cpuTile(sample.cpuBusy, result.groups, memory.cores),
    disk: diskTile(disk),
    problems: checks.problems({ facts: result.facts, groups: result.groups, pressure, disk, trackers, growth, now, total: memory.total }),
    usage: { meta: `Apps want ${format.memory(memory.demand)}`, total: format.memory(memory.demand), groups: usage(result, context, trackers, now) },
  }
}

function groups({ problems, usage: memoryUsage, storage }) {
  const failed = storage.status === 'failed'
  return [
    {
      key: 'problems',
      label: 'Needs attention',
      total: problems.length ? String(problems.length) : '',
      level: problems.some((problem) => problem.level === 'critical') ? 'critical' : problems.length ? 'warning' : null,
    },
    { key: 'usage', label: 'Using memory', total: memoryUsage.total, level: null },
    { key: 'storage', label: 'Space you can free', total: failed ? 'Failed' : storage.total, level: failed ? 'critical' : null },
  ]
}

module.exports = { snapshot, groups }
