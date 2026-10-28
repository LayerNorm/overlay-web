import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import test from 'node:test'
import { buildPlan, deploymentEnvFile, runBuild, previewBuildEnvironment, previewQaFixtures, previewRuntimeEnvFile } from './vercel-build.mjs'

test('paid and Computer fixtures compose once and unknown fixtures fail before deployment', () => {
  assert.deepEqual(previewQaFixtures(' paid-workspace,computer-workspace,paid-workspace '), ['paid-workspace', 'computer-workspace'])
  const plan = buildPlan({ ...preview, OVERLAY_PREVIEW_QA_FIXTURES: 'paid-workspace,computer-workspace,exhausted-workspace' })
  assert.deepEqual(plan.after.map(step => step.args[1]), ['dev/seed:init', 'dev/seed:initQa', 'dev/seed:initComputerQa', 'dev/seed:initExhaustedQa'])
  for (const step of plan.after) assert.equal(step.args.at(-1), 'preview/pr-123')
  assert.throws(() => buildPlan({ ...preview, OVERLAY_PREVIEW_QA_FIXTURES: 'paid-workspace,typo' }), /Unknown Preview/)
})

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

test('native Git builds derive their canonical PR origin before branch provisioning', () => {
  for (const appUrl of [undefined, 'https://preview-unassigned.invalid']) {
    const plan = buildPlan({ ...preview, NEXT_PUBLIC_APP_URL: appUrl })
    assert.equal(plan.env.NEXT_PUBLIC_APP_URL, 'https://pr-123.preview.getoverlay.io')
  }
  assert.throws(() => buildPlan({ ...preview, NEXT_PUBLIC_APP_URL: 'https://pr-124.preview.getoverlay.io' }))
})

test('release builds cannot advertise a disabled provider as an enabled capability', () => {
  for (const [provider, feature] of [['INTEGRATIONS', 'INTEGRATIONS'],
    ['BROWSER', 'BROWSER_USE'], ['SANDBOX', 'SANDBOXES'], ['WEB_SEARCH', 'WEB_SEARCH']]) {
    const disabled = { ...preview, ['OVERLAY_PROVIDER_' + provider]: 'none' }
    assert.throws(() => buildPlan(disabled), /requires its feature flag/)
    assert.throws(() => buildPlan({ ...disabled, ['OVERLAY_FEATURE_' + feature]: 'true' }))
    assert.equal(buildPlan({ ...disabled, ['OVERLAY_FEATURE_' + feature]: 'false' }).target, 'preview pr-123')
  }
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
  assert.deepEqual(plan.after[0].args, ['run', 'dev/seed:init', '{}', '--deployment', 'preview/pr-123'])
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

test('paid QA fixtures require explicit preview opt-in and retain isolated targeting', () => {
  assert.equal(buildPlan(preview).after.length, 1)
  const env = { ...preview, OVERLAY_PREVIEW_QA_FIXTURES: 'paid-workspace' }
  const plan = buildPlan(env)
  assert.deepEqual(plan.after[1].args, ['run', 'dev/seed:initQa', '{}', '--deployment', 'preview/pr-123'])
  assert.equal(buildPlan({ VERCEL_ENV: 'production', OVERLAY_PREVIEW_QA_FIXTURES: 'paid-workspace' }).command, 'npm')
  const calls = []
  assert.equal(runBuild(env, (command, args) => {
    calls.push([...args])
    assert.ok(args.includes('--env-file'))
    return { status: 0 }
  }), 0)
  assert.equal(calls.length, 4)
  const failedCalls = []
  assert.equal(runBuild(env, (command, args) => {
    failedCalls.push([...args])
    return { status: 1 }
  }), 1)
  assert.equal(failedCalls.length, 1)
})

test('retired staging builds cannot deploy a shared backend', () => {
  assert.throws(() => buildPlan({ OVERLAY_RELEASE_LANE: 'staging', VERCEL_ENV: 'production',
    OVERLAY_DEPLOYMENT_ENV: 'staging', CONVEX_DEPLOY_KEY: 'prod:doting-cuttlefish-819|fixture' }), /Unsupported preview/)
})

test('preview rebuild repairs missing fixtures after deploy and never seeds a failed build', () => {
  for (const failAt of [0, 1, 2, 3]) {
    const calls = []
    const status = runBuild(preview, (command, args) => {
      calls.push({ command, args: [...args] })
      return { status: calls.length - 1 === failAt ? 1 : 0 }
    })
    assert.equal(status, failAt === 3 ? 0 : 1)
    assert.equal(calls.length, Math.min(failAt + 1, 3))
    if (calls[1]) {
      assert.deepEqual(calls[1].args.slice(0, 3), ['env', 'set', '--from-file'])
      assert.ok(calls[1].args.includes('--force'))
      assert.equal(calls[1].args[calls[1].args.indexOf('--deployment') + 1], 'preview/pr-123')
    }
    if (calls[2]) assert.deepEqual(calls[2].args.slice(0, 5), ['run', 'dev/seed:init', '{}', '--deployment', 'preview/pr-123'])
  }
})

test('runtime settings bind callbacks and transfer only approved backend credentials', () => {
  const text = previewRuntimeEnvFile({ ...preview, SESSION_SECRET: 'not-for-convex', PREVIEW_LOGIN_PASSWORD: 'private',
    INTERNAL_API_SECRET: 'api-secret', VERCEL_AUTOMATION_BYPASS_SECRET: 'hosting-secret',
    STRIPE_WEBHOOK_SECRET: 'owned-by-per-backend-registration' })
  assert.ok(text.includes('OVERLAY_BFF_URL="https://pr-123.preview.getoverlay.io"'))
  assert.ok(text.includes('VERCEL_AUTOMATION_BYPASS_SECRET="hosting-secret"'))
  assert.ok(text.includes('INTERNAL_API_SECRET="api-secret"'))
  assert.ok(!text.includes('SESSION_SECRET'))
  assert.ok(!text.includes('PREVIEW_LOGIN_PASSWORD'))
  assert.ok(!text.includes('STRIPE_WEBHOOK_SECRET'))
  assert.throws(() => previewRuntimeEnvFile({ ...preview, STRIPE_SECRET_KEY: 'sk_live_fixture' }), /Stripe test/)
})

test('billing previews provision their test endpoint after runtime settings and before seeding', () => {
  const calls = []
  assert.equal(runBuild({ ...preview, OVERLAY_FEATURE_BILLING: 'true', STRIPE_SECRET_KEY: 'sk_test_fixture' }, (command, args) => {
    calls.push({ command, args: [...args] })
    return { status: 0 }
  }), 0)
  assert.equal(calls[1].args[0], 'env')
  assert.equal(calls[2].command, 'node')
  assert.equal(calls[2].args[0], 'scripts/release/preview-payments-build.mjs')
  assert.ok(!existsSync(calls[2].args[1]))
  assert.equal(calls[3].args[1], 'dev/seed:init')
})


test('Git first-push lookup accepts only the exact open internal main PR', async () => {
  const env = { ...preview, VERCEL_GIT_PULL_REQUEST_ID: '', VERCEL_GIT_COMMIT_REF: 'codex/probe',
    VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) }
  const pr = { number: 219, state: 'open', base: { ref: 'main', repo: { full_name: 'LayerNorm/overlay-web' } },
    head: { ref: 'codex/probe', sha: 'a'.repeat(40), repo: { full_name: 'LayerNorm/overlay-web' } } }
  let time = 0, calls = 0
  const resolved = await previewBuildEnvironment(env, { now: () => time, sleep: async ms => { time += ms },
    fetchImpl: async (url, options) => {
      assert.equal(url.searchParams.get('head'), 'LayerNorm:codex/probe')
      assert.equal(options.headers.authorization, undefined)
      return { ok: true, json: async () => ++calls === 1 ? [] : [pr] }
    } })
  assert.equal(resolved.VERCEL_GIT_PULL_REQUEST_ID, '219')
  assert.equal(env.VERCEL_GIT_PULL_REQUEST_ID, '')
  for (const candidate of [{ ...pr, state: 'closed' }, { ...pr, base: { ...pr.base, ref: 'other' } },
    { ...pr, head: { ...pr.head, sha: 'b'.repeat(40) } },
    { ...pr, head: { ...pr.head, repo: { full_name: 'outside/fork' } } }]) {
    time = 0
    await assert.rejects(previewBuildEnvironment(env, { now: () => time, sleep: async ms => { time += ms },
      fetchImpl: async () => ({ ok: true, json: async () => [candidate] }) }), /Open a main PR/)
  }
  assert.equal(await previewBuildEnvironment(preview, { fetchImpl: () => { throw Error('unexpected lookup') } }), preview)
})

test('Computer QA fixtures require explicit isolated preview opt-in', () => {
  assert.equal(buildPlan(preview).after.length, 1)
  const plan = buildPlan({ ...preview, OVERLAY_PREVIEW_QA_FIXTURES: 'computer-workspace' })
  assert.deepEqual(plan.after[1].args, ['run', 'dev/seed:initComputerQa', '{}', '--deployment', 'preview/pr-123'])
  assert.equal(buildPlan({ VERCEL_ENV: 'production', OVERLAY_PREVIEW_QA_FIXTURES: 'computer-workspace' }).command, 'npm')
})
