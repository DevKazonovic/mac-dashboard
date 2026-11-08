const format = require('./format')
const present = require('./present')
const background = require('./background')

const { GIB, MIB } = format
const MINUTE = 60 * 1000
const HOUR_SECONDS = 3600
const MACOS_PROGRAMS = ['distnoted', 'cfprefsd', 'trustd', 'mds_stores', 'coreaudiod', 'syspolicyd', 'launchservicesd', 'WindowServer', 'mediaremoted', 'sharingd', 'bluetoothd', 'logd', 'notifyd', 'securityd', 'tccd']
const OPEN_BUNDLES = {
  Chrome: '/Applications/Google Chrome.app',
  'VS Code': '/Applications/Visual Studio Code.app',
  Slack: '/Applications/Slack.app',
  Terminal: '/System/Applications/Utilities/Terminal.app',
  Finder: '/System/Library/CoreServices/Finder.app',
}

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
        total: format.disk(total),
        error: null,
        items: items.map((item) => ({ key: item.key, name: item.name, size: format.disk(item.bytes), how: item.how, command: item.command })),
      }
    },
  }
}

function demoProcesses() {
  const processes = []
  const add = (pid, ppid, file, options = {}) => {
    processes.push({ pid, ppid, path: file, args: options.args || '', age: options.age || 5 * HOUR_SECONDS, mem: options.mem || 0, cpu: options.cpu || 0 })
    return pid
  }
  add(0, 0, 'kernel_task', { mem: 2.1 * GIB, cpu: 30 })
  add(1, 0, '/sbin/launchd', { mem: 28 * MIB })
  MACOS_PROGRAMS.forEach((name, index) => {
    for (let copy = 0; copy < 20; copy++) add(1000 + index * 100 + copy, 1, `/usr/libexec/${name}`, { mem: (6 + ((index * 7 + copy * 3) % 40)) * MIB, age: 40 * HOUR_SECONDS })
  })

  add(3000, 1, `${OPEN_BUNDLES.Chrome}/Contents/MacOS/Google Chrome`, { mem: 540 * MIB, cpu: 14 })
  for (let tab = 0; tab < 24; tab++) add(3001 + tab, 3000, `${OPEN_BUNDLES.Chrome}/Contents/Frameworks/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)`, { args: '--type=renderer', mem: (120 + tab * 9) * MIB, cpu: 2 })
  add(3100, 1, `${OPEN_BUNDLES['VS Code']}/Contents/MacOS/Electron`, { mem: 410 * MIB, cpu: 4 })
  for (let helper = 0; helper < 8; helper++) add(3101 + helper, 3100, `${OPEN_BUNDLES['VS Code']}/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)`, { mem: 210 * MIB, cpu: 3 })
  add(3200, 1, `${OPEN_BUNDLES.Slack}/Contents/MacOS/Slack`, { mem: 1.1 * GIB, cpu: 8 })
  add(3300, 1, `${OPEN_BUNDLES.Terminal}/Contents/MacOS/Terminal`, { mem: 58 * MIB })
  add(3301, 3300, '/usr/bin/login', { mem: 2 * MIB })
  add(3302, 3301, '/bin/zsh', { mem: 6 * MIB })
  add(3400, 1, `${OPEN_BUNDLES.Finder}/Contents/MacOS/Finder`, { mem: 92 * MIB })

  add(4000, 1, '/Applications/Docker.app/Contents/MacOS/com.docker.backend', { mem: 330 * MIB, cpu: 4 })
  add(4001, 4000, '/Applications/Docker.app/Contents/MacOS/com.docker.build', { mem: 42 * MIB })
  add(4002, 1, '/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine', { mem: 3.3 * GIB, cpu: 60 })

  add(4100, 1, '/bin/bash', { mem: 2 * MIB, age: 3 * HOUR_SECONDS + 12 * 60 })
  add(4101, 4100, '/Users/demo/.sdkman/candidates/java/21/bin/java', { args: 'java -cp app.jar com.storefront.Application --spring.profiles.active=local', mem: 1.2 * GIB, cpu: 90, age: 3 * HOUR_SECONDS + 12 * 60 })
  add(4200, 3302, '/opt/homebrew/bin/node', { args: 'node /Users/demo/Projects/storefront-web/node_modules/.bin/vite', mem: 310 * MIB, cpu: 6, age: 2 * HOUR_SECONDS })
  add(4201, 4200, '/Users/demo/Projects/storefront-web/node_modules/@esbuild/darwin-arm64/bin/esbuild', { mem: 42 * MIB, age: 2 * HOUR_SECONDS })
  add(4300, 3302, '/opt/homebrew/bin/python3.13', { args: 'python3 worker.py', mem: 640 * MIB, cpu: 40, age: 26 * 60 })
  add(4400, 1, '/Users/demo/.sdkman/candidates/java/21/bin/java', { args: 'java org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.13', mem: 1.4 * GIB, age: 47 * 60 })
  add(4401, 1, '/Users/demo/.sdkman/candidates/java/21/bin/java', { args: 'java org.jetbrains.kotlin.daemon.KotlinCompileDaemon', mem: 980 * MIB, age: 47 * 60 })
  for (let session = 0; session < 5; session++) {
    add(4500 + session * 10, 3101, '/Users/demo/.local/bin/claude', { mem: (180 + session * 40) * MIB, cpu: session === 0 ? 12 : 1, age: (session + 1) * HOUR_SECONDS })
    add(4501 + session * 10, 4500 + session * 10, '/bin/zsh', { mem: 5 * MIB, age: 600 })
  }
  add(4600, 1, '/Users/demo/Library/Android/sdk/platform-tools/adb', { mem: 11 * MIB, age: 30 * HOUR_SECONDS })
  add(4700, 1, 'zsh', { mem: 3 * MIB, age: 9 * HOUR_SECONDS })
  add(4701, 1, 'zsh', { mem: 3 * MIB, age: 9 * HOUR_SECONDS })
  add(4702, 4700, '/Users/demo/.cache/gitstatus/gitstatusd-darwin-arm64', { mem: 2 * MIB, age: 9 * HOUR_SECONDS })
  add(4800, 1, '/Users/demo/Projects/a-very-long-folder-name-for-a-background-worker-that-never-breaks/bin/worker', { mem: 400 * 1024, age: 40 })

  add(5000, 1, '/bin/bash', { mem: 3 * MIB, age: 40 * HOUR_SECONDS })
  add(5001, 5000, './externals/node24/bin/node', { mem: 96 * MIB, age: 40 * HOUR_SECONDS })
  add(5002, 5001, '/Users/demo/actions-runners/storefront/bin/Runner.Listener', { mem: 180 * MIB, age: 40 * HOUR_SECONDS })
  add(5100, 1, '/opt/homebrew/opt/redis/bin/redis-server', { mem: 18 * MIB, age: 72 * HOUR_SECONDS })
  add(5200, 1, '/opt/homebrew/bin/node', { mem: 62 * MIB, cpu: 2, age: 72 * HOUR_SECONDS })
  add(5201, 5200, 'top', { mem: 4 * MIB, age: 72 * HOUR_SECONDS })
  add(5300, 1, '/Library/PrivilegedHelperTools/com.docker.vmnetd', { mem: 8 * MIB, age: 72 * HOUR_SECONDS })
  add(5400, 1, '/Library/Google/GoogleSoftwareUpdate/GoogleSoftwareUpdate.bundle/Contents/MacOS/GoogleSoftwareUpdateDaemon', { mem: 14 * MIB, age: 6 * HOUR_SECONDS })

  add(6000, 1, '/Applications/Rectangle.app/Contents/MacOS/Rectangle', { mem: 74 * MIB, age: 72 * HOUR_SECONDS })
  add(6100, 1, '/Applications/Raycast.app/Contents/MacOS/Raycast', { mem: 310 * MIB, cpu: 3, age: 72 * HOUR_SECONDS })
  add(6101, 6100, '/Applications/Raycast.app/Contents/MacOS/Raycast Helper', { mem: 40 * MIB, age: 72 * HOUR_SECONDS })
  add(6200, 1, '/Users/demo/Applications/Old Editor.app/Contents/Frameworks/Electron Framework.framework/Helpers/chrome_crashpad_handler', { mem: 3 * MIB, age: 90 * HOUR_SECONDS })
  return processes
}

function demoScan() {
  return {
    foreground: new Set(Object.values(OPEN_BUNDLES)),
    services: new Map([
      [5000, 'actions.runner.storefront-app.demo-mini-storefront'],
      [5100, 'homebrew.mxcl.redis'],
      [5200, 'io.github.devkazonovic.mac-dashboard'],
      [5300, 'com.docker.vmnetd'],
      [5400, 'com.google.keystone.daemon'],
      ...MACOS_PROGRAMS.map((name, index) => [1000 + index * 100, `com.apple.${name}`]),
    ]),
    ports: new Map([
      [4101, [8080]],
      [4200, [5173, 24678]],
      [4600, [5037]],
      [5100, [6379]],
      [5200, [3738]],
    ]),
    docker: {
      state: 'ready',
      error: null,
      containers: [
        { name: 'api', image: 'storefront-api', project: 'storefront', state: 'running', health: '', uptime: 3 * HOUR_SECONDS, ports: ['8081'] },
        { name: 'postgres', image: 'postgres:17', project: 'storefront', state: 'running', health: 'unhealthy', uptime: 3 * HOUR_SECONDS, ports: ['5432'] },
        { name: 'web', image: 'storefront-web', project: 'storefront', state: 'restarting', health: '', uptime: 0, ports: [] },
        { name: 'redis', image: 'redis:8', project: '', state: 'paused', health: '', uptime: 600, ports: [] },
        { name: 'mailpit', image: 'axllent/mailpit', project: 'storefront', state: 'running', health: 'starting', uptime: 20, ports: ['1025', '8025'] },
      ],
    },
    errors: [],
  }
}

function createDemoBackground() {
  const details = {
    processes: demoProcesses(),
    facts: { projects: new Map([['storefront-api', { detached: true }]]), sessions: 5, devices: 0 },
    context: {
      selfPid: -1,
      cwd: new Map([
        [4101, '/Users/demo/Projects/storefront-api'],
        [4200, '/Users/demo/Projects/storefront-web'],
        [4300, '/Users/demo/Projects/ml-worker'],
        [4500, '/Users/demo/Projects/storefront-api'],
        [4510, '/Users/demo/Projects/storefront-web'],
        [4520, '/Users/demo/Projects/storefront-web'],
        [4530, '/Users/demo/Projects/ml-worker'],
        [4540, '/Users/demo/Projects/mobile-app'],
      ]),
      docker: {
        containers: [
          { name: 'api', bytes: 980 * MIB, cpu: 24 },
          { name: 'postgres', bytes: 612 * MIB, cpu: 8 },
          { name: 'web', bytes: 540 * MIB, cpu: 0 },
          { name: 'redis', bytes: 64 * MIB, cpu: 0 },
        ],
      },
    },
    cores: 10,
  }
  return {
    view() {
      return background.buildView({ ...details, scan: demoScan() })
    },
  }
}

module.exports = { createDemoSampler, createDemoStorage, createDemoBackground }
