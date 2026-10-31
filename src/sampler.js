const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const system = require('./system')
const classify = require('./classify')
const checks = require('./checks')
const present = require('./present')

const INTERVAL_SECONDS = 5
const HISTORY_MS = 15 * 60 * 1000
const RESTART_MS = 3000
const CHROME_STATE = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Local State')

function createSampler() {
  const cache = { cwd: new Map(), launchd: new Set(), disk: null, docker: null, dockerLimit: null, chromeProfiles: 0 }
  const trackers = { idle: new Map(), hot: new Map() }
  const history = []
  let child = null
  let buffer = ''
  let flushTimer = null
  let restartTimer = null
  let stopped = false
  let firstSample = true
  let busy = false
  let dockerBusy = false
  let tick = 0
  let latest = null
  let error = null

  function startTop() {
    buffer = ''
    firstSample = true
    child = spawn('top', ['-l', '0', '-s', String(INTERVAL_SECONDS), '-n', '5000', '-o', 'mem', '-stats', 'pid,mem,cpu'], {
      env: system.ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      clearTimeout(flushTimer)
      flushTimer = setTimeout(flush, 200)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      if (chunk.trim()) error = `top reported: ${chunk.trim()}`
    })
    child.on('error', (failure) => {
      error = `Could not start top: ${failure.message}`
    })
    child.on('exit', () => {
      child = null
      if (!stopped) restartTimer = setTimeout(startTop, RESTART_MS)
    })
  }

  function flush() {
    const pieces = buffer.split(/(?=^Processes:)/m).filter((piece) => piece.startsWith('Processes:'))
    buffer = ''
    const piece = pieces[pieces.length - 1]
    if (!piece) return
    const sample = system.parseTopSample(piece)
    const cpuValid = !firstSample
    firstSample = false
    if (busy || !sample.processes.size) return
    busy = true
    collect(sample, cpuValid)
      .then(() => {
        error = null
      })
      .catch((failure) => {
        error = `Reading your Mac’s numbers failed: ${failure.message}`
      })
      .finally(() => {
        busy = false
      })
  }

  async function chromeProfiles() {
    try {
      const state = JSON.parse(await fs.promises.readFile(CHROME_STATE, 'utf8'))
      return ((state.profile || {}).last_active_profiles || []).length
    } catch {
      return 0
    }
  }

  async function refreshSlow(processes) {
    const [dfText, launchdText] = await Promise.all([
      system.run('df', ['-k', '/System/Volumes/Data']).catch(() => system.run('df', ['-k', '/']).catch(() => '')),
      system.run('launchctl', ['list']).catch(() => ''),
    ])
    cache.disk = system.parseDf(dfText) || cache.disk
    cache.launchd = system.parseLaunchd(launchdText)
    const chromeRunning = processes.some((proc) => proc.path.includes('/Google Chrome.app/'))
    cache.chromeProfiles = chromeRunning ? await chromeProfiles() : 0
  }

  async function refreshDocker(processes) {
    if (dockerBusy) return
    const running = processes.some((proc) => proc.path.includes('/Docker.app/') || path.basename(proc.path) === 'com.docker.backend')
    if (!running) {
      cache.docker = null
      return
    }
    dockerBusy = true
    try {
      const out = await system.run('docker', ['stats', '--no-stream', '--format', '{{json .}}'], { timeout: 20000 })
      const containers = out
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .map((row) => ({ name: row.Name, bytes: system.parseDockerSize(String(row.MemUsage || '').split('/')[0]) }))
      cache.docker = { containers }
      if (!cache.dockerLimit || tick % 12 === 0) {
        const info = await system.run('docker', ['info', '--format', '{{.MemTotal}}'], { timeout: 20000 })
        cache.dockerLimit = Number(info.trim()) || cache.dockerLimit
      }
    } catch {
      cache.docker = null
    } finally {
      dockerBusy = false
    }
  }

  async function refreshCwd(processes) {
    const alive = new Set(processes.map((proc) => proc.pid))
    for (const pid of cache.cwd.keys()) if (!alive.has(pid)) cache.cwd.delete(pid)
    const missing = processes.filter((proc) => classify.needsCwd(proc) && !cache.cwd.has(proc.pid)).map((proc) => proc.pid)
    if (!missing.length) return
    const out = await system.run('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', missing.join(',')], { timeout: 8000 }).catch((failure) => failure.stdout || '')
    const found = system.parseCwd(String(out))
    for (const pid of missing) cache.cwd.set(pid, found.get(pid) || '')
  }

  function trackCpu(processes, cpuValid, now) {
    const alive = new Set()
    for (const proc of processes) {
      alive.add(proc.pid)
      if (!cpuValid) continue
      if (proc.cpu < checks.LIMITS.idleCpu) {
        if (!trackers.idle.has(proc.pid)) trackers.idle.set(proc.pid, now)
      } else {
        trackers.idle.delete(proc.pid)
      }
      if (proc.cpu >= checks.LIMITS.hotCpu) {
        if (!trackers.hot.has(proc.pid)) trackers.hot.set(proc.pid, now)
      } else {
        trackers.hot.delete(proc.pid)
      }
    }
    for (const map of [trackers.idle, trackers.hot]) {
      for (const pid of map.keys()) if (!alive.has(pid)) map.delete(pid)
    }
  }

  async function collect(sample, cpuValid) {
    tick += 1
    const now = Date.now()
    const [psText, argsText, sysctlText, vmText] = await Promise.all([
      system.run('ps', ['-axo', 'pid=,ppid=,etime=,comm=']),
      system.run('ps', ['-axww', '-o', 'pid=,args=']),
      system.run('sysctl', ['-n', 'vm.swapusage', 'kern.memorystatus_vm_pressure_level', 'hw.memsize', 'hw.ncpu']),
      system.run('vm_stat'),
    ])
    const table = system.parsePs(psText)
    const args = system.parseArgs(argsText)
    const [swapLine = '', pressureLine = '1', memLine = '0', coresLine = '1'] = sysctlText.trim().split('\n')
    const processes = []
    let demand = 0
    for (const [pid, row] of table) {
      const measured = sample.processes.get(pid)
      const mem = measured ? measured.mem : 0
      demand += mem
      processes.push({ ...row, args: args.get(pid) || '', mem, cpu: cpuValid && measured ? measured.cpu : 0 })
    }
    if (tick === 1 || tick % 6 === 0) await refreshSlow(processes)
    if (tick === 1 || tick % 3 === 0) refreshDocker(processes)
    await refreshCwd(processes)
    const context = {
      selfPid: process.pid,
      cwd: cache.cwd,
      launchd: cache.launchd,
      docker: cache.docker,
      dockerLimit: cache.dockerLimit,
      chromeProfiles: cache.chromeProfiles,
    }
    const result = classify.build(processes, context)
    trackCpu(processes, cpuValid, now)
    history.push({ at: now, bytes: new Map(result.groups.map((group) => [group.key, group.bytes])) })
    while (history.length && now - history[0].at > HISTORY_MS) history.shift()
    latest = present.snapshot({
      now,
      sample,
      result,
      context,
      trackers,
      history,
      memory: {
        swap: system.parseSwap(swapLine),
        pressureLevel: Number(pressureLine) || 1,
        total: Number(memLine) || 0,
        cores: Number(coresLine) || 1,
        pages: system.parseVmStat(vmText),
        demand,
      },
      disk: cache.disk,
    })
  }

  function start() {
    stopped = false
    startTop()
  }

  function stop() {
    stopped = true
    clearTimeout(flushTimer)
    clearTimeout(restartTimer)
    if (child) child.kill()
  }

  function snapshot(storage) {
    if (!latest) return { ready: false, error }
    return { ...latest, storage, error }
  }

  return { start, stop, snapshot }
}

module.exports = { createSampler }
