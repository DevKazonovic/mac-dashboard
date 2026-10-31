const format = require('./format')
const present = require('./present')

const { GIB, MIB } = format
const MINUTE = 60 * 1000

function group(key, name, parts, cpu = 0) {
  const map = new Map(parts.map(([part, bytes, count = 1]) => [part, { key: part, name: part, bytes, count }]))
  const values = [...map.values()]
  return {
    key,
    name,
    bytes: values.reduce((total, part) => total + part.bytes, 0),
    cpu,
    count: values.reduce((total, part) => total + part.count, 0),
    parts: map,
  }
}

function build(now) {
  const containers = [
    { name: 'api', bytes: 980 * MIB },
    { name: 'postgres', bytes: 612 * MIB },
    { name: 'web', bytes: 540 * MIB },
    { name: 'redis', bytes: 64 * MIB },
  ]
  const gradle = [
    { pid: 41120, label: 'Gradle 8.13', bytes: 1.4 * GIB, cpu: 0 },
    { pid: 41188, label: 'Kotlin compiler', bytes: 980 * MIB, cpu: 0 },
    { pid: 40977, label: 'Gradle 8.12', bytes: 560 * MIB, cpu: 0 },
  ]
  const projects = new Map([
    ['storefront-api', { name: 'storefront-api', kind: 'Spring app', strong: true, bytes: 1.2 * GIB, age: 3 * 3600 + 12 * 60, detached: true, pid: 48213 }],
    ['storefront-web', { name: 'storefront-web', kind: 'Vite dev server', strong: true, bytes: 410 * MIB, age: 2 * 3600, detached: false, pid: 48590 }],
  ])
  const groups = [
    group('browser:Chrome', 'Chrome', [['Pages', 6.3 * GIB, 48], ['Chrome itself', 540 * MIB, 3], ['Graphics', 380 * MIB], ['Extensions', 210 * MIB, 4]], 48),
    group('editor:VS Code', 'VS Code', [['Windows', 1.6 * GIB, 3], ['Extensions', 1.5 * GIB, 9], ['VS Code itself', 820 * MIB, 8]], 9),
    group('docker', 'Docker', [['Virtual machine', 3.3 * GIB], ['Docker Desktop app', 330 * MIB, 6]], 6),
    group('gradle', 'Gradle', gradle.map((item) => [item.label, item.bytes])),
    group('dev', 'Dev servers', [['Spring app', 1.2 * GIB, 2], ['Vite dev server', 410 * MIB, 3]], 2),
    group('simulator', 'iOS Simulator', [['Devices', 1.5 * GIB, 180], ['Simulator services', 260 * MIB, 9], ['Simulator app', 48 * MIB]], 3),
    group('claude', 'Claude Code', [['Sessions', 1.1 * GIB, 5], ['Tools it runs', 96 * MIB, 7]], 1),
    group('app:Slack', 'Slack', [['Slack', 1.1 * GIB, 6]], 2),
    group('macos', 'macOS', [
      ['WindowServer', 520 * MIB],
      ['mds_stores', 210 * MIB],
      ['Spotlight', 140 * MIB],
      ['syspolicyd', 96 * MIB],
      ['coreaudiod', 48 * MIB],
      ['launchservicesd', 44 * MIB],
      ['trustd', 38 * MIB],
      ['other services', 1.5 * GIB, 290],
    ], 6),
    group('app:Finder', 'Finder', [['Finder', 92 * MIB]]),
    group('app:Music', 'Music', [['Music', 88 * MIB, 2]]),
    group('app:Notes', 'Notes', [['Notes', 71 * MIB]]),
    group('app:Mail', 'Mail', [['Mail', 64 * MIB, 3]]),
    group('app:Terminal', 'Terminal', [['Terminal', 58 * MIB, 4]]),
  ]
  const result = {
    groups,
    facts: {
      gradle,
      pages: { 'browser:Chrome': 48 },
      heavyPages: { 'browser:Chrome': 6 },
      windows: { 'editor:VS Code': 3 },
      sessions: 5,
      devices: 1,
      vmBytes: 3.3 * GIB,
      dockerAppBytes: 330 * MIB,
      docker: true,
      containers,
      containersBytes: containers.reduce((total, item) => total + item.bytes, 0),
      projects,
      procs: new Map(),
    },
  }
  const trackers = {
    idle: new Map([
      [41120, now - 42 * MINUTE],
      [41188, now - 42 * MINUTE],
      [40977, now - 47 * MINUTE],
    ]),
    hot: new Map(),
  }
  return present.snapshot({
    now,
    sample: { cpuBusy: 23 },
    result,
    context: { chromeProfiles: 2, dockerLimit: 6 * GIB },
    trackers,
    history: [],
    memory: {
      swap: { used: 6.2 * GIB },
      pressureLevel: 2,
      total: 16 * GIB,
      cores: 10,
      pages: {
        'Pages wired down': 2.6 * GIB,
        'Pages occupied by compressor': 4.1 * GIB,
        'File-backed pages': 1.1 * GIB,
        'Pages free': 0.3 * GIB,
      },
      demand: groups.reduce((total, item) => total + item.bytes, 0),
    },
    disk: { size: 494.38e9, free: 212.4e9 },
  })
}

function createDemoSampler() {
  return {
    start() {},
    stop() {},
    snapshot(storage) {
      return { ...build(Date.now()), storage, error: null }
    },
  }
}

function createDemoStorage() {
  const items = [
    { key: 'docker-build', name: 'Docker build cache', bytes: 14.2e9, how: 'docker builder prune -af', command: true },
    { key: 'xcode', name: 'Xcode build data', bytes: 9.6e9, how: 'Delete ~/Library/Developer/Xcode/DerivedData', command: false },
    { key: 'gradle', name: 'Gradle downloads', bytes: 8.1e9, how: 'Delete ~/.gradle/caches. Builds download what they need again.', command: false },
    { key: 'npm', name: 'npm cache', bytes: 3.4e9, how: 'npm cache clean --force', command: true },
    { key: 'chrome', name: 'Chrome cache', bytes: 2.7e9, how: 'Chrome settings, then Delete browsing data, then Cached images and files', command: false },
    { key: 'simulator-caches', name: 'iOS Simulator caches', bytes: 2.2e9, how: 'xcrun simctl runtime dyld_shared_cache remove --all', command: true },
  ]
  const total = items.reduce((sum, item) => sum + item.bytes, 0)
  const measuredAt = Date.now() - 12 * MINUTE
  return {
    start() {},
    stop() {},
    measure() {},
    view() {
      return {
        status: 'ready',
        meta: `${format.disk(total)} in total, measured ${format.ago(measuredAt)}`,
        error: null,
        items: items.map((item) => ({ key: item.key, name: item.name, size: format.disk(item.bytes), how: item.how, command: item.command })),
      }
    },
  }
}

module.exports = { createDemoSampler, createDemoStorage }
