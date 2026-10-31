const test = require('node:test')
const assert = require('node:assert/strict')
const classify = require('../src/classify')

const MB = 1024 ** 2
const context = { selfPid: 9999, cwd: new Map(), launchd: new Set(), docker: null }

function proc(pid, ppid, file, args = file, mem = 100 * MB) {
  return { pid, ppid, path: file, args, mem, cpu: 0, age: 600 }
}

test('groups browser helpers into one browser with a page count', () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const helper =
    '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/1/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)'
  const { groups, facts } = classify.build(
    [proc(10, 1, chrome), proc(11, 10, helper, `${helper} --type=renderer`, 400 * MB), proc(12, 10, helper, `${helper} --type=renderer --extension-process`, 50 * MB)],
    context,
  )
  const browser = groups.find((group) => group.key === 'browser:Chrome')
  assert.equal(browser.name, 'Chrome')
  assert.equal(browser.bytes, 550 * MB)
  assert.equal(facts.pages['browser:Chrome'], 1)
  assert.equal(facts.heavyPages['browser:Chrome'], 1)
})

test('counts Gradle processes and their Kotlin compilers', () => {
  const java = '/Library/Java/JavaVirtualMachines/jdk-21/Contents/Home/bin/java'
  const { groups, facts } = classify.build(
    [
      proc(20, 1, java, `${java} -Xmx4g -cp gradle-launcher.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.13`, 900 * MB),
      proc(21, 20, java, `${java} -cp kotlin.jar org.jetbrains.kotlin.daemon.KotlinCompileDaemon`, 300 * MB),
    ],
    context,
  )
  assert.equal(groups.find((group) => group.key === 'gradle').bytes, 1200 * MB)
  assert.deepEqual(
    facts.gradle.map((item) => item.label),
    ['Gradle 8.13', 'Kotlin compiler'],
  )
})

test('finds a dev server whose window is gone', () => {
  const java = '/usr/bin/java'
  const cwd = new Map([
    [31, '/Users/me/Projects/shop-api'],
    [32, '/Users/me/Projects/shop-api'],
  ])
  const { facts } = classify.build(
    [
      proc(30, 1, '/bin/zsh', '-zsh'),
      proc(31, 30, java, `${java} -classpath maven-wrapper.jar org.apache.maven.wrapper.MavenWrapperMain spring-boot:run`, 250 * MB),
      proc(32, 31, java, `${java} -cp target/classes com.shop.api.ShopApplication --spring.profiles.active=local`, 700 * MB),
    ],
    { ...context, cwd },
  )
  const project = facts.projects.get('shop-api')
  assert.equal(project.kind, 'Spring app')
  assert.equal(project.bytes, 950 * MB)
  assert.equal(project.detached, true)
})

test('does not flag a dev server started from a terminal app', () => {
  const cwd = new Map([[42, '/Users/me/Projects/shop-web']])
  const { facts } = classify.build(
    [
      proc(40, 1, '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'),
      proc(41, 40, '/bin/zsh', '-zsh'),
      proc(42, 41, '/opt/homebrew/bin/node', '/opt/homebrew/bin/node /Users/me/Projects/shop-web/node_modules/.bin/vite', 300 * MB),
    ],
    { ...context, cwd },
  )
  assert.equal(facts.projects.get('shop-web').kind, 'Vite dev server')
  assert.equal(facts.projects.get('shop-web').detached, false)
})

test('never puts a command line into a name', () => {
  const { groups } = classify.build([proc(50, 1, '/opt/homebrew/bin/node', '/opt/homebrew/bin/node /tmp/server.js --token=abc123')], context)
  const names = JSON.stringify(groups.map((group) => [group.name, [...group.parts.keys()]]))
  assert.ok(!names.includes('abc123'))
})
