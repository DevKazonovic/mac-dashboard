const fs = require('fs')
const os = require('os')
const path = require('path')

const HOME = os.homedir()
const PROJECT_MARKERS = ['package.json', 'pyproject.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'pubspec.yaml']
const SCRIPT = /(\/[^\s]+\.(?:m?js|cjs|ts|py|jar|php|rb))(?:\s|$)/
const scriptProjects = new Map()
const HEAVY_PAGE_BYTES = 300 * 1024 ** 2
const SYSTEM_PREFIXES = ['/System/', '/usr/libexec/', '/usr/sbin/', '/sbin/', '/usr/bin/', '/bin/', '/Library/Apple/']
const DART = new Set(['dart', 'dartvm', 'dartaotruntime'])
const RUNTIMES = new Set(['java', 'node', 'bun', 'deno', 'php', 'ruby'])
const PYTHON = /^python3?(\.\d+)?$/i
const KEEPERS = new Set(['tmux', 'screen', 'sshd', 'mosh-server', 'zellij'])
const BROWSERS = {
  'Google Chrome': 'Chrome',
  'Google Chrome Beta': 'Chrome Beta',
  'Google Chrome Canary': 'Chrome Canary',
  'Brave Browser': 'Brave',
  'Microsoft Edge': 'Edge',
  Arc: 'Arc',
  Chromium: 'Chromium',
  Vivaldi: 'Vivaldi',
  Opera: 'Opera',
}
const EDITORS = {
  'Visual Studio Code': 'VS Code',
  'Visual Studio Code - Insiders': 'VS Code Insiders',
  Cursor: 'Cursor',
  Windsurf: 'Windsurf',
  VSCodium: 'VSCodium',
}
const NAMES = {
  docker: 'Docker',
  claude: 'Claude Code',
  gradle: 'Gradle',
  flutter: 'Flutter',
  dev: 'Dev servers',
  macos: 'macOS',
  webkit: 'Safari and web views',
  emulator: 'Android emulator',
  simulator: 'iOS Simulator',
  vm: 'Virtual machine',
  dashboard: 'This dashboard',
  other: 'Other processes',
}

function appName(file) {
  const match = /\/([^/]+)\.app\//.exec(file)
  return match ? match[1] : null
}

function appLabel(file) {
  const app = appName(file)
  return BROWSERS[app] || EDITORS[app] || app
}

function groupName(key) {
  const [kind, ...rest] = key.split(':')
  if (rest.length && ['app', 'browser', 'editor'].includes(kind)) return rest.join(':')
  return NAMES[key] || key
}

function needsCwd(proc) {
  const base = path.basename(proc.path)
  return RUNTIMES.has(base) || PYTHON.test(base) || base === 'claude' || (proc.args || '').includes('flutter_tools.snapshot run')
}

function gradleLabel(args) {
  const match = /GradleDaemon\s+([\w.-]+)/.exec(args)
  return match ? `Gradle ${match[1]}` : 'Gradle'
}

function flutterPart(args, base) {
  if (/language-server|analysis_server/.test(args)) return 'Dart analysis'
  if (/custom_lint/.test(args)) return 'custom_lint'
  if (/flutter_tools\.snapshot\s+run/.test(args)) return 'flutter run'
  if (/flutter_tools\.snapshot\s+daemon/.test(args)) return 'Flutter daemon'
  if (/flutter_tools\.snapshot/.test(args)) return 'Flutter tool'
  if (/frontend_server/.test(args)) return 'Hot reload compiler'
  if (/devtools/.test(args)) return 'DevTools'
  if (/tooling-daemon|tooling_daemon|\bdtd\b/.test(args)) return 'Dart tooling'
  return base === 'dart' ? 'Dart' : 'Dart VM'
}

function browserPart(args, name) {
  if (args.includes('--extension-process')) return 'Extensions'
  if (args.includes('--type=renderer')) return 'Pages'
  if (args.includes('--type=gpu-process')) return 'Graphics'
  return `${name} itself`
}

function editorPart(file, name) {
  if (file.endsWith('Helper (Renderer)')) return 'Windows'
  if (file.endsWith('Helper (Plugin)')) return 'Extensions'
  return `${name} itself`
}

function devKind(base, args) {
  if (base === 'java') {
    if (/\.vscode\/extensions\//.test(args)) return null
    if (/MavenWrapperMain|plexus\.classworlds/.test(args)) return { kind: 'Maven', strong: true }
    if (/spring|Application(\s|$)/.test(args)) return { kind: 'Spring app', strong: true }
    return { kind: 'Java app', strong: false }
  }
  if (base === 'node' || base === 'bun' || base === 'deno') {
    if (/\.vscode\/extensions\//.test(args)) return null
    if (/nuxi|nuxt/.test(args)) return { kind: 'Nuxt dev server', strong: true }
    if (/\bvite\b/.test(args)) return { kind: 'Vite dev server', strong: true }
    if (/next(\/dist\/bin)?\/next\s+dev|next-server/.test(args)) return { kind: 'Next.js dev server', strong: true }
    if (/webpack/.test(args)) return { kind: 'Webpack', strong: true }
    return { kind: 'Node app', strong: false }
  }
  if (PYTHON.test(base)) {
    if (/manage\.py\s+runserver|uvicorn|gunicorn|flask|fastapi/.test(args)) return { kind: 'Python server', strong: true }
    return { kind: 'Python script', strong: false }
  }
  if (base === 'php') return /artisan\s+serve/.test(args) ? { kind: 'Laravel server', strong: true } : { kind: 'PHP', strong: false }
  if (base === 'ruby') return /rails\s+s(erver)?\b|puma/.test(args) ? { kind: 'Rails server', strong: true } : { kind: 'Ruby', strong: false }
  return null
}

function own(proc, context) {
  const file = proc.path
  const base = path.basename(file)
  const args = proc.args || ''
  if (proc.pid === context.selfPid) return { group: 'dashboard', part: 'Server', strong: true }
  if (args.includes('GradleDaemon')) return { group: 'gradle', part: gradleLabel(args), strong: true, gradle: true }
  if (args.includes('KotlinCompileDaemon')) return { group: 'gradle', part: 'Kotlin compiler', strong: true, gradle: true }
  if (/GradleWrapperMain|org\.gradle\.launcher\.GradleMain/.test(args)) return { group: 'gradle', part: 'Gradle build', strong: true }
  if (DART.has(base) || args.includes('flutter_tools.snapshot')) return { group: 'flutter', part: flutterPart(args, base), strong: true }
  if (base === 'claude' && !file.includes('.app/')) return { group: 'claude', part: 'Sessions', strong: true, session: true }
  if (base === 'launchd_sim') return { group: 'simulator', part: 'Devices', strong: true, device: true }
  if (file.includes('/CoreSimulator/Volumes/') || file.includes('RuntimeRoot')) return { group: 'simulator', part: 'Devices', strong: true }
  if (file.includes('/Simulator.app/')) return { group: 'simulator', part: 'Simulator app', strong: true }
  if (file.includes('CoreSimulator')) return { group: 'simulator', part: 'Simulator services', strong: true }
  if (base.startsWith('qemu-system')) return { group: 'emulator', part: 'Emulator', strong: true }
  if (base === 'com.apple.Virtualization.VirtualMachine') return { group: 'vm', part: 'Virtual machine', strong: true, vm: true }
  if (file.includes('/Docker.app/') || base.startsWith('com.docker.')) return { group: 'docker', part: 'Docker Desktop app', strong: true }
  if (file.includes('com.apple.WebKit.WebContent')) return { group: 'webkit', part: 'Pages', strong: true }
  const app = appName(file)
  if (app && BROWSERS[app]) {
    const name = BROWSERS[app]
    const part = browserPart(args, name)
    return { group: `browser:${name}`, part, strong: true, page: part === 'Pages' }
  }
  if (app && EDITORS[app]) {
    const name = EDITORS[app]
    const window = file.endsWith('Helper (Plugin)') && args.includes('node.mojom.NodeService')
    return { group: `editor:${name}`, part: editorPart(file, name), strong: true, window }
  }
  const dev = devKind(base, args)
  if (dev) return { group: 'dev', part: dev.kind, strong: dev.strong }
  if (app) return { group: `app:${app}`, part: app, strong: true }
  if (proc.pid <= 1 || base === 'kernel_task' || SYSTEM_PREFIXES.some((prefix) => file.startsWith(prefix))) {
    return { group: 'macos', part: base || 'kernel', strong: false }
  }
  return { group: 'other', part: base || 'unknown', strong: false }
}

function resolve(proc, byPid, ownOf) {
  const mine = ownOf(proc)
  if (mine.strong) return mine
  let parent = byPid.get(proc.ppid)
  for (let hops = 0; parent && parent.pid > 1 && hops < 40; hops++) {
    const theirs = ownOf(parent)
    if (theirs.strong && theirs.group !== 'macos') {
      return { group: theirs.group, part: theirs.group === 'claude' ? 'Tools it runs' : theirs.part, strong: true, inherited: true }
    }
    parent = byPid.get(parent.ppid)
  }
  return mine
}

function findProject(file) {
  const modules = file.indexOf('/node_modules/')
  if (modules >= 0) {
    const prefix = file.slice(0, modules)
    if (fs.existsSync(path.join(prefix, 'package.json'))) return path.basename(prefix)
    const rest = file.slice(modules + '/node_modules/'.length).split('/')
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
  }
  let dir = path.dirname(file)
  for (let hops = 0; hops < 6 && dir !== path.dirname(dir) && dir !== HOME; hops++) {
    if (PROJECT_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)))) return path.basename(dir)
    dir = path.dirname(dir)
  }
  return null
}

function scriptProject(args) {
  const match = SCRIPT.exec(args || '')
  if (!match) return null
  const file = match[1]
  if (!scriptProjects.has(file)) {
    if (scriptProjects.size > 500) scriptProjects.clear()
    scriptProjects.set(file, findProject(file))
  }
  return scriptProjects.get(file)
}

function projectOf(proc, byPid, cwd) {
  let current = proc
  for (let hops = 0; current && hops < 20; hops++) {
    const dir = cwd.get(current.pid)
    if (dir && dir !== '/' && dir !== HOME) return path.basename(dir)
    const fromScript = scriptProject(current.args)
    if (fromScript) return fromScript
    current = byPid.get(current.ppid)
  }
  return 'Unknown folder'
}

function rootOf(proc, byPid) {
  let current = proc
  for (let hops = 0; hops < 60; hops++) {
    const parent = byPid.get(current.ppid)
    if (!parent || parent.pid <= 1) return current
    current = parent
  }
  return current
}

function build(processes, context) {
  const byPid = new Map(processes.map((proc) => [proc.pid, proc]))
  const owned = new Map()
  const ownOf = (proc) => {
    let result = owned.get(proc.pid)
    if (!result) {
      result = own(proc, context)
      owned.set(proc.pid, result)
    }
    return result
  }
  const classes = new Map(processes.map((proc) => [proc.pid, resolve(proc, byPid, ownOf)]))
  const dockerRunning = [...classes.values()].some((item) => item.group === 'docker')
  const containers = context.docker ? context.docker.containers : []
  const groups = new Map()
  const facts = {
    gradle: [],
    pages: {},
    heavyPages: {},
    windows: {},
    sessions: 0,
    devices: 0,
    vmBytes: 0,
    dockerAppBytes: 0,
    docker: Boolean(context.docker),
    containers,
    containersBytes: containers.reduce((total, item) => total + item.bytes, 0),
    projects: new Map(),
    procs: new Map(),
  }

  for (const proc of processes) {
    let item = classes.get(proc.pid)
    if (item.group === 'vm' && dockerRunning) item = { ...item, group: 'docker' }
    const group = groups.get(item.group) || { key: item.group, name: groupName(item.group), bytes: 0, cpu: 0, count: 0, parts: new Map() }
    group.bytes += proc.mem
    group.cpu += proc.cpu
    group.count += 1
    const part = group.parts.get(item.part) || { key: item.part, name: item.part, bytes: 0, count: 0 }
    part.bytes += proc.mem
    part.count += 1
    group.parts.set(item.part, part)
    groups.set(item.group, group)

    if (item.page) {
      facts.pages[item.group] = (facts.pages[item.group] || 0) + 1
      if (proc.mem >= HEAVY_PAGE_BYTES) facts.heavyPages[item.group] = (facts.heavyPages[item.group] || 0) + 1
    }
    if (item.window) facts.windows[item.group] = (facts.windows[item.group] || 0) + 1
    if (item.session) facts.sessions += 1
    if (item.device) facts.devices += 1
    if (item.gradle) facts.gradle.push({ pid: proc.pid, label: item.part, bytes: proc.mem, cpu: proc.cpu })
    if (item.group === 'docker') {
      if (item.vm) facts.vmBytes += proc.mem
      else facts.dockerAppBytes += proc.mem
    }
    let project = null
    if (item.group === 'dev') {
      project = projectOf(proc, byPid, context.cwd)
      const entry = facts.projects.get(project) || { name: project, kind: item.part, strong: false, bytes: 0, age: 0, main: null }
      entry.bytes += proc.mem
      entry.age = Math.max(entry.age, proc.age)
      const better = !entry.main || (item.strong && !entry.strong) || (item.strong === entry.strong && proc.mem > entry.main.mem)
      if (better && !item.inherited) {
        entry.main = proc
        entry.kind = item.part
        entry.strong = item.strong
      }
      facts.projects.set(project, entry)
    }
    facts.procs.set(proc.pid, { group: item.group, groupName: group.name, part: item.part, cpu: proc.cpu, project })
  }

  for (const entry of facts.projects.values()) {
    entry.detached = false
    if (!entry.main) continue
    const root = rootOf(entry.main, byPid)
    entry.pid = entry.main.pid
    entry.detached =
      root.pid !== entry.main.pid &&
      !root.path.includes('.app/') &&
      !context.launchd.has(root.pid) &&
      !KEEPERS.has(path.basename(root.path))
  }

  return { groups: [...groups.values()], facts }
}

module.exports = { build, needsCwd, groupName, own, projectOf, appLabel, SYSTEM_PREFIXES }
