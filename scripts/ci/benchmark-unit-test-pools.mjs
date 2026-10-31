#!/usr/bin/env node
// Opt-in experiment: compare isolated Vitest pools, never change the CI default.
// Run with the same Node version/dependency tree as CI. Results remain in tmpdir.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism, loadavg, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--pairs')) {
  throw new Error('Usage: node scripts/ci/benchmark-unit-test-pools.mjs [--pairs 5]')
}
const pairs = args.length ? Number(args[1]) : 5
assert.ok(Number.isSafeInteger(pairs) && pairs >= 1 && pairs <= 20, 'Choose 1–20 pairs')
const directory = mkdtempSync(path.join(tmpdir(), 'overlay-unit-pools-'))
console.log(`Private benchmark output: ${directory}`)
const inventory = spawnSync(process.execPath, ['scripts/ci/run-all-tests.mjs', '--only', 'vitest:unit', '--list'], {
  cwd: root, encoding: 'utf8', timeout: 30_000,
})
assert.equal(inventory.status, 0, inventory.error?.message ?? `${inventory.stdout}\n${inventory.stderr}`)
const files = inventory.stdout.split('\n').filter(line => line.startsWith('  ')).map(line => line.trim())
assert.ok(files.length > 0 && files.every(file => file.endsWith('.test.ts')), 'Expected nonempty unit Vitest inventory')
const workers = Math.max(1, availableParallelism() - 1)
const env = {
  ...process.env,
  NEXT_PUBLIC_CONVEX_URL: 'https://fixture.convex.cloud',
  INTERNAL_API_SECRET: 'test-internal-secret',
  NEXT_TELEMETRY_DISABLED: '1',
}
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
assert.equal(revision.status, 0, 'Cannot record the benchmark revision')
const metadata = {
  node: process.version, platform: process.platform, arch: process.arch,
  revision: revision.stdout.trim(),
  vitest: JSON.parse(readFileSync(path.join(root, 'node_modules/vitest/package.json'), 'utf8')).version,
}
const rows = []
let expected
for (let pair = 0; pair < pairs; pair++) {
  for (const pool of pair % 2 ? ['threads', 'forks'] : ['forks', 'threads']) {
    const output = path.join(directory, `${pair}-${pool}.json`)
    const start = performance.now()
    const run = spawnSync(process.execPath, [
      'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.unit.config.mts',
      `--pool=${pool}`, '--isolate', `--maxWorkers=${workers}`, '--reporter=json',
      `--outputFile=${output}`, '--sequence.shuffle.files', `--sequence.seed=${104729 + pair}`, ...files,
    ], { cwd: root, env, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024, timeout: 120_000 })
    writeFileSync(`${output}.log`, `${run.stdout ?? ''}\n${run.stderr ?? ''}`)
    assert.equal(run.status, 0, run.error?.message ?? `Pool ${pool} failed; inspect ${output}.log`)
    const report = JSON.parse(readFileSync(output, 'utf8'))
    const counts = {
      files: report.testResults?.length, tests: report.numTotalTests,
      passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests,
    }
    assert.equal(counts.files, files.length, 'Every discovered file must execute')
    assert.deepEqual(report.testResults.map(result => path.relative(root, result.name)).sort(), [...files].sort(), 'Execution must match discovery exactly')
    assert.ok(Number.isSafeInteger(counts.tests) && counts.tests > 0, 'Zero tests is not a benchmark')
    assert.equal(counts.failed, 0)
    expected ??= counts
    assert.deepEqual(counts, expected, 'Pool/order changes must preserve test results')
    const row = { pair, pool, seconds: (performance.now() - start) / 1000, workers, ...counts, load: loadavg() }
    rows.push(row)
    writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ ...metadata, rows }, null, 2))
    console.log(JSON.stringify(row))
  }
}
console.log('Behavior parity passed. Compare cold/warm runs and machine load before interpreting timings; repeat on the CI runner.')
