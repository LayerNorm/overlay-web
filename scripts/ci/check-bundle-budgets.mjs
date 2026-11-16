import { readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measureRoute, readOption } from './bundle-measurements.mjs'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '../..')

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

const distDir = path.resolve(projectRoot, readOption(process.argv, '--dist-dir', '.next'))
const requireAnalyzer = process.argv.includes('--require-analyzer')
const budgets = await readJson(path.join(scriptDir, 'bundle-budgets.json'))
const manifestPath = path.join(distDir, 'analyze/entrypoints.json')
await requireFile(manifestPath, 'Webpack entrypoint manifest (run npm run build or npm run analyze)')
if (requireAnalyzer) {
  await requireFile(path.join(distDir, 'analyze', 'client.html'), 'Client bundle analyzer report')
}

const manifest = await readJson(manifestPath)
const failures = []

for (const [route, budget] of Object.entries(budgets)) {
  const measurements = await measureRoute(distDir, manifest, route)

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
