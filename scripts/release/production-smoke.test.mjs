import assert from 'node:assert/strict'
import test from 'node:test'
import { productionSmoke } from './production-smoke.mjs'
import { PRODUCTION } from './production-control.mjs'

const sha = 'a'.repeat(40)
function fixture({ badLogin = false, badConflict = false, badChat = false, badCleanup = false } = {}) {
  const calls = [], reports = []
  const env = { PRODUCTION_SMOKE_EMAIL: 'overlay-release-qa@getoverlay.io',
    PRODUCTION_SMOKE_PASSWORD: 'private-fixture', PRODUCTION_SMOKE_USER_ID: 'user_productionQA' }
  const deployment = { id: 'dpl_prod', projectId: PRODUCTION.projectId, target: 'production', readyState: 'READY',
    url: 'proof.vercel.app', meta: { overlayReleaseLane: 'production', overlayReleaseSha: sha,
      overlayConvexBackend: PRODUCTION.backend, githubCommitSha: sha, githubCommitRef: 'main' } }
  const response = (status, body = {}) => ({ status: () => status, json: async () => body })
  let edited = false
  const page = { on: () => {}, goto: async url => calls.push(url), reload: async () => calls.push('reload'),
    locator: () => ({ waitFor: async () => {}, count: async () => 1, fill: async () => {} }),
    getByRole: () => ({ click: async () => calls.push('send') }),
    getByText: text => ({ count: async () => 0, nth: () => ({ waitFor: async () => {
      if (text === 'RELEASE_SMOKE_OK' && badChat) throw new Error('private-fixture browser error')
    } }), waitFor: async () => {
      if (text === 'RELEASE_SMOKE_OK' && badChat) throw new Error('private-fixture browser error')
    } }), screenshot: async ({ path }) => calls.push(path) }
  const context = { newPage: async () => page, request: {
    post: async path => { calls.push(path); return path === '/api/auth/sign-in'
      ? response(200, { user: { id: badLogin ? 'user_other' : env.PRODUCTION_SMOKE_USER_ID } })
      : response(200, { id: 'note_probe' }) },
    get: async path => {
      if (path.includes('noteId=')) return response(200, { updatedAt: 1, content: edited ? 'Accepted smoke edit' : 'Before smoke edit' })
      if (path === '/api/auth/convex-token') return response(200, { token: 'fixture.token.value' })
      return response(200, { data: [] })
    },
    patch: async (_, options) => { edited = true; return response(options.data.content === 'Stale smoke edit'
      && !badConflict ? 409 : 200) },
    delete: async () => { calls.push('cleanup'); return response(badCleanup ? 500 : 200) },
  } }
  const vercel = async path => path.startsWith('/v9/') ? { id: PRODUCTION.projectId, name: PRODUCTION.projectName,
    accountId: PRODUCTION.teamId, link: { type: 'github', repoId: PRODUCTION.repositoryId,
      org: 'LayerNorm', repo: 'overlay-web', productionBranch: 'main' } }
    : path.startsWith('/v4/') ? { projectId: PRODUCTION.projectId, deployment: { id: 'dpl_prod' } } : deployment
  return { calls, reports, env, sha, deployment, vercel, evidenceDirectory: '/ignored/proof',
    probeRealtime: async args => { assert.equal(args.userId, env.PRODUCTION_SMOKE_USER_ID); calls.push('realtime') },
    launch: async () => ({ newContext: async options => {
      assert.deepEqual(options.extraHTTPHeaders, { origin: PRODUCTION.origin }); return context
    }, close: async () => calls.push('close') }), report: message => reports.push(message) }
}
test('production smoke uses normal auth, checks persisted chat and cleans only its own temporary note', async () => {
  const f = fixture(), result = await productionSmoke(f)
  assert.ok(Object.values(result).every(value => value === true))
  for (const action of ['send', 'reload', 'realtime', 'cleanup']) assert.ok(f.calls.includes(action))
  assert.ok(f.calls.includes('/ignored/proof/production-smoke-files.png'))
  assert.equal(f.calls.at(-1), 'close')
  assert.ok(!JSON.stringify(f.reports).includes('private-fixture'))
})
test('production failures never yield success and still close browser and clean created notes', async () => {
  for (const option of [{ badLogin: true }, { badConflict: true }, { badChat: true }, { badCleanup: true }]) {
    const f = fixture(option)
    await assert.rejects(productionSmoke(f))
    if (!option.badLogin) assert.ok(f.calls.includes('cleanup'))
    assert.equal(f.calls.at(-1), 'close')
    assert.ok(!JSON.stringify(f.reports).includes('private-fixture'))
  }
})
test('production smoke refuses a sandbox identity or unpublished web before sending credentials', async () => {
  for (const option of ['identity', 'alias']) {
    const f = fixture()
    if (option === 'identity') f.env.PRODUCTION_SMOKE_USER_ID = 'user_01M4R1EKTMDZ4E6BQ5DMZXD0F2'
    else f.vercel = async path => path.startsWith('/v4/') ? { projectId: PRODUCTION.projectId,
      deployment: { id: 'dpl_other' } } : fixture().vercel(path)
    await assert.rejects(productionSmoke(f))
    assert.equal(f.calls.length, 0)
  }
})
