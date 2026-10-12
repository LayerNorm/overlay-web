import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, statSync } from 'node:fs'
import test from 'node:test'
import { buildPlan, deploymentEnvFile, runBuild } from './vercel-build.mjs'
import { STAGING } from './staging-control.mjs'

const preview = {
  OVERLAY_RELEASE_LANE: 'staging', VERCEL_ENV: 'preview',
  OVERLAY_DEPLOYMENT_ENV: 'preview', VERCEL_GIT_PULL_REQUEST_ID: '123',
  VERCEL_GIT_REPO_OWNER: 'LayerNorm', VERCEL_GIT_REPO_SLUG: 'overlay-web',
  NEXT_PUBLIC_APP_URL: 'https://pr-123.preview.getoverlay.io',
  CONVEX_DEPLOY_KEY: 'preview:team:project|fixture-key',
}

test('Convex explicit env file retains the approved key and is removed after spawn', () => {
  let path
  const status = runBuild({ ...preview, CONVEX_DEPLOYMENT: 'prod:wrong' }, (command, args) => {
    assert.equal(command, './node_modules/.bin/convex')
    path = args[args.indexOf('--env-file') + 1]
    assert.equal(readFileSync(path, 'utf8'), 'CONVEX_DEPLOY_KEY="' + preview.CONVEX_DEPLOY_KEY + '"\n')
    assert.equal(statSync(path).mode & 0o777, 0o600)
    return { status: 0 }
  })
  assert.equal(status, 0)
  assert.equal(existsSync(path), false)
  for (const key of ['', 'key\nCONVEX_DEPLOYMENT=prod:wrong', 'key"']) {
    assert.throws(() => deploymentEnvFile({ CONVEX_DEPLOY_KEY: key }))
  }
})

test('production builds never push Convex as part of the web build', () => {
  const plan = buildPlan({ VERCEL_ENV: 'production', CONVEX_DEPLOY_KEY: 'prod:wrong|key' })
  assert.equal(plan.command, 'npm')
  assert.deepEqual(plan.args, ['run', 'build'])
})

test('preview build isolates selectors and reuses only that PR backend', () => {
  const plan = buildPlan({ ...preview, CONVEX_DEPLOYMENT: 'prod:wrong',
    DEV_NEXT_PUBLIC_CONVEX_URL: 'https://shared.convex.cloud',
    CONVEX_SELF_HOSTED_URL: 'http://localhost:3210' })
  assert.equal(plan.env.CONVEX_DEPLOYMENT, undefined)
  assert.equal(plan.env.DEV_NEXT_PUBLIC_CONVEX_URL, undefined)
  assert.equal(plan.env.CONVEX_SELF_HOSTED_URL, undefined)
  assert.equal(plan.env.CONVEX_PREVIEW, '1')
  assert.ok(plan.args.includes('--preview-name'))
  assert.ok(plan.args.includes('pr-123'))
  assert.ok(!plan.args.includes('--preview-create'))
})

test('a preview cannot deploy with a production key, shared origin, or missing PR', () => {
  for (const patch of [
    { CONVEX_DEPLOY_KEY: 'prod:colorful-chickadee-419|key' },
    { CONVEX_DEPLOY_KEY: 'preview:a-specific-deployment|key' },
    { NEXT_PUBLIC_APP_URL: 'https://staging.getoverlay.io' },
    { VERCEL_GIT_PULL_REQUEST_ID: '' },
    { OVERLAY_DEPLOYMENT_ENV: 'staging' },
    { VERCEL_GIT_REPO_OWNER: 'outside' }, { VERCEL_GIT_REPO_SLUG: 'fork' },
  ]) assert.throws(() => buildPlan({ ...preview, ...patch }))
})

test('staging refuses a production backend or mismatched key', () => {
  const staging = { OVERLAY_RELEASE_LANE: 'staging', VERCEL_ENV: 'production',
    OVERLAY_DEPLOYMENT_ENV: 'staging', OVERLAY_STAGING_CONVEX_DEPLOYMENT: STAGING.backend,
    CONVEX_DEPLOY_KEY: 'prod:' + STAGING.backend + '|fixture',
    OVERLAY_STAGING_BUILD: 'trusted-main', OVERLAY_STAGING_BUILD_SHA: 'a'.repeat(40),
    VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    VERCEL_GIT_REPO_OWNER: 'LayerNorm', VERCEL_GIT_REPO_SLUG: 'overlay-web', NEXT_PUBLIC_APP_URL: STAGING.origin }
  assert.equal(buildPlan(staging).target, 'staging ' + STAGING.backend)
  assert.throws(() => buildPlan({ ...staging, CONVEX_DEPLOY_KEY: 'prod:wrong|key' }))
  assert.throws(() => buildPlan({ ...staging,
    OVERLAY_STAGING_CONVEX_DEPLOYMENT: 'colorful-chickadee-419',
    CONVEX_DEPLOY_KEY: 'prod:colorful-chickadee-419|key' }))
  for (const patch of [
    { OVERLAY_STAGING_BUILD: undefined }, { OVERLAY_STAGING_BUILD_SHA: '' },
    { VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) }, { VERCEL_GIT_COMMIT_REF: 'staging' },
    { VERCEL_GIT_REPO_OWNER: 'another-account' }, { VERCEL_GIT_REPO_SLUG: 'another-repository' },
    { NEXT_PUBLIC_APP_URL: 'https://www.getoverlay.io' },
    { OVERLAY_STAGING_CONVEX_DEPLOYMENT: 'arbitrary-backend', CONVEX_DEPLOY_KEY: 'prod:arbitrary-backend|key' },
  ]) assert.throws(() => buildPlan({ ...staging, ...patch }))
})

test('trusted staging deploys backend, then seed, then web; failure stops subsequent steps', () => {
  const env = { OVERLAY_RELEASE_LANE: 'staging', VERCEL_ENV: 'production',
    OVERLAY_DEPLOYMENT_ENV: 'staging', OVERLAY_STAGING_CONVEX_DEPLOYMENT: STAGING.backend,
    CONVEX_DEPLOY_KEY: 'prod:' + STAGING.backend + '|fixture',
    OVERLAY_STAGING_BUILD: 'trusted-main', OVERLAY_STAGING_BUILD_SHA: 'a'.repeat(40),
    VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    VERCEL_GIT_REPO_OWNER: 'LayerNorm', VERCEL_GIT_REPO_SLUG: 'overlay-web', NEXT_PUBLIC_APP_URL: STAGING.origin }
  for (const failAt of [0, 1, 2, 3]) {
    const calls = []
    const result = runBuild(env, (command, args, options) => {
      calls.push({ command, args: [...args] })
      assert.equal(options.env.NEXT_PUBLIC_CONVEX_URL, `https://${STAGING.backend}.convex.cloud`)
      if (command.includes('convex')) {
        const path = args[args.indexOf('--env-file') + 1]
        assert.equal(readFileSync(path, 'utf8'), deploymentEnvFile(env))
      }
      return { status: calls.length - 1 === failAt ? 1 : 0 }
    })
    assert.equal(result, failAt === 3 ? 0 : 1)
    assert.equal(calls.length, Math.min(failAt + 1, 3))
    assert.equal(calls[0].args[0], 'deploy')
    assert.ok(!calls[0].args.includes('--cmd'))
    if (calls[1]) assert.deepEqual(calls[1].args.slice(0, 3), ['run', 'dev/seed:initStaging', '{}'])
    if (calls[2]) assert.deepEqual(calls[2], { command: 'node', args: ['scripts/release/build-web.mjs'] })
  }
})

test('dedicated staging ignore guard rejects manual, hook, other-ref and wrong-SHA builds', () => {
  const script = fileURLToPath(new URL('../vercel-ignore-build.sh', import.meta.url))
  const staging = { ...preview, DEPLOY_BRANCH: 'main', VERCEL_ENV: 'production',
    OVERLAY_DEPLOYMENT_ENV: 'staging', NEXT_PUBLIC_APP_URL: STAGING.origin,
    OVERLAY_STAGING_BUILD: 'trusted-main', OVERLAY_STAGING_BUILD_SHA: 'a'.repeat(40),
    VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) }
  const exit = patch => spawnSync('bash', [script], { env: { PATH: process.env.PATH, ...staging, ...patch } }).status
  assert.equal(exit({}), 1)
  for (const patch of [
    { OVERLAY_STAGING_BUILD: '' }, { OVERLAY_STAGING_BUILD_SHA: 'a;evil' },
    { VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) }, { VERCEL_GIT_COMMIT_REF: '' },
    { VERCEL_GIT_COMMIT_REF: 'staging' }, { VERCEL_GIT_COMMIT_REF: 'codex/feature' },
    { VERCEL_GIT_REPO_OWNER: 'another-account' }, { VERCEL_ENV: 'preview' },
    { NEXT_PUBLIC_APP_URL: 'https://www.getoverlay.io' },
  ]) assert.equal(exit(patch), 0)
})

test('ignored-build gate runs only provisioned PRs in the staging project', () => {
  const script = fileURLToPath(new URL('../vercel-ignore-build.sh', import.meta.url))
  function exit(patch) {
    return spawnSync('bash', [script], { env: { PATH: process.env.PATH,
      ...preview, PREVIEW_BUILDS: 'pr', DEPLOY_BRANCH: 'staging',
      VERCEL_GIT_COMMIT_REF: 'codex/example', ...patch } }).status
  }
  assert.equal(exit({}), 1)
  for (const patch of [
    { OVERLAY_RELEASE_LANE: 'production' }, { PREVIEW_BUILDS: '' },
    { VERCEL_GIT_PULL_REQUEST_ID: '' }, { VERCEL_GIT_PULL_REQUEST_ID: 'abc' },
    { NEXT_PUBLIC_APP_URL: 'https://staging.getoverlay.io' }, { DEPLOY_BRANCH: '' },
    { VERCEL_GIT_REPO_OWNER: 'outside' }, { VERCEL_GIT_REPO_SLUG: 'fork' },
  ]) assert.equal(exit(patch), 0)
  assert.equal(exit({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'staging' }), 1)
  assert.equal(exit({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: '' }), 0)
})
