const test = require('node:test')
const assert = require('node:assert/strict')
const system = require('../src/system')
const format = require('../src/format')

test('reads top sizes with their units and change markers', () => {
  assert.equal(system.parseTopSize('4240K+'), 4240 * 1024)
  assert.equal(system.parseTopSize('7433M'), 7433 * 1024 ** 2)
  assert.equal(system.parseTopSize('2G-'), 2 * 1024 ** 3)
  assert.equal(system.parseTopSize('junk'), 0)
})

test('reads a top sample', () => {
  const sample = system.parseTopSample(
    [
      'Processes: 588 total, 3 running, 585 sleeping, 5418 threads',
      'CPU usage: 10.47% user, 13.22% sys, 76.29% idle',
      'PhysMem: 15G used (2440M wired, 8005M compressor), 110M unused.',
      '',
      'PID    MEM    %CPU',
      '1850   7433M  13.0',
      '5814   877M+  39.7',
    ].join('\n'),
  )
  assert.equal(Math.round(sample.cpuBusy), 24)
  assert.deepEqual(sample.processes.get(1850), { mem: 7433 * 1024 ** 2, cpu: 13 })
  assert.equal(sample.processes.get(5814).cpu, 39.7)
})

test('reads elapsed times from ps', () => {
  assert.equal(system.parseElapsed('17:36'), 17 * 60 + 36)
  assert.equal(system.parseElapsed('01:02:03'), 3723)
  assert.equal(system.parseElapsed('2-03:00:00'), 2 * 86400 + 3 * 3600)
})

test('reads ps rows with spaces in the path', () => {
  const rows = system.parsePs('  505     1 01:00:00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n')
  assert.deepEqual(rows.get(505), { pid: 505, ppid: 1, age: 3600, path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
})

test('reads vm_stat pages with their page size', () => {
  const pages = system.parseVmStat(
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                               22438.\n"Translation faults":                 123.\n',
  )
  assert.equal(pages['Pages free'], 22438 * 16384)
  assert.equal(pages['Translation faults'], 123 * 16384)
})

test('reads swap, disk, working folder and launchd output', () => {
  assert.deepEqual(system.parseSwap('total = 6144.00M  used = 5338.56M  free = 805.44M  (encrypted)'), {
    total: 6144 * 1024 ** 2,
    used: 5338.56 * 1024 ** 2,
  })
  assert.deepEqual(
    system.parseDf('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 482797652 400000000 31600000 93% /System/Volumes/Data\n'),
    { size: 482797652 * 1024, free: 31600000 * 1024 },
  )
  assert.equal(system.parseCwd('p123\nfcwd\nn/Users/me/Projects/shop\n').get(123), '/Users/me/Projects/shop')
  assert.deepEqual([...system.parseLaunchd('PID\tStatus\tLabel\n-\t0\tcom.example.idle\n4321\t0\tcom.example.running\n')], [4321])
})

test('reads Docker sizes in both unit styles', () => {
  assert.equal(system.parseDockerSize('1.5GiB'), Math.round(1.5 * 1024 ** 3))
  assert.equal(system.parseDockerSize('18.3GB'), Math.round(18.3e9))
  assert.equal(system.parseDockerSize('512MiB'), 512 * 1024 ** 2)
})

test('reads running services from launchctl list and print', () => {
  const list = system.parseServices('PID\tStatus\tLabel\n-\t0\tcom.example.idle\n4321\t-9\tcom.example.running\n')
  assert.deepEqual([...list], [[4321, 'com.example.running']])
  const printed = system.parseServices(
    ['system = {', '\tservice count = 431', '\tservices = {', '\t\t       0      - \tcom.vix.cron', '\t\t     297      - \torg.pqrs.daemon', '\t\t   25850   (pe) \tcom.apple.logd_helper', '\t}', '}'].join('\n'),
  )
  assert.deepEqual([...printed], [[297, 'org.pqrs.daemon'], [25850, 'com.apple.logd_helper']])
})

test('finds the bundles of apps with a Dock icon', () => {
  const bundles = system.parseForegroundApps(
    [
      ' 1) "Google Chrome" ASN:0x0-0x1c01c: ',
      '    bundleID="com.google.Chrome"',
      '    bundle path="/Applications/Google Chrome.app"',
      '    pid = 27721 type="Foreground" flavor=3 Version="1"',
      ' 2) "Rectangle" ASN:0x0-0x2002: ',
      '    bundle path="/Applications/Rectangle.app"',
      '    pid = 1063 type="UIElement" flavor=3',
      ' 3) "universalaccessd" ASN:0x0-0x8008: ',
      '    bundle path="/usr/sbin/universalaccessd"',
      '    pid = 423 !signalled type="BackgroundOnly" flavor=3',
      ' 4) "Docker Desktop" ASN:0x0-0x9009: ',
      '    bundle path="/Applications/Docker.app/Contents/MacOS/Docker Desktop.app"',
      '    pid = 19629 type="Foreground" flavor=3',
    ].join('\n'),
  )
  assert.deepEqual([...bundles], ['/Applications/Google Chrome.app', '/Applications/Docker.app'])
})

test('reads listening ports from lsof', () => {
  const ports = system.parseListeners('p1048\nf16\nn127.0.0.1:3738\np23059\nf20\nn*:24678\nf21\nn*:3001\nf22\nn[::1]:3001\n')
  assert.deepEqual(ports.get(1048), [3738])
  assert.deepEqual(ports.get(23059), [3001, 24678])
})

test('reads running containers from docker ps', () => {
  const [mysql, web, worker] = system.parseContainers(
    [
      'video-studio-mysql\tmysql:8.4\trunning\tUp 11 hours (healthy)\t127.0.0.1:3340->3306/tcp\tvideo-studio',
      'web\tshop-web\trestarting\tRestarting (1) 5 seconds ago\t\t',
      'worker\tshop-worker\trunning\tUp About a minute (unhealthy)\t0.0.0.0:8000-8002->8000-8002/tcp, [::]:8000-8002->8000-8002/tcp\tshop',
    ].join('\n'),
  )
  assert.deepEqual(mysql, { name: 'video-studio-mysql', image: 'mysql:8.4', project: 'video-studio', state: 'running', health: '', uptime: 11 * 3600, ports: ['3340'] })
  assert.equal(web.state, 'restarting')
  assert.equal(web.uptime, 0)
  assert.equal(worker.health, 'unhealthy')
  assert.equal(worker.uptime, 60)
  assert.deepEqual(worker.ports, ['8000-8002'])
})

test('formats sizes and durations for people', () => {
  assert.equal(format.memory(16 * 1024 ** 3), '16 GB')
  assert.equal(format.memory(3.7 * 1024 ** 3), '3.7 GB')
  assert.equal(format.memory(300 * 1024 ** 2), '300 MB')
  assert.equal(format.disk(212.4e9), '212 GB')
  assert.equal(format.duration(42 * 60), '42 min')
  assert.equal(format.duration(3 * 3600 + 12 * 60), '3 h 12 min')
  assert.equal(format.plural(1, 'page', 'pages'), '1 page')
})
