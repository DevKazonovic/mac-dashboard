const fs = require('fs')
const path = require('path')
const system = require('./system')
const format = require('./format')
const { HOME, PROJECT_DIRS } = require('./paths')

const HOUR_MS = 60 * 60 * 1000
const FIRST_DELAY_MS = 20 * 1000
const MIN_BYTES = 300 * 1024 ** 2
const FOLDERS = [
  { key: 'xcode', name: 'Xcode build data', folder: 'Library/Developer/Xcode/DerivedData', how: 'Delete ~/Library/Developer/Xcode/DerivedData', command: false },
  { key: 'simulator-caches', name: 'iOS Simulator caches', folder: '/Library/Developer/CoreSimulator/Caches', how: 'xcrun simctl runtime dyld_shared_cache remove --all', command: true },
  { key: 'simulator-logs', name: 'iOS Simulator logs', folder: 'Library/Logs/CoreSimulator', how: 'Delete ~/Library/Logs/CoreSimulator', command: false },
  { key: 'npm', name: 'npm cache', folder: '.npm/_cacache', how: 'npm cache clean --force', command: true },
  { key: 'pnpm', name: 'pnpm store', folder: 'Library/pnpm/store', how: 'pnpm store prune', command: true },
  { key: 'yarn', name: 'Yarn cache', folder: 'Library/Caches/Yarn', how: 'yarn cache clean', command: true },
  { key: 'gradle', name: 'Gradle downloads', folder: '.gradle/caches', how: 'Delete ~/.gradle/caches. Builds download what they need again.', command: false },
  { key: 'gradle-logs', name: 'Gradle logs', folder: '.gradle/daemon', how: 'Delete the .log files in ~/.gradle/daemon', command: false },
  { key: 'pub', name: 'Dart package cache', folder: '.pub-cache', how: 'dart pub cache clean', command: true },
  { key: 'cocoapods', name: 'CocoaPods cache', folder: 'Library/Caches/CocoaPods', how: 'pod cache clean --all', command: true },
  { key: 'homebrew', name: 'Homebrew downloads', folder: 'Library/Caches/Homebrew', how: 'brew cleanup --prune=all', command: true },
  { key: 'chrome', name: 'Chrome cache', folder: 'Library/Caches/Google/Chrome', how: 'Chrome settings, then Delete browsing data, then Cached images and files', command: false },
]

async function folderSize(folder) {
  try {
    await fs.promises.access(folder)
  } catch {
    return 0
  }
  const out = await system.run('nice', ['-n', '19', 'du', '-sk', folder], { timeout: 180000 }).catch((error) => error.stdout || '')
  const kilobytes = Number(String(out).trim().split(/\s+/)[0])
  return Number.isFinite(kilobytes) ? kilobytes * 1024 : 0
}

async function dockerSizes() {
  try {
    const out = await system.run('docker', ['system', 'df', '--format', '{{json .}}'], { timeout: 60000 })
    const sizes = {}
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const row = JSON.parse(line)
      sizes[row.Type] = system.parseDockerSize(String(row.Reclaimable || '').split(' ')[0])
    }
    return sizes
  } catch {
    return null
  }
}

async function flutterBuilds(roots) {
  const prune = ['(', '-name', 'node_modules', '-o', '-name', '.git', '-o', '-name', 'build', '-o', '-name', '.dart_tool', '-o', '-name', 'Pods', ')', '-prune']
  const seen = new Set()
  let bytes = 0
  let projects = 0
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    const out = await system
      .run('nice', ['-n', '19', 'find', root, '-maxdepth', '7', ...prune, '-o', '-name', 'pubspec.yaml', '-print'], { timeout: 180000 })
      .catch((error) => error.stdout || '')
    for (const file of String(out).trim().split('\n').filter(Boolean)) {
      const dir = path.dirname(file)
      if (seen.has(dir)) continue
      seen.add(dir)
      const size = (await folderSize(path.join(dir, 'build'))) + (await folderSize(path.join(dir, '.dart_tool')))
      if (size > 0) {
        bytes += size
        projects += 1
      }
    }
  }
  return { bytes, projects }
}

function createStorage({ projectDirs = [] } = {}) {
  const roots = [...new Set([...PROJECT_DIRS, ...projectDirs.map((dir) => path.resolve(dir))])]
  let state = { status: 'idle', measuredAt: null, items: [], error: null }
  let running = null
  let firstTimer = null
  let hourly = null

  async function collect() {
    const items = []
    const docker = await dockerSizes()
    if (docker) {
      items.push({ key: 'docker-build', name: 'Docker build cache', bytes: docker['Build Cache'] || 0, how: 'docker builder prune -af', command: true })
      items.push({ key: 'docker-images', name: 'Docker images no container uses', bytes: docker.Images || 0, how: 'docker image prune -a', command: true })
    }
    for (const folder of FOLDERS) {
      items.push({ ...folder, bytes: await folderSize(path.isAbsolute(folder.folder) ? folder.folder : path.join(HOME, folder.folder)) })
    }
    const builds = await flutterBuilds(roots)
    items.push({
      key: 'flutter-builds',
      name: `Flutter build folders in ${format.plural(builds.projects, 'project', 'projects')}`,
      bytes: builds.bytes,
      how: 'flutter clean, in the projects you aren’t working on',
      command: false,
    })
    return items.filter((item) => item.bytes >= MIN_BYTES).sort((a, b) => b.bytes - a.bytes)
  }

  function measure() {
    if (running) return running
    state = { ...state, status: 'measuring', error: null }
    running = collect()
      .then((items) => {
        state = { status: 'ready', measuredAt: Date.now(), items, error: null }
      })
      .catch((error) => {
        state = { ...state, status: 'failed', error: error.message }
      })
      .finally(() => {
        running = null
      })
    return running
  }

  function start() {
    firstTimer = setTimeout(measure, FIRST_DELAY_MS)
    hourly = setInterval(measure, HOUR_MS)
  }

  function stop() {
    clearTimeout(firstTimer)
    clearInterval(hourly)
  }

  function view() {
    const total = state.items.reduce((sum, item) => sum + item.bytes, 0)
    let meta = ''
    if (state.status === 'measuring') meta = 'Measuring your folders…'
    else if (state.status === 'idle') meta = 'Measuring starts in a few seconds'
    else if (state.measuredAt) meta = `${total ? `${format.disk(total)} in total, measured` : 'Measured'} ${format.ago(state.measuredAt)}`
    return {
      status: state.status,
      meta,
      total: total ? format.disk(total) : '',
      error: state.error,
      items: state.items.map((item) => ({ key: item.key, name: item.name, size: format.disk(item.bytes), how: item.how, command: item.command })),
    }
  }

  return { start, stop, measure, view }
}

module.exports = { createStorage }
