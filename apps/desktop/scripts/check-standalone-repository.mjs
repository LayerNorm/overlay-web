import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const manifest = readJson('package.json')
const expectedPackages = new Set(
  fs
    .readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `@overlay/${entry.name.replace(/^overlay-/, '')}`)
)

for (const packageName of expectedPackages) {
  const version =
    manifest.dependencies?.[packageName] ?? manifest.devDependencies?.[packageName]
  if (version !== '0.0.1') {
    failures.push(`root manifest must consume ${packageName} at exact version 0.0.1`)
  }
}

for (const directory of fs.readdirSync(path.join(root, 'packages'))) {
  const packageRoot = path.join(root, 'packages', directory)
  if (!fs.statSync(packageRoot).isDirectory()) continue
  const packageManifest = readJson(`packages/${directory}/package.json`)
  if (packageManifest.version !== '0.0.1') {
    failures.push(`packages/${directory} must use exact version 0.0.1`)
  }
  const dependencyEntries = Object.entries({
    ...packageManifest.dependencies,
    ...packageManifest.devDependencies,
    ...packageManifest.peerDependencies
  })
  for (const [name, version] of dependencyEntries) {
    if (name.startsWith('@overlay/') && version !== '0.0.1') {
      failures.push(`${packageManifest.name} must reference ${name} at exact version 0.0.1`)
    }
    if (typeof version === 'string' && version.startsWith('file:')) {
      failures.push(`${packageManifest.name} contains forbidden file dependency ${name}`)
    }
  }
  for (const sourceFile of walk(packageRoot).filter((file) => /\.[cm]?[jt]sx?$/.test(file))) {
    const source = fs.readFileSync(sourceFile, 'utf8')
    const importPattern = /(?:from\s+|import\s*\()\s*['"](\.[^'"]+)['"]/g
    for (const match of source.matchAll(importPattern)) {
      const resolved = path.resolve(path.dirname(sourceFile), match[1])
      if (resolved !== packageRoot && !resolved.startsWith(`${packageRoot}${path.sep}`)) {
        failures.push(
          `${path.relative(root, sourceFile)} imports outside its publishable package: ${match[1]}`
        )
      }
    }
  }
}

for (const relative of [
  'package.json',
  'package-lock.json',
  'electron.vite.config.ts',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'tailwind.config.js'
]) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  for (const forbidden of ['../packages/', '../scripts/', '../convex/', "resolve('../public')"]) {
    if (source.includes(forbidden)) failures.push(`${relative} contains parent checkout coupling: ${forbidden}`)
  }
}

for (const required of [
  'public/assets/file-icons/microsoft-excel.svg',
  'public/assets/file-icons/microsoft-powerpoint.svg',
  'public/assets/file-icons/microsoft-word.svg',
  'public/assets/file-icons/pdf.svg',
  'public/assets/icons/dashed-chat.png'
]) {
  if (!fs.existsSync(path.join(root, required))) failures.push(`missing standalone asset ${required}`)
}

if (failures.length) {
  console.error(`Standalone repository check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  process.exit(1)
}

console.log(`Standalone repository check passed for ${expectedPackages.size} versioned packages.`)

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute)
    return entry.isFile() ? [absolute] : []
  })
}
