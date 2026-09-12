import { readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { getJsPageSizeInKb } = require('next/dist/build/utils')
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')

function readOption(name, fallback) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function requireFile(filePath, label) {
  try {
    await access(filePath)
  } catch {
    throw new Error(`${label} not found at ${path.relative(projectRoot, filePath)}`)
  }
}

const distDir = path.resolve(projectRoot, readOption('--dist-dir', '.next'))
const requireAnalyzer = process.argv.includes('--require-analyzer')
const budgets = await readJson(path.join(scriptDir, 'bundle-budgets.json'))
const buildManifestPath = path.join(distDir, 'build-manifest.json')
const appBuildManifestPath = path.join(distDir, 'app-build-manifest.json')

await requireFile(buildManifestPath, 'Next build manifest')
await requireFile(appBuildManifestPath, 'Next app build manifest')
if (requireAnalyzer) {
  await requireFile(path.join(distDir, 'analyze', 'client.html'), 'Client bundle analyzer report')
}

const buildManifest = await readJson(buildManifestPath)
const appBuildManifest = await readJson(appBuildManifestPath)
const failures = []

for (const [route, budget] of Object.entries(budgets)) {
  const [routeGzipBytes, firstLoadGzipBytes] = await getJsPageSizeInKb(
    'app',
    route,
    distDir,
    buildManifest,
    structuredClone(appBuildManifest),
    true,
  )
  const [routeRawBytes, firstLoadRawBytes] = await getJsPageSizeInKb(
    'app',
    route,
    distDir,
    buildManifest,
    structuredClone(appBuildManifest),
    false,
  )
  const measurements = {
    routeGzipBytes,
    firstLoadGzipBytes,
    routeRawBytes,
    firstLoadRawBytes,
  }

  console.log(`Bundle budget: ${route}`)
  for (const [metric, limit] of Object.entries(budget)) {
    const actual = measurements[metric]
    const passed = actual >= 0 && actual <= limit
    console.log(`  ${metric}: ${formatBytes(actual)} / ${formatBytes(limit)} ${passed ? 'OK' : 'OVER'}`)
    if (!passed) failures.push(`${route} ${metric}: ${actual} > ${limit}`)
  }
}

if (failures.length > 0) {
  console.error('\nBundle budget failures:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
}
