import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { buildWebEnvironment, runHostedWebBuild } from './build-web.mjs'
import { existsSync, readFileSync, statSync } from 'node:fs'

test('auth settings are installed on only the claimed PR backend before build/upload', () => {
  const env = { OVERLAY_RELEASE_LANE: 'preview', VERCEL_ENV: 'preview', OVERLAY_DEPLOYMENT_ENV: 'preview',
    VERCEL_GIT_PULL_REQUEST_ID: '123', VERCEL_GIT_REPO_OWNER: 'LayerNorm', VERCEL_GIT_REPO_SLUG: 'overlay-web',
    NEXT_PUBLIC_CONVEX_URL: 'https://fixture.convex.cloud', WORKOS_CLIENT_ID: 'client_fixture',
    CONVEX_DEPLOY_KEY: 'preview:team:project|fixture-key' }
  for (const fail of [false, true]) {
    const calls = []
    let authFile
    let keyFile
    const result = runHostedWebBuild(env, (command, args) => {
      calls.push(command)
      if (command === 'npm') return { status: 0 }
      assert.equal(command, './node_modules/.bin/convex')
      assert.equal(args[args.indexOf('--deployment') + 1], 'preview/pr-123')
      authFile = args[args.indexOf('--from-file') + 1]
      keyFile = args[args.indexOf('--env-file') + 1]
      assert.equal(readFileSync(authFile, 'utf8'), 'OVERLAY_PROVIDER_AUTH="workos"\nWORKOS_CLIENT_ID="client_fixture"\n')
      assert.equal(statSync(keyFile).mode & 0o777, 0o600)
      assert.equal(statSync(authFile).mode & 0o777, 0o600)
      assert.ok(readFileSync(keyFile, 'utf8').includes(env.CONVEX_DEPLOY_KEY))
      return { status: fail ? 1 : 0 }
    })
    assert.equal(result, fail ? 1 : 0)
    assert.deepEqual(calls, fail ? ['./node_modules/.bin/convex'] : ['./node_modules/.bin/convex', 'npm'])
    assert.equal(existsSync(authFile), false)
    assert.equal(existsSync(keyFile), false)
  }
  const mustNotRun = () => { assert.fail('unsafe preflight') }
  assert.throws(() => runHostedWebBuild({ ...env, VERCEL_ENV: 'production' }, mustNotRun))
  assert.throws(() => runHostedWebBuild({ ...env, CONVEX_DEPLOY_KEY: 'prod:wrong|key' }, mustNotRun))
  assert.throws(() => runHostedWebBuild({ ...env, OVERLAY_PROVIDER_AUTH: 'oidc' }, mustNotRun))
})

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
