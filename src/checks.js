const format = require('./format')

const { GIB, MIB } = format

const LIMITS = {
  gradleIdleSeconds: 20 * 60,
  idleCpu: 1,
  heavyPageBytes: 300 * MIB,
  hotCpu: 80,
  hotSeconds: 120,
  growthWindowMs: 10 * 60 * 1000,
  detachedBytes: 100 * MIB,
  diskWarnFree: 0.15,
  diskCriticalFree: 0.08,
}

const ORDER = { critical: 0, warning: 1 }

function scaled(total) {
  return {
    heavyAppBytes: Math.max(2 * GIB, total * 0.375),
    growthBytes: Math.max(GIB, total * 0.1),
    dockerSlackBytes: Math.max(1.5 * GIB, total * 0.15),
  }
}

function taskManagerHint(name, what) {
  if (name === 'Chrome') return `Chrome’s Window menu, then Task Manager, shows ${what}.`
  return `${name}’s task manager shows ${what}.`
}

function pressureOf(level) {
  if (level >= 4) return { level: 'critical', label: 'Critical' }
  if (level >= 2) return { level: 'warning', label: 'Warning' }
  return { level: 'normal', label: 'Normal' }
}

function diskLevel(disk) {
  if (!disk) return 'normal'
  const free = disk.free / disk.size
  if (free < LIMITS.diskCriticalFree) return 'critical'
  if (free < LIMITS.diskWarnFree) return 'warning'
  return 'normal'
}

function usedPercent(disk) {
  return format.percent((1 - disk.free / disk.size) * 100)
}

function ramSentence(level, demand, total, swapUsed) {
  if (level === 'normal') {
    if (demand <= total) return `Apps use ${format.memory(demand)} of your ${format.memory(total)} of RAM.`
    return `Apps want ${format.memory(demand)} on ${format.memory(total)} of RAM, and macOS keeps up by compressing memory.`
  }
  const tail = swapUsed >= 512 * MIB ? `so macOS is using ${format.memory(swapUsed)} of disk as RAM.` : 'so macOS is compressing memory to keep up.'
  return `Apps want ${format.memory(demand)} on ${format.memory(total)} of RAM, ${tail}`
}

function verdict({ pressure, demand, total, swapUsed, disk }) {
  const diskState = diskLevel(disk)
  let text = ramSentence(pressure.level, demand, total, swapUsed)
  if (pressure.level === 'critical') text += ' Apps stay slow until you close something.'
  if (pressure.level !== 'normal' && diskState !== 'normal') text += ` Your disk is also ${usedPercent(disk)} full.`
  if (pressure.level === 'critical') return { level: 'critical', title: 'Your Mac is out of RAM', text }
  if (pressure.level === 'warning') return { level: 'warning', title: 'Your Mac is short on RAM', text }
  if (diskState !== 'normal') {
    return {
      level: diskState,
      title: 'Your disk is almost full',
      text: `Only ${format.disk(disk.free)} of ${format.disk(disk.size)} is free, and macOS needs room for swap and updates.`,
    }
  }
  return { level: 'normal', title: 'Your Mac is fine', text }
}

function growthOf(history, groups, now, total) {
  const { growthBytes } = scaled(total)
  const result = []
  for (const group of groups) {
    let low = Infinity
    let lowAt = now
    for (const entry of history) {
      if (now - entry.at > LIMITS.growthWindowMs) continue
      const value = entry.bytes.get(group.key)
      if (value !== undefined && value < low) {
        low = value
        lowAt = entry.at
      }
    }
    const delta = group.bytes - low
    if (Number.isFinite(low) && delta >= growthBytes) {
      result.push({ key: group.key, name: group.name, delta, seconds: (now - lowAt) / 1000, bytes: group.bytes })
    }
  }
  return result
}

function hotName(proc) {
  if (proc.group.startsWith('browser:') && proc.part === 'Pages') return `A ${proc.groupName} page`
  if (proc.group === 'dev') return proc.project || 'A dev server'
  if (proc.group === 'other') return proc.part
  return proc.groupName
}

function problems({ facts, groups, pressure, disk, trackers, growth, now, total }) {
  const limits = scaled(total)
  const list = []

  const idle = facts.gradle.filter((item) => {
    const since = trackers.idle.get(item.pid)
    return since && (now - since) / 1000 >= LIMITS.gradleIdleSeconds
  })
  if (idle.length) {
    const bytes = idle.reduce((total, item) => total + item.bytes, 0)
    const idleFor = Math.min(...idle.map((item) => (now - trackers.idle.get(item.pid)) / 1000))
    list.push({
      id: 'gradle-idle',
      level: 'warning',
      bytes,
      title: `${format.plural(idle.length, 'Gradle process has', 'Gradle processes have')} been idle for ${format.duration(idleFor)}`,
      value: format.memory(bytes),
      text: 'Run ./gradlew --stop in any Android project to give this memory back.',
    })
  }

  for (const project of facts.projects.values()) {
    if (!project.detached || project.bytes < LIMITS.detachedBytes) continue
    list.push({
      id: `detached-${project.name}`,
      level: 'warning',
      bytes: project.bytes,
      title: `${project.name} is running with no window`,
      value: format.memory(project.bytes),
      text: `The window that started this ${project.kind} is gone, so you can’t see its output or stop it there. It has run for ${format.duration(project.age)}. Process ID ${project.pid}.`,
    })
  }

  const slack = facts.vmBytes - facts.containersBytes
  if (facts.docker && pressure.level !== 'normal' && facts.containersBytes > 0 && slack >= limits.dockerSlackBytes) {
    list.push({
      id: 'docker-slack',
      level: 'warning',
      bytes: slack,
      title: `Docker holds ${format.memory(facts.vmBytes)}, but its containers use ${format.memory(facts.containersBytes)}`,
      value: `${format.memory(slack)} unused`,
      text: 'Docker doesn’t hand freed memory back to your Mac. Restarting Docker does.',
    })
  }

  for (const group of groups) {
    if (['docker', 'macos', 'other'].includes(group.key) || group.bytes < limits.heavyAppBytes) continue
    if (group.key.startsWith('browser:')) {
      const heavy = facts.heavyPages[group.key] || 0
      const over = format.memory(LIMITS.heavyPageBytes)
      list.push({
        id: `heavy-${group.key}`,
        level: 'warning',
        bytes: group.bytes,
        title: `${group.name} is using ${format.memory(group.bytes)}`,
        value: heavy ? format.plural(heavy, `page over ${over}`, `pages over ${over}`) : format.plural(facts.pages[group.key] || 0, 'page', 'pages'),
        text: taskManagerHint(group.name, 'which tabs use the most'),
      })
    } else if (group.key.startsWith('editor:')) {
      list.push({
        id: `heavy-${group.key}`,
        level: 'warning',
        bytes: group.bytes,
        title: `${group.name} is using ${format.memory(group.bytes)}`,
        value: format.plural(facts.windows[group.key] || 0, 'window', 'windows'),
        text: 'Close the windows you aren’t using. Each one runs its own extensions.',
      })
    } else {
      list.push({
        id: `heavy-${group.key}`,
        level: 'warning',
        bytes: group.bytes,
        title: `${group.name} is using ${format.memory(group.bytes)}`,
        value: '',
        text: 'Quit it if you aren’t using it.',
      })
    }
  }

  for (const [pid, since] of trackers.hot) {
    const seconds = (now - since) / 1000
    const proc = facts.procs.get(pid)
    if (seconds < LIMITS.hotSeconds || !proc || proc.group === 'macos') continue
    list.push({
      id: `hot-${pid}`,
      level: 'warning',
      bytes: 0,
      title: `${hotName(proc)} has used ${format.percent(proc.cpu)} CPU for ${format.duration(seconds)}`,
      value: format.percent(proc.cpu),
      text: proc.group.startsWith('browser:') ? taskManagerHint(proc.groupName, 'which tab it is') : 'Quit it if it isn’t doing something you need.',
    })
  }

  if (pressure.level !== 'normal') {
    for (const item of growth) {
      list.push({
        id: `growth-${item.key}`,
        level: 'warning',
        bytes: item.delta,
        title: `${item.name} grew ${format.memory(item.delta)} in ${format.duration(item.seconds)}`,
        value: format.memory(item.bytes),
        text: 'Something in it keeps taking more memory.',
      })
    }
  }

  const diskState = diskLevel(disk)
  if (diskState !== 'normal') {
    list.push({
      id: 'disk',
      level: diskState,
      bytes: 0,
      title: `Your disk is ${usedPercent(disk)} full`,
      value: `${format.disk(disk.free)} free`,
      text: 'macOS needs free space for swap and updates. Space you can free, below, lists what’s safe to clear.',
    })
  }

  return list
    .sort((a, b) => ORDER[a.level] - ORDER[b.level] || b.bytes - a.bytes)
    .map(({ id, level, title, value, text }) => ({ id, level, title, value, text }))
}

module.exports = { LIMITS, pressureOf, diskLevel, verdict, growthOf, problems }
