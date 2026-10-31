const os = require('os')
const path = require('path')

const HOME = os.homedir()
const APP_ID = 'mac-dashboard'
const LABEL = 'io.github.devkazonovic.mac-dashboard'
const HOST = '127.0.0.1'
const DEFAULT_PORT = 3738
const STATE_DIR = path.join(HOME, 'Library', 'Application Support', APP_ID)
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const LOG_DIR = path.join(HOME, 'Library', 'Logs', APP_ID)
const LOG_FILE = path.join(LOG_DIR, 'dashboard.log')
const AGENT_FILE = path.join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`)
const BIN = path.join(__dirname, '..', 'bin', 'mac-dashboard.js')
const PROJECT_DIRS = ['Projects', 'Developer', 'Code', 'dev', 'src', 'workspace', 'repos', 'git'].map((name) => path.join(HOME, name))

function home(file) {
  return file.startsWith(HOME) ? `~${file.slice(HOME.length)}` : file
}

module.exports = { HOME, APP_ID, LABEL, HOST, DEFAULT_PORT, STATE_DIR, STATE_FILE, LOG_DIR, LOG_FILE, AGENT_FILE, BIN, PROJECT_DIRS, home }
