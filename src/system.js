const { execFile } = require('child_process')

const ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' }
const TOP_UNITS = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }
const DOCKER_UNITS = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }
const UPTIME_UNITS = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env: ENV, timeout: options.timeout || 10000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        error.stdout = stdout
        reject(error)
      } else {
        resolve(stdout)
      }
    })
  })
}

function parseTopSize(text) {
  const match = /^([\d.]+)([BKMGT]?)[+-]?$/.exec(String(text).trim())
  return match ? Math.round(Number(match[1]) * TOP_UNITS[match[2] || 'B']) : 0
}

function parseDockerSize(text) {
  const match = /^([\d.]+)\s*([A-Za-z]+)?$/.exec(String(text).trim())
  return match ? Math.round(Number(match[1]) * (DOCKER_UNITS[match[2] || 'B'] || 1)) : 0
}

function parseTopSample(text) {
  const processes = new Map()
  let cpuBusy = null
  let table = false
  for (const line of text.split('\n')) {
    if (table) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
        processes.set(Number(parts[0]), { mem: parseTopSize(parts[1]), cpu: Number(parts[2]) || 0 })
      }
      continue
    }
    if (line.startsWith('CPU usage:')) {
      const idle = /([\d.]+)% idle/.exec(line)
      if (idle) cpuBusy = Math.max(0, Math.min(100, 100 - Number(idle[1])))
    } else if (/^\s*PID\s+MEM/.test(line)) {
      table = true
    }
  }
  return { processes, cpuBusy }
}

function parseElapsed(text) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(text).trim())
  if (!match) return 0
  const [, days = 0, hours = 0, minutes, seconds] = match
  return Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

function parsePs(text) {
  const result = new Map()
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line)
    if (match) {
      const pid = Number(match[1])
      result.set(pid, { pid, ppid: Number(match[2]), age: parseElapsed(match[3]), path: match[4].trim() })
    }
  }
  return result
}

function parseArgs(text) {
  const result = new Map()
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s(.*)$/.exec(line)
    if (match) result.set(Number(match[1]), match[2])
  }
  return result
}

function parseVmStat(text) {
  const size = Number((/page size of (\d+) bytes/.exec(text) || [])[1]) || 16384
  const pages = {}
  for (const line of text.split('\n')) {
    const match = /^"?([^":]+)"?:\s+(\d+)\.?\s*$/.exec(line.trim())
    if (match) pages[match[1].trim()] = Number(match[2]) * size
  }
  return pages
}

function parseSwap(text) {
  const total = /total = ([\d.]+)M/.exec(text)
  const used = /used = ([\d.]+)M/.exec(text)
  return {
    total: total ? Number(total[1]) * 1024 ** 2 : 0,
    used: used ? Number(used[1]) * 1024 ** 2 : 0,
  }
}

function parseDf(text) {
  const parts = (text.trim().split('\n')[1] || '').trim().split(/\s+/)
  const size = Number(parts[1]) * 1024
  const free = Number(parts[3]) * 1024
  return Number.isFinite(size) && size > 0 && Number.isFinite(free) ? { size, free } : null
}

function parseCwd(text) {
  const result = new Map()
  let pid = null
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid) result.set(pid, line.slice(1))
  }
  return result
}

function parseLaunchd(text) {
  const pids = new Set()
  for (const line of text.split('\n').slice(1)) {
    const pid = Number(line.split('\t')[0])
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return pids
}

function parseServices(text) {
  const services = new Map()
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+\S+\s+(\S+)\s*$/.exec(line)
    if (match && Number(match[1]) > 0) services.set(Number(match[1]), match[2])
  }
  return services
}

function bundleRoot(file) {
  const at = `${file}/`.indexOf('.app/')
  return at < 0 ? null : file.slice(0, at + 4)
}

function parseForegroundApps(text) {
  const bundles = new Set()
  let bundle = null
  for (const line of text.split('\n')) {
    const found = /^\s*bundle path="(.*)"/.exec(line)
    if (found) bundle = bundleRoot(found[1])
    else if (/^\s*\d+\)\s/.test(line)) bundle = null
    else if (bundle && /\bpid = \d+.*\btype="Foreground"/.test(line)) bundles.add(bundle)
  }
  return bundles
}

function parseListeners(text) {
  const ports = new Map()
  let pid = null
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1))
    } else if (line.startsWith('n') && pid) {
      const match = /:(\d+)$/.exec(line)
      if (!match) continue
      if (!ports.has(pid)) ports.set(pid, new Set())
      ports.get(pid).add(Number(match[1]))
    }
  }
  return new Map([...ports].map(([owner, found]) => [owner, [...found].sort((a, b) => a - b)]))
}

function parseUptime(status) {
  const match = /^Up (?:About )?(Less than a|an?|\d+) (second|minute|hour|day|week|month|year)s?/i.exec(String(status).trim())
  if (!match) return 0
  return (Number(match[1]) || 1) * UPTIME_UNITS[match[2].toLowerCase()]
}

function parseContainers(text) {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [name, image, state, status = '', ports = '', project = ''] = line.split('\t')
      const health = /\(unhealthy\)/i.test(status) ? 'unhealthy' : /\(health: starting\)/i.test(status) ? 'starting' : ''
      return {
        name,
        image,
        project,
        state: String(state).toLowerCase(),
        health,
        uptime: parseUptime(status),
        ports: [...new Set([...ports.matchAll(/:(\d+(?:-\d+)?)->/g)].map((match) => match[1]))],
      }
    })
}

module.exports = {
  ENV,
  run,
  parseTopSize,
  parseDockerSize,
  parseTopSample,
  parseElapsed,
  parsePs,
  parseArgs,
  parseVmStat,
  parseSwap,
  parseDf,
  parseCwd,
  parseLaunchd,
  parseServices,
  bundleRoot,
  parseForegroundApps,
  parseListeners,
  parseUptime,
  parseContainers,
}
