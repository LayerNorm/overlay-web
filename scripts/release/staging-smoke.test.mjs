import assert from 'node:assert/strict'
import test from 'node:test'
import { smokeCandidate, runSmoke } from './staging-smoke.mjs'
import { STAGING } from './staging-control.mjs'
const sha = 'a'.repeat(40)
const candidate = { state: 'ready', sha, projectId: STAGING.projectId, backend: STAGING.backend,
  backendUrl: STAGING.backendUrl, url: STAGING.origin, deploymentId: 'dpl_fixture' }
test('staging smoke accepts only exact ready deployment provenance', () => {
  assert.equal(smokeCandidate(candidate, sha), candidate)
  for (const patch of [{ state: 'superseded' }, { sha: 'b'.repeat(40) }, { projectId: 'production' },
    { backend: 'colorful-chickadee-419' }, { backendUrl: 'https://different-caiman-77.convex.cloud' },
    { url: 'https://getoverlay.io' }, { deploymentId: 'https://outside.example' }]) {
    assert.throws(() => smokeCandidate({ ...candidate, ...patch }, sha))
  }
  assert.throws(() => smokeCandidate(candidate, 'main'))
})
test('smoke refuses other refs or identities before browser or service access', async () => {
  for (const env of [{}, { GITHUB_REPOSITORY: STAGING.repository, GITHUB_REF: 'refs/heads/main',
    STAGING_SMOKE_EMAIL: 'other@example.com', STAGING_SMOKE_PASSWORD: 'fixture' }]) {
    await assert.rejects(runSmoke({ env, launch: () => { throw new Error('Browser must not launch') } }), /synthetic staging identity/)
  }
})

const env = { GITHUB_REPOSITORY: STAGING.repository, GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: sha, GITHUB_RUN_ID: '123', STAGING_SMOKE_EMAIL: 'overlay-preview-qa@getoverlay.io',
  STAGING_SMOKE_PASSWORD: 'private-test-fixture' }
function smokeFixture({ wrongIdentity = false, chatFailure = false, staleFailure = false,
  deploymentId = candidate.deploymentId, workspaceId = 'staging-personal-user_01M4R1EKTMDZ4E6BQ5DMZXD0F2', badWorkspace = false } = {}) {
  const calls = [], saved = [], reports = []
  const response = (status, body = {}) => ({ status: () => status, json: async () => body })
  const context = { request: {
    post: async (path, options) => {
      calls.push({ path, method: 'POST', options })
      if (path === '/api/auth/sign-in') return response(200, { success: true,
        user: { id: wrongIdentity ? 'other-user' : 'user_01M4R1EKTMDZ4E6BQ5DMZXD0F2' } })
      if (path === '/api/v1/workspaces/active') return response(200, { activeWorkspaceId: workspaceId })
      return response(200, { id: path === '/api/v1/conversations' ? 'chat_probe' : 'note_probe' })
    },
    get: async path => {
      calls.push({ path, method: 'GET' })
      if (path === '/api/v1/workspaces') return response(200, { workspaces: badWorkspace ? []
        : [{ id: workspaceId, kind: 'personal', role: 'owner', status: 'active' }] })
      if (path.includes('noteId=')) return response(200, { updatedAt: 1,
        content: calls.some(c => c.method === 'PATCH') ? 'Accepted smoke edit' : 'Before smoke edit' })
      return response(200, { data: [{ _id: 'note_fixture', title: 'Staging note' }] })
    },
    patch: async (path, options) => {
      calls.push({ path, method: 'PATCH', options })
      return response(options.data.content === 'Stale smoke edit' && !staleFailure ? 409 : 200)
    },
    delete: async path => { calls.push({ path, method: 'DELETE' }); return response(200) },
  }, newPage: async () => ({
    on: () => {},
    reload: async () => { calls.push({ reload: true }) },
    locator: selector => {
      assert.equal(selector, '[data-overlay-chat-id="chat_probe"][data-overlay-chat-hydrated="true"]')
      return { waitFor: async () => { calls.push({ appHydrated: true }) } }
    },
    waitForResponse: async predicate => {
      assert.equal(predicate({ url: () => STAGING.origin + '/api/v1/conversations?conversationId=other&messages=true' }), false)
      assert.equal(predicate({ url: () => STAGING.origin + '/api/v1/conversations?conversationId=chat_probe&messages=true' }), true)
      return { status: () => 200, finished: async () => { calls.push({ transcriptReady: true }) } }
    },
    goto: async url => { calls.push({ navigation: url }) },
    getByRole: role => role === 'main' ? { getByRole: () => ({ waitFor: async () => {} }) } : role === 'combobox'
      ? { waitFor: async () => {}, count: async () => 1, fill: async () => {} }
      : { waitFor: async () => {}, getAttribute: async () => 'true', click: async () => { calls.push({ sendMessage: role === 'button', chatMode: role === 'tab' }) } },
    getByText: text => ({ count: async () => 0, nth: () => ({ waitFor: async () => {
      if (text === 'RELEASE_SMOKE_OK' && chatFailure) throw new Error('Provider failed private-test-fixture')
    } }), waitFor: async () => {
      if (text === 'RELEASE_SMOKE_OK' && chatFailure) throw new Error('Provider failed private-test-fixture')
    } }),
    screenshot: async options => { calls.push({ screenshot: options.path }) },
  }) }
  const github = async (path, options) => {
    if (options) { calls.push({ status: options.body.state }); return {} }
    return path.endsWith('/main') ? { ref: 'refs/heads/main', object: { type: 'commit', sha } }
      : { id: STAGING.repositoryId, full_name: STAGING.repository }
  }
  const vercel = async path => {
    if (path === `/v9/projects/${STAGING.projectId}`) return { id: STAGING.projectId,
      name: STAGING.projectName, accountId: STAGING.teamId, link: { type: 'github',
        repoId: STAGING.repositoryId, org: 'LayerNorm', repo: 'overlay-web', productionBranch: 'main' } }
    if (path.includes('/domains/')) return { name: STAGING.hostname, verified: true }
    if (path.includes('/deployments/')) return { projectId: STAGING.projectId, target: 'production', readyState: 'READY',
      gitSource: { type: 'github', repoId: STAGING.repositoryId, ref: 'main', sha },
      meta: { overlayReleaseLane: 'staging', overlayStagingSha: sha, overlayStagingBackend: STAGING.backend } }
    return { projectId: STAGING.projectId, deployment: { id: deploymentId } }
  }
  return { env, github, vercel, artifact: candidate, calls, saved, reports, probeRealtime: async args => { calls.push({ realtimeWorkspaceId: args.workspaceId }) },
    launch: async () => { calls.push({ launch: true }); return { newContext: async () => context,
      close: async () => { calls.push({ closed: true }) } } },
    saveEvidence: e => saved.push(e), report: e => reports.push(e) }
}
test('authenticated smoke performs normal sign-in, note conflict/cleanup and chat before saving proof', async () => {
  const f = smokeFixture(), result = await runSmoke(f)
  assert.equal(result.smoke, 'passed')
  assert.ok(Object.values(result.checks).every(value => value === true))
  assert.equal(f.saved.length, 1)
  assert.equal(f.calls.filter(c => c.path === '/api/auth/sign-in').length, 1)
  assert.equal(f.calls.some(c => c.path?.includes('preview-login')), false)
  assert.ok(f.calls.some(c => c.method === 'DELETE'))
  assert.ok(f.calls.some(c => c.sendMessage))
  assert.ok(f.calls.findIndex(c => c.transcriptReady) < f.calls.findIndex(c => c.appHydrated))
  assert.ok(f.calls.findIndex(c => c.appHydrated) < f.calls.findIndex(c => c.sendMessage))
  assert.ok(f.calls.some(c => c.reload))
  assert.ok(f.calls.some(c => c.navigation === '/app/w/staging-personal-user_01M4R1EKTMDZ4E6BQ5DMZXD0F2/chat?id=chat_probe'))
  assert.equal(f.calls.at(-1).closed, true)
  assert.ok(!JSON.stringify(f.reports).includes(env.STAGING_SMOKE_PASSWORD))
})
test('failed identity, conflict or provider response cannot create promotion proof', async () => {
  for (const option of [{ wrongIdentity: true }, { staleFailure: true }, { chatFailure: true }, { badWorkspace: true }]) {
    const f = smokeFixture(option)
    await assert.rejects(runSmoke(f))
    assert.equal(f.saved.length, 0)
    assert.ok(f.calls.some(c => c.status === 'failure'))
    assert.equal(f.calls.at(-1).closed, true)
    assert.ok(!JSON.stringify(f.reports).includes(env.STAGING_SMOKE_PASSWORD))
    if (!option.wrongIdentity && !option.badWorkspace) assert.ok(f.calls.some(c => c.method === 'DELETE'))
  }
})
test('a changed canonical alias refuses smoke before sending credentials', async () => {
  const f = smokeFixture({ deploymentId: 'dpl_other' })
  await assert.rejects(runSmoke(f), /alias changed/)
  assert.equal(f.calls.some(c => c.launch), false)
  assert.equal(f.saved.length, 0)
})


test('candidate smoke uses a reused personal workspace for chat, files and realtime', async () => {
  const workspaceId = 'reused-personal-workspace'
  const f = smokeFixture({ workspaceId }), result = await runSmoke(f)
  assert.equal(result.workspaceId, workspaceId)
  assert.ok(f.calls.some(c => c.navigation === '/app/w/' + workspaceId + '/chat?id=chat_probe'))
  assert.ok(f.calls.some(c => c.navigation === '/app/w/' + workspaceId + '/files'))
  assert.ok(f.calls.some(c => c.realtimeWorkspaceId === workspaceId))
  assert.ok(f.calls.some(c => c.path === '/api/v1/workspaces/active' && c.options.data.workspaceId === workspaceId))
  assert.ok(f.calls.some(c => c.method === 'DELETE' && c.path.includes('conversationId=chat_probe')))
  assert.ok(result.checks.chatCleanup)
})
