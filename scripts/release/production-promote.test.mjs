import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { canonicalMain, promote } from './production-promote.mjs'
import { PRODUCTION, promotionEvidence, productionCredentials, productionDeploymentMatches } from './production-control.mjs'
import { STAGING } from './staging-control.mjs'
import { SMOKE_CHECKS } from './staging-publish.mjs'

const sha = 'a'.repeat(40)
const env = { PRODUCTION_SMOKE_EMAIL: 'overlay-release-qa@getoverlay.io', PRODUCTION_SMOKE_PASSWORD: 'fixture-only',
  PRODUCTION_SMOKE_USER_ID: 'user_productionQA', CONVEX_PRODUCTION_DEPLOY_KEY: 'prod:colorful-chickadee-419|fixture-only' }
const evidence = { state: 'ready', sha, projectId: STAGING.projectId, backend: STAGING.backend,
  backendUrl: STAGING.backendUrl, url: STAGING.origin, deploymentId: 'dpl_stage', smoke: 'passed', runId: '123',
  checks: Object.fromEntries(SMOKE_CHECKS.map(name => [name, true])) }
const run = { id: 123, head_sha: sha, head_branch: 'main', repository: { id: PRODUCTION.repositoryId },
  status: 'completed', conclusion: 'success', event: 'push', path: '.github/workflows/staging-release.yml' }
const job = { name: 'deploy', status: 'completed', conclusion: 'success',
  steps: [{ name: 'Verify authenticated staging behavior', conclusion: 'success' }] }
const deployment = { id: 'dpl_prod', projectId: PRODUCTION.projectId, target: 'production', readyState: 'READY',
  url: 'release-proof.vercel.app', meta: { overlayReleaseLane: 'production', overlayReleaseSha: sha,
    overlayConvexBackend: PRODUCTION.backend, githubCommitSha: sha, githubCommitRef: 'main' } }

test('promotion requires every smoke check and its successful trusted producer', () => {
  assert.equal(promotionEvidence(evidence, sha, run, job), evidence)
  for (const name of SMOKE_CHECKS) assert.throws(() => promotionEvidence({ ...evidence,
    checks: { ...evidence.checks, [name]: false } }, sha, run, job))
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'feature' }, { event: 'pull_request' },
    { path: 'other.yml' }, { repository: { id: 0 } }, { conclusion: 'failure' }, { id: 999 }]) {
    assert.throws(() => promotionEvidence(evidence, sha, { ...run, ...patch }, job))
  }
  assert.throws(() => promotionEvidence({ ...evidence, published: false }, sha, run, job))
  assert.throws(() => promotionEvidence({ ...evidence, published: true }, sha, run, job))
  assert.equal(promotionEvidence({ ...evidence, published: true }, sha, run, { ...job,
    steps: [...job.steps, { name: 'Verify canonical staging after cutover', conclusion: 'success' }] }).published, true)
})

test('production credentials cannot target staging, shared dev or its sandbox identity', () => {
  productionCredentials(env)
  for (const patch of [{ CONVEX_PRODUCTION_DEPLOY_KEY: 'prod:doting-cuttlefish-819|fixture' },
    { CONVEX_PRODUCTION_DEPLOY_KEY: 'dev:different-caiman-77|fixture' },
    { CONVEX_PRODUCTION_DEPLOY_KEY: 'prod:colorful-chickadee-419|a\nb' },
    { PRODUCTION_SMOKE_EMAIL: 'customer@example.com' },
    { PRODUCTION_SMOKE_USER_ID: 'user_01M4R1EKTMDZ4E6BQ5DMZXD0F2' }, { PRODUCTION_SMOKE_PASSWORD: '' }]) {
    assert.throws(() => productionCredentials({ ...env, ...patch }))
  }
})

test('production provenance requires the exact ready revision, lane, project and backend', () => {
  assert.ok(productionDeploymentMatches(deployment, sha))
  for (const patch of [{ projectId: STAGING.projectId }, { target: 'preview' }, { readyState: 'BUILDING' },
    { url: 'outside.example.com' }, { meta: { ...deployment.meta, githubCommitSha: 'b'.repeat(40) } },
    { meta: { ...deployment.meta, overlayConvexBackend: STAGING.backend } }]) {
    assert.equal(productionDeploymentMatches({ ...deployment, ...patch }, sha), false)
  }
})

function fixture({ fail = '', wrongOwner = false, webNotLive = false } = {}) {
  const calls = [], states = []
  let live = 'dpl_previous'
  const project = { id: PRODUCTION.projectId, name: PRODUCTION.projectName, accountId: PRODUCTION.teamId,
    link: { type: 'github', repoId: PRODUCTION.repositoryId, org: 'LayerNorm', repo: 'overlay-web', productionBranch: 'main' } }
  const github = async path => path === '/user' ? { login: wrongOwner ? 'other' : 'DevelopedByDev' }
    : { object: { sha } }
  const vercel = async path => {
    if (path === '/v2/user') return { user: { username: 'developedbydev1' } }
    if (path.startsWith('/v9/projects/')) return project
    if (path.endsWith(STAGING.hostname)) return { projectId: STAGING.projectId, deployment: { id: 'dpl_stage' } }
    if (path.endsWith(PRODUCTION.hostname)) return { projectId: PRODUCTION.projectId, deployment: { id: live } }
    if (path.endsWith('dpl_stage')) return { id: 'dpl_stage', projectId: STAGING.projectId, target: 'production', readyState: 'READY',
      gitSource: { type: 'github', repoId: STAGING.repositoryId, ref: 'main', sha },
      meta: { overlayReleaseLane: 'staging', overlayStagingSha: sha, overlayStagingBackend: STAGING.backend } }
    return deployment
  }
  const step = name => { calls.push(name); if (fail === name) throw new Error('private fixture error') }
  return { sha, env, github, vercel, calls, states,
    verifyCheckout: () => step('checkout'), acceptStaging: async () => { step('staging'); return evidence },
    buildWeb: async () => { step('build'); return deployment },
    publishWeb: async () => { step('publish'); if (!webNotLive) live = deployment.id },
    pushBackend: async () => step('backend'), smoke: async () => { step('smoke'); return {
      authenticatedIdentity: true, noteCrudAndStaleEdit: true, realChatReplyAndPersistence: true,
      filesUi: true, realtimeAuthorization: true } }, record: state => states.push(state) }
}

test('promotion publishes and verifies web before deploying backend and running smoke', async () => {
  const f = fixture(), result = await promote(f)
  assert.equal(result.state, 'verified')
  assert.deepEqual(f.calls.filter(c => c !== 'checkout'), ['staging', 'build', 'publish', 'backend', 'smoke'])
  assert.equal(result.previousDeploymentId, 'dpl_previous')
  assert.deepEqual(f.states.map(s => s.state), ['accepted', 'web-built', 'web-live', 'web-and-backend-live', 'verified'])
  assert.ok(!JSON.stringify(f.states).includes('fixture-only'))
})
test('preflight writes no deployment or backend changes', async () => {
  const f = fixture(), result = await promote({ ...f, checkOnly: true })
  assert.equal(result.state, 'preflight-passed')
  assert.deepEqual(f.calls, ['checkout', 'staging'])
})
test('failed checkout, owner, staging, web publication or backend stops later actions', async () => {
  for (const opts of [{ fail: 'checkout' }, { wrongOwner: true }, { fail: 'staging' }, { fail: 'build' },
    { fail: 'publish' }, { webNotLive: true }, { fail: 'backend' }, { fail: 'smoke' }]) {
    const f = fixture(opts)
    await assert.rejects(promote(f), /Production promotion failed/)
    assert.equal(f.states.at(-1).state, 'failed')
    assert.ok(!JSON.stringify(f.states).includes('private fixture error'))
    if (opts.fail !== 'backend' && opts.fail !== 'smoke') assert.ok(!f.calls.includes('backend'))
    if (opts.fail !== 'smoke') assert.ok(!f.calls.includes('smoke'))
  }
})
test('canonical checkout guard requires clean current main and the fixed production link', () => {
  const root = mkdtempSync(join(tmpdir(), 'promotion-test-'))
  try {
    mkdirSync(join(root, '.git')); mkdirSync(join(root, '.vercel'))
    writeFileSync(join(root, '.vercel/project.json'), JSON.stringify({ projectId: PRODUCTION.projectId, orgId: PRODUCTION.teamId }))
    writeFileSync(join(root, 'vercel.json'), JSON.stringify({ git: { deploymentEnabled: { main: false } } }))
    const answers = { 'rev-parse --show-toplevel': root, 'rev-parse --path-format=absolute --git-common-dir': join(root, '.git'),
      'branch --show-current': 'main', 'status --porcelain': '', 'rev-parse HEAD': sha,
      'remote get-url origin': 'https://github.com/LayerNorm/overlay-web.git', 'fetch origin main': '', 'rev-parse origin/main': sha }
    const invoke = patch => canonicalMain(sha, { cwd: root, run: (_, args) => ({ ...answers, ...patch })[args.join(' ')] })
    assert.equal(invoke({}), realpathSync(root))
    for (const patch of [{ 'branch --show-current': 'codex/feature' }, { 'status --porcelain': ' M user.txt' },
      { 'rev-parse origin/main': 'b'.repeat(40) }, { 'remote get-url origin': 'https://github.com/other/repo.git' }]) {
      assert.throws(() => invoke(patch))
    }
    writeFileSync(join(root, '.vercel/project.json'), JSON.stringify({ projectId: STAGING.projectId, orgId: PRODUCTION.teamId }))
    assert.throws(() => invoke({}))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
