import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'native-artifacts.json'), 'utf8'))
const failures = []

for (const artifact of manifest.artifacts ?? []) {
  const absolute = path.join(root, artifact.path)
  if (!fs.existsSync(absolute)) {
    // A fetched artifact is not in the repository; its build script checks the
    // same pins when it downloads it, and the packaged app is checked again.
    if (artifact.fetched) verifyRecord(artifact)
    else failures.push(`missing native artifact ${artifact.path}`)
    continue
  }
  const digest = hashFile(absolute)
  if (digest !== artifact.sha256) {
    failures.push(`${artifact.path} hash changed: expected ${artifact.sha256}, got ${digest}`)
  }
  verifyRecord(artifact)

  if (process.platform === 'darwin') {
    const description = execFileSync('/usr/bin/file', [absolute], { encoding: 'utf8' })
    if (!description.includes('Mach-O') || !description.includes(artifact.architecture)) {
      failures.push(`${artifact.path} is not a ${artifact.architecture} Mach-O executable`)
    }
    const strings = execFileSync('/usr/bin/strings', [absolute], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })
    if (hasPrivatePath(strings, artifact.upstreamBuildPaths)) {
      failures.push(`${artifact.path} contains a private workstation path`)
    }
  }
}

const parakeetDigest = hashSourceTree('ParakeetServer', [
  'Package.swift',
  'Package.resolved',
  'Sources'
])
const parakeet = manifest.artifacts.find((entry) => entry.path === 'parakeet-bundle/parakeet-cli')
if (parakeet?.sourceRevision !== parakeetDigest) {
  failures.push(
    `Parakeet source digest changed: expected ${parakeet?.sourceRevision}, got ${parakeetDigest}`
  )
}

const axHelper = manifest.artifacts.find((entry) => entry.path === 'resources/ax-helper')
const axSourceDigest = hashFile(path.join(root, 'ax-helper/ax-helper.swift'))
if (axHelper?.sourceRevision !== axSourceDigest) {
  failures.push(
    `AX helper source digest changed: expected ${axHelper?.sourceRevision}, got ${axSourceDigest}`
  )
}

if (failures.length) {
  console.error(`Native artifact verification failed:\n${failures.map((item) => `- ${item}`).join('\n')}`)
  process.exit(1)
}

console.log(`Verified ${manifest.artifacts.length} pinned arm64 native artifacts and source records.`)

function verifyRecord(artifact) {
  const license = path.join(root, artifact.licenseFile)
  if (!fs.existsSync(license)) failures.push(`${artifact.path} is missing ${artifact.licenseFile}`)
  const buildScript = fs.readFileSync(path.join(root, artifact.buildScript), 'utf8')
  if (artifact.source.startsWith('https://') && !buildScript.includes(artifact.sourceRevision)) {
    failures.push(`${artifact.buildScript} does not pin ${artifact.sourceRevision}`)
  }
  if (artifact.upstreamRevision && !buildScript.includes(artifact.upstreamRevision)) {
    failures.push(`${artifact.buildScript} does not pin upstream ${artifact.upstreamRevision}`)
  }
}

/** Paths from the upstream project's own build machine are public and listed per artifact. */
function hasPrivatePath(strings, upstreamBuildPaths = []) {
  return strings
    .split('\n')
    .filter((line) => /\/Users\/|\/var\/folders\//.test(line))
    .some((line) => !upstreamBuildPaths.some((prefix) => line.includes(prefix)))
}

function hashFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function hashSourceTree(relativeRoot, entries) {
  const sourceRoot = path.join(root, relativeRoot)
  const files = entries
    .flatMap((entry) => walk(path.join(sourceRoot, entry)))
    .sort((left, right) => left.localeCompare(right))
  const listing = files
    .map((file) => `${hashFile(file)}  ${path.relative(sourceRoot, file)}\n`)
    .join('')
  return createHash('sha256').update(listing).digest('hex')
}

function walk(target) {
  const stat = fs.statSync(target)
  if (stat.isFile()) return [target]
  return fs.readdirSync(target).flatMap((entry) => walk(path.join(target, entry)))
}
