import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { buildWebEnvironment } from './build-web.mjs'

const base = { NEXT_PUBLIC_CONVEX_URL: 'https://fixture.convex.cloud', OVERLAY_DEPLOYMENT_ENV: 'preview' }
test('hosted web retains its injected isolated backend and diagnostics default off', () => {
  const env = buildWebEnvironment({ ...base, NODE_OPTIONS: '--conditions=react-server' })
  assert.equal(env.NEXT_PUBLIC_CONVEX_SITE_URL, 'https://fixture.convex.site')
  assert.equal(env.NEXT_PUBLIC_OVERLAY_DEPLOYMENT_ENV, 'preview')
  assert.equal(env.NODE_OPTIONS, '--conditions=react-server')
  for (const url of ['http://fixture.convex.cloud', 'https://convex.cloud.attacker.invalid', '']) {
    assert.throws(() => buildWebEnvironment({ ...base, NEXT_PUBLIC_CONVEX_URL: url }))
  }
})
test('resource diagnostics run in a real child, preserve node options and disclose no environment values', () => {
  const env = buildWebEnvironment({ ...process.env, ...base, OVERLAY_BUILD_DIAGNOSTICS: '1',
    NODE_OPTIONS: '--conditions=react-server', PRIVATE_DIAGNOSTIC_SENTINEL: 'never-print-this-value' })
  assert.ok(env.NODE_OPTIONS.startsWith('--conditions=react-server --import='))
  const result = spawnSync(process.execPath, ['-e', 'void 0'], { env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  const reports = result.stderr.trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(reports.map(report => report.phase), ['start', 'exit'])
  assert.ok(reports.every(report => report.event === 'build-resource-usage' && report.heapLimitMiB > 0 && report.rssMiB > 0))
  assert.equal(result.stderr.includes('never-print-this-value'), false)
  assert.equal(result.stderr.includes('PRIVATE_DIAGNOSTIC_SENTINEL'), false)
})


test('diagnostics preserve TypeScript showConfig machine-readable stdout', () => {
  const env = buildWebEnvironment({ ...process.env, ...base, OVERLAY_BUILD_DIAGNOSTICS: '1' })
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--showConfig', '--project', 'tsconfig.json'], { env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(JSON.parse(result.stdout).compilerOptions)
  assert.ok(result.stderr.includes('build-resource-usage'))
})
