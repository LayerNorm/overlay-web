import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { CONFIG } from './preview-control.mjs'
import { PreviewFixtureRecovery, recoveryInput, main } from './preview-recovery.mjs'

const sha = 'a'.repeat(40)
const input = { number: 123, fixture: 'paid-workspace', availableCents: 1000, requestId: 'qa-acceptance' }
function fixture({ closed = false, unlabeled = false, stale = false, backendPatch = {}, authPatch = {}, moved = false } = {}) {
  let reads = 0; const calls = []
  const backend = { name: 'fixture-preview-123', deploymentType: 'preview', projectId: CONFIG.convexProjectId,
    reference: 'preview/pr-123', previewIdentifier: 'pr-123', ...backendPatch }
  const pr = { number: 123, state: closed ? 'closed' : 'open', labels: unlabeled ? [] : [{name: 'needs-preview'}],
    base: {ref: 'main', repo: {full_name: CONFIG.repository}},
    head: {sha, ref: 'codex/fixture', repo: {id: CONFIG.repositoryId, full_name: CONFIG.repository}} }
  const controller = new PreviewFixtureRecovery({
    github: async () => { reads++; return moved && reads > 1 ? {...pr, head: {...pr.head, sha: 'b'.repeat(40)}} : pr },
    vercel: async path => path.startsWith('/v4/') ? {projectId: CONFIG.projectId, deployment: {id: 'dpl_fixture'}}
      : {projectId: CONFIG.projectId, target: null, readyState: 'READY', gitSource: {type: 'github',
        repoId: CONFIG.repositoryId, ref: pr.head.ref, sha: stale ? 'b'.repeat(40) : sha}},
    backends: {find: async () => backend},
    authorize: async () => ({deploymentName: backend.name, deploymentType: 'preview',
      url: `https://${backend.name}.convex.cloud`, adminKey: 'private-test-admin', ...authPatch}),
    invoke: async (auth, args) => {calls.push({auth, args}); return {applied: true, secret: 'must-not-be-printed'}},
  })
  return {controller, calls}
}

test('recovers only a ready owned fixture and prints no remote secrets', async () => {
  const f = fixture()
  const result = await f.controller.run(input)
  assert.deepEqual(result, {number: 123, fixture: 'paid-workspace', applied: true})
  assert.deepEqual(f.calls[0].args, {fixture: input.fixture, requestId: input.requestId, availableCents: 1000})
  assert.ok(!JSON.stringify(result).includes('private-test-admin'))
  assert.ok(!JSON.stringify(result).includes('must-not-be-printed'))
})

for (const [name, options] of [
  ['closed', {closed: true}], ['unlabeled', {unlabeled: true}], ['stale web', {stale: true}],
  ['production backend', {backendPatch: {name: CONFIG.convexProductionName}}],
  ['foreign project', {backendPatch: {projectId: 1}}], ['foreign PR', {backendPatch: {reference: 'preview/pr-999'}}],
  ['production authorization', {authPatch: {deploymentType: 'prod'}}],
  ['redirect authorization', {authPatch: {url: 'https://evil.example'}}], ['changed PR', {moved: true}],
]) {
  test(`rejects ${name} before any fixture mutation`, async () => {
    const f = fixture(options)
    await assert.rejects(f.controller.run(input))
    assert.equal(f.calls.length, 0)
  })
}

test('bounds synthetic credits and refuses credit on free quota recovery', () => {
  for (const patch of [{availableCents: 5001}, {availableCents: -1}, {availableCents: 1.5},
    {fixture: 'personal'}, {fixture: 'unknown'}, {requestId: ''}]) assert.throws(() => recoveryInput({...input, ...patch}))
  assert.deepEqual(recoveryInput({...input, fixture: 'personal', availableCents: undefined}),
    {number: 123, fixture: 'personal', requestId: 'qa-acceptance'})
})

test('rejects broad keys and untrusted workflow revisions before network access', async () => {
  const env = {GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: CONFIG.repository,
    CONVEX_PREVIEW_CONTROL_KEY: 'prod:customer|bad'}
  const noFetch = async () => assert.fail('No credential request may be sent')
  await assert.rejects(main(env, noFetch), /pinned Overlay project Preview key/)
  await assert.rejects(main({...env, GITHUB_REF: 'refs/heads/feature'}, noFetch), /trusted main/)
})

test('manual recovery keeps secrets on trusted main without checking out PR code', () => {
  const source = readFileSync(new URL('../../.github/workflows/preview-qa-recovery.yml', import.meta.url), 'utf8')
  assert.match(source, /workflow_dispatch:/)
  assert.match(source, /github\.ref == 'refs\/heads\/main'/)
  assert.match(source, /environment: release-control/)
  assert.match(source, /group: pr-preview-recovery-/)
  assert.match(source, /ref: main/)
  assert.match(source, /persist-credentials: false/)
  assert.doesNotMatch(source, /pull_request_target:|pull_request:|workflow_run:/)
  assert.doesNotMatch(source, /checkout[^\n]*\$\{\{\s*inputs|npm ci|convex deploy/)
})

test('the trusted HTTP path authorizes only the pinned Preview and invokes only fixture recovery', async () => {
  const f = fixture()
  const pr = await f.controller.github()
  const key = `${CONFIG.convexPreviewKeyScope}|fixture-key`
  const calls = []
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue)
    const body = options.body && JSON.parse(options.body)
    calls.push({url: url.href, method: options.method, body})
    assert.equal(options.redirect, 'error')
    if (url.hostname === 'api.github.com') return Response.json(pr)
    if (url.hostname === 'api.vercel.com') {
      assert.equal(url.searchParams.get('teamId'), CONFIG.teamId)
      return Response.json(await f.controller.vercel(url.pathname))
    }
    if (url.pathname.endsWith('/list_deployments')) return Response.json([await f.controller.backends.find()])
    if (url.pathname === '/api/deployment/authorize_preview') {
      assert.equal(options.headers.authorization, `Bearer ${key}`)
      assert.match(options.headers['Convex-Client'], /^npm-cli-\d+\.\d+\.\d+$/)
      assert.deepEqual(body, {previewName: 'pr-123', projectSelection: {kind: 'teamAndProjectSlugs',
        teamSlug: 'divyansh-lalwani-37bb7', projectSlug: 'overlay'}})
      return Response.json(await f.controller.authorize())
    }
    assert.equal(url.href, 'https://fixture-preview-123.convex.cloud/api/function')
    assert.equal(options.headers.authorization, 'Convex private-test-admin')
    assert.deepEqual(body, {path: 'dev/qa:recover', format: 'convex_encoded_json',
      args: {fixture: 'paid-workspace', requestId: 'gha-456', availableCents: 1000}})
    return Response.json({status: 'success', value: {applied: true, secret: 'never-emit'}, logLines: ['never-emit']})
  }
  const result = await main({GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: CONFIG.repository,
    GITHUB_TOKEN: 'github-fixture', VERCEL_PREVIEW_TOKEN: 'vercel-fixture', CONVEX_PREVIEW_CONTROL_KEY: key,
    PR_NUMBER: '123', QA_FIXTURE: 'paid-workspace', GITHUB_RUN_ID: '456'}, fetchImpl)
  assert.deepEqual(result, {number: 123, fixture: 'paid-workspace', applied: true})
  assert.equal(calls.filter(c => c.method === 'POST').length, 2)
})
