const test = require('node:test')
const assert = require('node:assert/strict')
const checks = require('../src/checks')
const { createDemoSampler, createDemoStorage } = require('../src/demo')

const GB = 1024 ** 3
const quiet = { idle: new Map(), hot: new Map() }

function facts(extra = {}) {
  return { gradle: [], projects: new Map(), procs: new Map(), pages: {}, heavyPages: {}, windows: {}, vmBytes: 0, containersBytes: 0, docker: false, ...extra }
}

test('the verdict follows macOS memory pressure', () => {
  const disk = { size: 500e9, free: 200e9 }
  const verdict = (level, demand, swapUsed) => checks.verdict({ pressure: checks.pressureOf(level), demand, total: 16 * GB, swapUsed, disk }).title
  assert.equal(verdict(1, 9 * GB, 0), 'Your Mac is fine')
  assert.equal(verdict(2, 26 * GB, 5 * GB), 'Your Mac is short on RAM')
  assert.equal(verdict(4, 40 * GB, 20 * GB), 'Your Mac is out of RAM')
})

test('a nearly full disk gets its own verdict when RAM is fine', () => {
  const verdict = checks.verdict({ pressure: checks.pressureOf(1), demand: 8 * GB, total: 16 * GB, swapUsed: 0, disk: { size: 500e9, free: 30e9 } })
  assert.equal(verdict.title, 'Your disk is almost full')
})

test('flags an app that uses more than about a third of RAM', () => {
  const groups = [
    { key: 'browser:Chrome', name: 'Chrome', bytes: 7 * GB },
    { key: 'app:Notes', name: 'Notes', bytes: 0.1 * GB },
  ]
  const list = checks.problems({
    facts: facts({ pages: { 'browser:Chrome': 40 }, heavyPages: { 'browser:Chrome': 5 } }),
    groups,
    pressure: checks.pressureOf(2),
    disk: null,
    trackers: quiet,
    growth: [],
    now: Date.now(),
    total: 16 * GB,
  })
  assert.deepEqual(
    list.map((problem) => problem.id),
    ['heavy-browser:Chrome'],
  )
  assert.match(list[0].value, /^5 pages over 300/)
})

test('flags Gradle processes idle for 20 minutes', () => {
  const now = Date.now()
  const list = checks.problems({
    facts: facts({ gradle: [{ pid: 7, label: 'Gradle 8.13', bytes: 2 * GB, cpu: 0 }] }),
    groups: [],
    pressure: checks.pressureOf(1),
    disk: null,
    trackers: { idle: new Map([[7, now - 25 * 60 * 1000]]), hot: new Map() },
    growth: [],
    now,
    total: 16 * GB,
  })
  assert.equal(list[0].id, 'gradle-idle')
  assert.match(list[0].title, /^1 Gradle process has been idle for 25/)
})

test('the demo builds a full page of made-up data', () => {
  const snapshot = createDemoSampler().snapshot(createDemoStorage().view())
  assert.equal(snapshot.ready, true)
  assert.equal(snapshot.verdict.title, 'Your Mac is short on RAM')
  assert.equal(snapshot.problems.length, 3)
  assert.ok(snapshot.usage.groups.length >= 5)
  assert.equal(snapshot.storage.status, 'ready')
})
