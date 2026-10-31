const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const folders = ['bin', 'src', 'public', 'scripts', 'test']

const files = folders.flatMap((folder) => {
  const dir = path.join(root, folder)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(dir, name))
})

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
}

console.log(`${files.length} files pass the syntax check`)
