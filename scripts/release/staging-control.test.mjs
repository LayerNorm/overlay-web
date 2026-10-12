import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { STAGING, StagingController, revision, stagingBuildSettings, stagingDeploymentMatches, main } from './staging-control.mjs'

const sha = 'a'.repeat(40)
const nextSha = 'b'.repeat(40)
const deployment = (patch = {}) => ({ id: 'dpl_stage', projectId: STAGING.projectId,
  target: 'production', readyState: 'READY',
  gitSource: { type: 'github', repoId: STAGING.repositoryId, ref: 'main', sha },
  meta: { overlayReleaseLane: 'staging', overlayStagingSha: sha, overlayStagingBackend: STAGING.backend }, ...patch })

function fixture({ mainSha = sha, advanceAt = Infinity, buildState = 'READY',
  projectPatch = {}, deploymentPatch = {}, aliasMismatch = false, abandoned = false,
  lostCancel = false, lostRead = false, domainPatch = {} } = {}) {
  const calls = []
  let mainReads = 0
  let state = buildState
  const github = async (path, options = {}) => {
    calls.push({ service: 'github', path, ...options })
    if (path === `/repos/${STAGING.repository}`) return { id: STAGING.repositoryId, full_name: STAGING.repository }
    if (path.endsWith('/git/ref/heads/main')) {
      mainReads++
      return { ref: 'refs/heads/main', object: { type: 'commit', sha: mainReads >= advanceAt ? nextSha : mainSha } }
    }
    if (path.includes('/statuses/')) return {}
    throw new Error('Unexpected GitHub request ' + path)
  }
  const vercel = async (path, options = {}) => {
    calls.push({ service: 'vercel', path, ...options })
    if (path === `/v9/projects/${STAGING.projectId}`) return { id: STAGING.projectId, name: STAGING.projectName,
      accountId: STAGING.teamId, link: { type: 'github', repoId: STAGING.repositoryId,
        org: 'LayerNorm', repo: 'overlay-web', productionBranch: 'main' }, ...projectPatch }
    if (path.endsWith('/domains/' + STAGING.hostname)) {
      return { name: STAGING.hostname, verified: true, gitBranch: null, ...domainPatch }
    }
    if (path === '/v7/deployments') return { deployments: abandoned ? [{ uid: 'dpl_stage', state: 'BUILDING' }] : [] }
    if (path === '/v13/deployments' && options.method === 'POST') { state = buildState; return deployment({ readyState: state }) }
    if (path === '/v13/deployments/dpl_stage') {
      if (lostRead && state !== 'CANCELED') { state = 'CANCELED'; throw new Error('Lost build response') }
      return deployment({ readyState: state, ...deploymentPatch })
    }
    if (path === '/v12/deployments/dpl_stage/cancel') {
      state = 'CANCELED'
      if (lostCancel) throw new Error('Lost cancellation response')
      return {}
    }
    if (path === '/v2/deployments/dpl_stage/aliases') return {}
    if (path === '/v4/aliases/' + STAGING.hostname) return {
      projectId: STAGING.projectId, deployment: { id: aliasMismatch ? 'wrong' : 'dpl_stage' },
    }
    throw new Error('Unexpected Vercel request ' + path)
  }
  let now = 0
  return { calls, controller: new StagingController({ github, vercel, report: () => {},
    now: () => now, sleep: async ms => { now += ms } }) }
}

test('SHA validation permits no ref, shell fragment, URL, or shortened revision', () => {
  for (const value of ['', undefined, 'main', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(40) + '\n', 'a;echo bad']) {
    assert.throws(() => revision(value))
    assert.throws(() => stagingBuildSettings(value))
  }
  const settings = stagingBuildSettings(sha)
  assert.match(settings.buildCommand, /OVERLAY_STAGING_BUILD=trusted-main/)
  assert.match(settings.commandForIgnoringBuildStep, new RegExp(`OVERLAY_STAGING_BUILD_SHA=${sha} `))
})

test('staging provenance pins Divyansh project, accepted main SHA, production scope, and staging backend', () => {
  assert.equal(stagingDeploymentMatches(deployment(), sha, { ready: true }), true)
  for (const patch of [
    { projectId: 'another-project' }, { target: 'preview' }, { readyState: 'BUILDING' },
    { gitSource: { ...deployment().gitSource, sha: nextSha } },
    { gitSource: { ...deployment().gitSource, ref: 'staging' } },
    { gitSource: { ...deployment().gitSource, repoId: 1 } },
    { meta: {} }, { meta: { ...deployment().meta, overlayStagingBackend: 'colorful-chickadee-419' } },
    { meta: { ...deployment().meta, githubCommitSha: nextSha } },
  ]) assert.equal(stagingDeploymentMatches(deployment(patch), sha, { ready: true }), false)
})

test('preflight refuses another account, legacy branch, redirected or unverified domain before mutation', async () => {
  for (const options of [
    { projectPatch: { accountId: 'another-account' } },
    { projectPatch: { link: { productionBranch: 'staging' } } },
    { domainPatch: { verified: false } }, { domainPatch: { redirect: 'www.getoverlay.io' } },
    { domainPatch: { gitBranch: 'staging' } },
  ]) {
    const f = fixture(options)
    await assert.rejects(f.controller.run(sha))
    assert.equal(f.calls.some(c => c.method === 'POST' || c.method === 'PATCH'), false)
  }
})

test('a stale queued revision never starts a build or assigns staging', async () => {
  const f = fixture({ mainSha: nextSha })
  assert.deepEqual(await f.controller.run(sha), { state: 'superseded', sha })
  assert.equal(f.calls.some(c => c.method === 'POST'), false)
})

test('remote build and alias assignment use only the exact accepted SHA and verified staging project', async () => {
  const f = fixture()
  const result = await f.controller.run(sha)
  assert.deepEqual(result, { state: 'ready', sha, projectId: STAGING.projectId, deploymentId: 'dpl_stage',
    backend: STAGING.backend, backendUrl: STAGING.backendUrl, url: STAGING.origin, smoke: 'pending' })
  const build = f.calls.find(c => c.path === '/v13/deployments' && c.method === 'POST')
  assert.equal(build.body.autoAssignCustomDomains, false)
  assert.equal(build.body.project, STAGING.projectId)
  assert.equal(build.body.target, 'production')
  assert.equal(build.body.gitSource.sha, sha)
  const aliases = f.calls.filter(c => c.path.endsWith('/aliases') && c.method === 'POST')
  assert.deepEqual(aliases.map(c => c.body.alias), [STAGING.hostname])
  assert.equal(f.calls.filter(c => c.body?.state === 'success').length, 1)
})

test('an abandoned build is confirmed terminal before the new persistent-backend build starts', async () => {
  const f = fixture({ abandoned: true, buildState: 'BUILDING', advanceAt: 4 })
  await f.controller.run(sha)
  const cancel = f.calls.findIndex(c => c.path.endsWith('/cancel'))
  const start = f.calls.findIndex(c => c.path === '/v13/deployments' && c.method === 'POST')
  assert.ok(cancel >= 0 && cancel < start)
  assert.ok(f.calls.slice(cancel + 1, start).some(c => c.path === '/v13/deployments/dpl_stage'))
})

test('main advancing during a build cancels it without assigning an alias or publishing success', async () => {
  const f = fixture({ advanceAt: 3, buildState: 'BUILDING' })
  assert.deepEqual(await f.controller.run(sha), { state: 'superseded', sha })
  assert.ok(f.calls.some(c => c.path.endsWith('/cancel')))
  assert.equal(f.calls.some(c => c.path.endsWith('/aliases')), false)
  assert.equal(f.calls.some(c => c.body?.state === 'success'), false)
})

test('a lost cancellation response is reconciled once without repeating the mutation', async () => {
  const f = fixture({ advanceAt: 3, buildState: 'BUILDING', lostCancel: true })
  assert.equal((await f.controller.run(sha)).state, 'superseded')
  assert.equal(f.calls.filter(c => c.path.endsWith('/cancel')).length, 1)
})

test('main advancing before or during alias assignment cannot produce promotion evidence', async () => {
  for (const advanceAt of [4, 5]) {
    const f = fixture({ advanceAt })
    assert.equal((await f.controller.run(sha)).state, 'superseded')
    assert.equal(f.calls.some(c => c.body?.state === 'success'), false)
    if (advanceAt === 4) assert.equal(f.calls.some(c => c.path.endsWith('/aliases')), false)
  }
})

test('failed, untrusted, or wrongly assigned deployments never publish success', async () => {
  for (const options of [
    { buildState: 'ERROR' }, { aliasMismatch: true },
    { deploymentPatch: { projectId: 'another-project' } }, { lostRead: true },
  ]) {
    const f = fixture(options)
    await assert.rejects(f.controller.run(sha))
    assert.equal(f.calls.some(c => c.body?.state === 'success'), false)
  }
})

test('controller entry point refuses execution from other repositories or feature refs', async () => {
  await assert.rejects(main({ GITHUB_REPOSITORY: 'another/repository', GITHUB_REF: 'refs/heads/main' }))
  await assert.rejects(main({ GITHUB_REPOSITORY: STAGING.repository, GITHUB_REF: 'refs/heads/codex/example' }))
})

test('staging workflow remains gated, serialized and main-only with no package install around control secrets', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/staging-release.yml', import.meta.url), 'utf8'))
  assert.deepEqual(workflow.on.push.branches, ['main'])
  const job = workflow.jobs.deploy
  assert.match(job.if, /github.ref == 'refs\/heads\/main'/)
  assert.match(job.if, /vars.RELEASE_STAGING_FROM_MAIN == 'enabled'/)
  assert.equal(job.environment, 'release-control')
  assert.equal(job.concurrency['cancel-in-progress'], false)
  for (const step of job.steps) {
    if (step.uses?.startsWith('actions/checkout@')) {
      assert.equal(step.with.ref, '${{ github.sha }}')
      assert.equal(step.with['persist-credentials'], false)
    }
    if (step.run) assert.equal(step.run, 'node scripts/release/staging-control.mjs')
    if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/)
  }
  const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url)))
  assert.equal(vercel.git.deploymentEnabled.main, false)
})
