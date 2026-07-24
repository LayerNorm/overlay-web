import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destinationArg = process.argv[2]

if (!destinationArg || !path.isAbsolute(destinationArg)) {
  fail('usage: npm run public:export -- /absolute/path/to/empty/export-directory')
}

const destination = path.resolve(destinationArg)
if (destination === root || root.startsWith(`${destination}${path.sep}`)) {
  fail('export destination must not be the source repository or its parent')
}
if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0) {
  fail(`export destination is not empty: ${destination}`)
}

const status = git(['status', '--porcelain'])
if (status.trim()) {
  fail('source repository is dirty; commit and verify the exact export source first')
}

fs.mkdirSync(destination, { recursive: true, mode: 0o700 })
const archive = path.join(
  os.tmpdir(),
  `overlay-desktop-public-${process.pid}-${Date.now()}.tar`
)

try {
  run('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD'], root)
  run('tar', ['-xf', archive, '-C', destination], root)
  run(process.execPath, [path.join(destination, 'scripts/check-public-tree.mjs')], destination)
  run(
    process.execPath,
    [path.join(destination, 'scripts/check-public-source-secrets.mjs')],
    destination
  )
  console.log(`Created history-free public export from ${git(['rev-parse', 'HEAD']).trim()}`)
  console.log(destination)
} finally {
  fs.rmSync(archive, { force: true })
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) fail(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed`)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
