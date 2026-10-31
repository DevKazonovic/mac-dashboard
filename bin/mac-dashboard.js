#!/usr/bin/env node
const { start } = require('../src/server')
const commands = require('../src/commands')
const { DEFAULT_PORT } = require('../src/paths')
const { version } = require('../package.json')

const COMMANDS = ['start', 'stop', 'restart', 'status', 'enable', 'disable', 'update']

const HELP = `Usage: mac-dashboard [command] [options]

Opens a local web page that tells you whether your Mac is fine, what is
using its memory, processor and disk, and what needs your attention.

Commands:
  (none)                   Run in this terminal. Closing it stops the dashboard.
  start                    Run in the background, so you can close the terminal.
  stop                     Stop the dashboard.
  restart                  Stop it and start it again, for example after an update.
  status                   Show whether the dashboard is running, and where.
  enable                   Start it now and every time you log in.
  disable                  Stop starting it at login, and stop it now.
  update                   Install the newest version from GitHub.

Options:
  -p, --port <number>      Port to listen on (default ${DEFAULT_PORT})
  --projects-dir <path>    Also look for Flutter build folders here. Repeat it
                           for several folders. ~/Projects, ~/Developer, ~/Code
                           and similar folders are found automatically.
  --no-open                Do not open the browser
  --demo                   Show made-up data, to try the page or take screenshots
  -v, --version            Show the version
  -h, --help               Show this help`

function parseArgs(argv) {
  const options = { command: null, port: DEFAULT_PORT, open: true, demo: false, projectDirs: [], stateFile: null, help: false, version: false, error: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '-v' || arg === '--version') options.version = true
    else if (arg === '--no-open') options.open = false
    else if (arg === '--demo') options.demo = true
    else if (arg === '-p' || arg === '--port') options.port = Number(argv[++i])
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice('--port='.length))
    else if (arg === '--projects-dir') {
      const value = argv[++i]
      if (!value || value.startsWith('-')) options.error = 'The --projects-dir option needs a folder path.'
      else options.projectDirs.push(value)
    }
    else if (arg.startsWith('--projects-dir=')) options.projectDirs.push(arg.slice('--projects-dir='.length))
    else if (arg === '--state-file' && argv[i + 1]) options.stateFile = argv[++i]
    else if (!arg.startsWith('-') && !options.command && COMMANDS.includes(arg)) options.command = arg
    else options.error = arg.startsWith('-') ? `Unknown option: ${arg}` : `Unknown command: ${arg}`
  }
  if (!options.error && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) {
    options.error = 'The port must be a whole number between 1 and 65535.'
  }
  return options
}

const options = parseArgs(process.argv.slice(2))

if (options.help) {
  console.log(HELP)
  process.exit(0)
}

if (options.version) {
  console.log(version)
  process.exit(0)
}

if (options.error) {
  console.error(`${options.error}\n\n${HELP}`)
  process.exit(1)
}

if (process.platform !== 'darwin') {
  console.error('mac-dashboard only runs on macOS.')
  process.exit(1)
}

const run = options.command ? commands[options.command] : (opts) => start({ ...opts, foreground: true })

run(options).catch((error) => {
  console.error(error.message)
  process.exit(1)
})
