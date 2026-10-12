import assert from 'node:assert/strict'
import test from 'node:test'
import { CONFIG, PreviewController, PreviewBackends, ApiError, apiClient, deploymentMatches, previewAddress, trustedPull } from './preview-control.mjs'

const sha = 'a'.repeat(40)
function pull(patch = {}) {
  return { number: 123, state: 'open', base: { ref: 'main', repo: { full_name: CONFIG.repository } },
    head: { ref: 'codex/fixture', sha, repo: { id: CONFIG.repositoryId, full_name: CONFIG.repository } }, ...patch }
}
function deployment(patch = {}) {
  return { id: 'dpl_fixture', projectId: CONFIG.projectId, target: null, readyState: 'READY',
    gitSource: { type: 'github', repoId: CONFIG.repositoryId, ref: 'codex/fixture', sha }, ...patch }
}
function fixture({ current = pull(), existing = true, backendActive = true, changeHead = false, failReadback = false,
  failHttps = false, failRemoved = false, buildState = 'READY', cancelError = false, cancelFinishes = true, wildcardBranch = CONFIG.previewWildcardBranch, wildcardAlias = false } = {}) {
  const calls = []
  let envs = []; let domain; let alias; let reads = 0; let state = buildState
  const github = async (path, options = {}) => {
    calls.push({ service: 'github', path, ...options })
    if (path.endsWith('/pulls/123')) {
      reads++
      return changeHead && reads > 1 ? pull({ head: { ...current.head, sha: 'b'.repeat(40) } }) : current
    }
    if (path.endsWith('/pulls')) return [current]
    if (path.includes('/statuses/')) return {}
    throw new Error('Unexpected GitHub request: ' + path)
  }
  const vercel = async (path, options = {}) => {
    calls.push({ service: 'vercel', path, ...options })
    const method = options.method ?? 'GET'
    if (path === `/v9/projects/${CONFIG.projectId}`) return { id: CONFIG.projectId, name: CONFIG.projectName,
      link: { type: 'github', repoId: CONFIG.repositoryId, org: 'LayerNorm', repo: 'overlay-web' } }
    if (path === `/v9/projects/${CONFIG.projectId}/domains/${CONFIG.previewWildcardDomain}`) {
      return { name: CONFIG.previewWildcardDomain, verified: true, gitBranch: wildcardBranch }
    }
    if (path === `/v4/aliases/${CONFIG.previewWildcardDomain}`) {
      if (wildcardAlias) return { projectId: CONFIG.projectId }
      throw new ApiError('Vercel', 404)
    }
    if (path.endsWith('/env')) {
      if (method === 'POST') { envs = [{ ...options.body, id: 'env_fixture' }]; return envs[0] }
      return { envs }
    }
    if (path.endsWith('/env/env_fixture') && method === 'DELETE') { envs = []; return {} }
    if (path.endsWith('/domains')) {
      if (method === 'POST') { domain = { ...options.body, verified: true }; return domain }
      return { domains: domain ? [domain] : [], pagination: { next: null } }
    }
    if (path.includes('/domains/pr-123.')) {
      if (method === 'DELETE') { domain = undefined; return {} }
      if (!domain) throw new ApiError('Vercel', 404)
      return domain
    }
    if (path === '/v7/deployments') return { deployments: existing ? [{ uid: 'dpl_fixture', state: 'READY' }] : [] }
    if (path === '/v13/deployments' || path === '/v13/deployments/dpl_fixture') return deployment({ readyState: state })
    if (path === '/v12/deployments/dpl_fixture/cancel') {
      if (cancelFinishes) state = 'CANCELED'
      if (cancelError) throw new Error('Lost cancellation response')
      return deployment({ readyState: state })
    }
    if (path === '/v2/deployments/dpl_fixture/aliases') { alias = { uid: 'alias_fixture', projectId: CONFIG.projectId,
      deployment: { id: failReadback ? 'dpl_wrong' : 'dpl_fixture' } }; return {} }
    if (path.startsWith('/v4/aliases/')) { if (!alias) throw new ApiError('Vercel', 404); return alias }
    if (path === '/v2/aliases/alias_fixture' && method === 'DELETE') { alias = undefined; return {} }
    throw new Error('Unexpected Vercel request: ' + method + ' ' + path)
  }
  const controller = new PreviewController({ github, vercel, report: () => {}, sleep: async () => {},
    backends: { active: async () => backendActive, renew: async () => ({ name: 'fixture-backend', expiresAt: 123 }) },
    verifyRemoved: async origin => {
      calls.push({ service: 'removed-https', origin })
      if (failRemoved) throw new Error('Closed preview hostname must return 404')
    },
    verifyHttps: async origin => {
      calls.push({ service: 'https', origin })
      if (failHttps) throw new Error('TLS verification failed')
    } })
  return { controller, calls, get: () => ({ envs, domain, alias }), setCurrent: pr => { current = pr },
    setEnv: values => { envs = values }, setDomain: value => { domain = value } }
}

test('PR identifiers cannot become API paths, hostnames, or shell fragments', () => {
  for (const value of ['', 0, -1, '1/../../', '1;evil', '001', '1\n', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => previewAddress(value))
  }
  assert.equal(previewAddress(123).origin, 'https://pr-123.preview.getoverlay.io')
})
test('forks, another repository, main as a source, and other bases cannot receive preview secrets', () => {
  assert.equal(trustedPull(pull()).number, 123)
  assert.throws(() => trustedPull(pull({ head: { ...pull().head, repo: { id: 1, full_name: 'outside/fork' } } })))
  assert.throws(() => trustedPull(pull({ base: { ...pull().base, ref: 'staging' } })))
  assert.throws(() => trustedPull(pull({ head: { ...pull().head, ref: 'main' } })))
  assert.throws(() => trustedPull(pull({ head: { ...pull().head, ref: CONFIG.previewWildcardBranch } })))
})
test('deployment provenance requires project, repository, branch, SHA, preview target, and READY', () => {
  assert.equal(deploymentMatches(deployment(), pull(), { ready: true }), true)
  for (const patch of [{ projectId: 'production' }, { target: 'production' }, { readyState: 'BUILDING' },
    { gitSource: { ...deployment().gitSource, sha: 'b'.repeat(40) } },
    { gitSource: { ...deployment().gitSource, ref: 'main' } },
    { gitSource: { ...deployment().gitSource, repoId: 1 } }, { meta: { githubCommitSha: 'b'.repeat(40) } }]) {
    assert.equal(deploymentMatches(deployment(patch), pull(), { ready: true }), false)
  }
})
test('provisions canonical branch URL before build and reuses current deployment', async () => {
  const f = fixture()
  const result = await f.controller.run(123)
  assert.equal(result.sha, sha)
  const provisionIndex = f.calls.findIndex(c => c.body?.key === 'NEXT_PUBLIC_APP_URL')
  const buildIndex = f.calls.findIndex(c => c.path === '/v7/deployments')
  assert.ok(provisionIndex < buildIndex)
  assert.deepEqual(f.get().envs[0].target, ['preview'])
  assert.equal(f.get().envs[0].gitBranch, 'codex/fixture')
  assert.ok(!f.calls.some(c => c.path === '/v13/deployments' && c.method === 'POST'))
  assert.equal(f.calls.filter(c => c.body?.state === 'success').length, 1)
})
test('new deployment requests pin repository, branch and exact SHA', async () => {
  const f = fixture({ existing: false }); await f.controller.run(123)
  const build = f.calls.find(c => c.path === '/v13/deployments' && c.method === 'POST')
  assert.deepEqual(build.body.gitSource, { type: 'github', repoId: CONFIG.repositoryId, ref: 'codex/fixture', sha })
  assert.equal(build.body.project, CONFIG.projectId)
  assert.equal(build.body.target, undefined)
  assert.equal(build.body.autoAssignCustomDomains, false)
  assert.equal(build.query.forceNew, '1')
  assert.equal(build.body.projectSettings.buildCommand, 'bash scripts/vercel-build.sh')
})
test('new PR head prevents old deployment assignment and success status', async () => {
  const f = fixture({ changeHead: true })
  assert.equal((await f.controller.run(123)).state, 'superseded')
  assert.ok(!f.calls.some(c => c.path.endsWith('/aliases') && c.method === 'POST'))
  assert.ok(!f.calls.some(c => c.body?.state === 'success'))
})
test('alias readback mismatch fails the status rather than publishing QA evidence', async () => {
  const f = fixture({ failReadback: true })
  await assert.rejects(f.controller.run(123), /Alias deployment readback/)
  assert.ok(f.calls.some(c => c.body?.state === 'failure'))
  assert.ok(!f.calls.some(c => c.body?.state === 'success'))
})
test('canonical HTTPS must work before publishing a successful preview status', async () => {
  const f = fixture({ failHttps: true })
  await assert.rejects(f.controller.run(123), /TLS verification/)
  assert.ok(f.calls.some(c => c.service === 'https' && c.origin === previewAddress(123).origin))
  assert.ok(!f.calls.some(c => c.body?.state === 'success'))
})
test('close cleans managed resources idempotently; retained wildcard is never touched', async () => {
  const f = fixture(); await f.controller.run(123)
  f.setCurrent(pull({ state: 'closed' }))
  assert.equal((await f.controller.run(123)).state, 'closed')
  assert.equal((await f.controller.run(123)).state, 'closed')
  assert.deepEqual(f.get(), { envs: [], domain: undefined, alias: undefined })
  assert.ok(!f.calls.some(c => c.path?.includes('*.preview') && c.method && c.method !== 'GET'))
  assert.ok(f.calls.some(c => c.service === 'removed-https' && c.origin === previewAddress(123).origin))
})

test('a wildcard bound to production or a fallback alias prevents preview provisioning', async () => {
  for (const options of [{ wildcardBranch: null }, { wildcardAlias: true }]) {
    const f = fixture(options)
    await assert.rejects(f.controller.run(123), /wildcard/)
    assert.ok(!f.calls.some(c => c.method === 'POST'))
  }
})

test('cleanup requires the former hostname to return 404 before reporting completion', async () => {
  const f = fixture({ failRemoved: true })
  await f.controller.run(123)
  f.setCurrent(pull({ state: 'closed' }))
  await assert.rejects(f.controller.run(123), /must return 404/)
})
test('retargeting away from main cleans the former preview', async () => {
  const f = fixture(); await f.controller.run(123)
  f.setCurrent(pull({ base: { ...pull().base, ref: 'staging' } }))
  assert.equal((await f.controller.run(123)).state, 'closed')
})
test('cleanup refuses unmanaged URLs or domains from another branch', async () => {
  const f = fixture({ current: pull({ state: 'closed' }) })
  f.setEnv([{ key: 'NEXT_PUBLIC_APP_URL', gitBranch: 'codex/fixture', target: ['preview'], comment: 'manual' }])
  await assert.rejects(f.controller.run(123), /unmanaged/)
  f.setEnv([]); f.setDomain({ gitBranch: 'another-branch' })
  await assert.rejects(f.controller.run(123), /another branch/)
  assert.ok(!f.calls.some(c => c.method === 'DELETE'))
})
test('inventory reconciles open PRs and resources left behind by partial provisioning', async () => {
  const f = fixture()
  f.setDomain({ name: 'pr-124.preview.getoverlay.io', gitBranch: 'codex/closed' })
  f.setEnv([{ key: 'NEXT_PUBLIC_APP_URL', gitBranch: 'codex/partial', comment: 'overlay-preview-control:pr-125' }])
  assert.deepEqual(await f.controller.inventory(), [123, 124, 125])
})
test('API failures never print credentials, bodies, or attacker-controlled messages', async () => {
  const api = apiClient({ token: 'private-fixture', service: 'Vercel', base: 'https://api.vercel.com',
    teamId: CONFIG.teamId, fetchImpl: async (url, options) => {
      assert.equal(url.searchParams.get('teamId'), CONFIG.teamId)
      assert.equal(options.redirect, 'error')
      return { status: 403, ok: false, text: async () => JSON.stringify({ error: { code: 'forbidden', message: 'private-fixture' } }) }
    } })
  await assert.rejects(api('/v9/projects/x'), error => error.message === 'Vercel API 403 (forbidden)')
})

test('an expired backend prevents reuse of a READY frontend at the same SHA', async () => {
  const f = fixture({ backendActive: false }); await f.controller.run(123)
  assert.ok(f.calls.some(c => c.path === '/v13/deployments' && c.method === 'POST' && c.query.forceNew === '1'))
})

test('API client accepts successful empty bodies without suppressing malformed JSON', async () => {
  const client = raw => apiClient({ token: 'fixture', service: 'Convex', base: 'https://api.convex.dev/v1',
    fetchImpl: async () => ({ status: 200, ok: true, text: async () => raw }) })
  assert.deepEqual(await client('')('/deployments/fixture', { method: 'PATCH', body: { expiresAt: 1 } }), {})
  await assert.rejects(client('invalid')('/x'), /invalid_json/)
})

test('transient API reads retry with bounded backoff; mutations are never blindly repeated', async () => {
  let reads = 0; const pauses = []
  const api = apiClient({ token: 'fixture', service: 'GitHub', base: 'https://api.github.com',
    sleep: async ms => pauses.push(ms), fetchImpl: async () => {
      reads++
      if (reads === 1) throw new Error('Transport failure with private details')
      return { status: reads === 2 ? 503 : 200, ok: reads !== 2, text: async () => '{}' }
    } })
  assert.deepEqual(await api('/read'), {})
  assert.equal(reads, 3)
  assert.deepEqual(pauses, [1000, 2000])
  let writes = 0
  const mutation = apiClient({ token: 'fixture', service: 'Vercel', base: 'https://api.vercel.com',
    sleep: async () => assert.fail('Mutations cannot retry'), fetchImpl: async () => {
      writes++; throw new Error('Transport failure with private details')
    } })
  await assert.rejects(mutation('/write', { method: 'POST', body: {} }), /Vercel API network request failed/)
  assert.equal(writes, 1)
})

test('renewal preserves backend identity and patches only expiry within the retention limit', async () => {
  const now = 1000; const calls = []
  let d = { name: 'fixture-preview-123', projectId: CONFIG.convexProjectId,
    reference: 'preview/pr-123', previewIdentifier: 'pr-123', deploymentType: 'preview', expiresAt: now + 100_000 }
  const b = new PreviewBackends({ now: () => now, api: async (path, options = {}) => {
    calls.push({ path, ...options })
    if (options.method === 'PATCH') { d = { ...d, ...options.body }; return {} }
    return [d]
  } })
  assert.equal(await b.active(123), true)
  assert.equal((await b.renew(123)).expiresAt, now + 4 * 86400_000)
  assert.deepEqual(calls.find(c => c.method === 'PATCH').body, { expiresAt: now + 4 * 86400_000 })
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 1)
  await b.renew(123)
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 1)
  d = { ...d, deploymentType: 'prod' }
  await assert.rejects(b.renew(123), /identity/)
  d = { ...d, deploymentType: 'preview', projectId: 1 }
  await assert.rejects(b.renew(123), /identity/)
  d = { ...d, projectId: CONFIG.convexProjectId, expiresAt: now - 1 }
  assert.equal(await b.active(123), false)
  await assert.rejects(b.renew(123), /expired/)
})

test('superseded running build is canceled and confirmed before releasing the PR job', async () => {
  const f = fixture({ changeHead: true, buildState: 'BUILDING' })
  assert.equal((await f.controller.run(123)).state, 'superseded')
  assert.equal(f.calls.filter(c => c.path.endsWith('/cancel') && c.method === 'PATCH').length, 1)
  assert.ok(!f.calls.some(c => c.path.endsWith('/aliases') || c.body?.state === 'success'))
})
test('lost cancellation response uses state readback, never blind mutation retry', async () => {
  const f = fixture({ changeHead: true, buildState: 'BUILDING', cancelError: true })
  assert.equal((await f.controller.run(123)).state, 'superseded')
  assert.equal(f.calls.filter(c => c.path.endsWith('/cancel')).length, 1)
  const blocked = fixture({ changeHead: true, buildState: 'BUILDING', cancelError: true, cancelFinishes: false })
  await assert.rejects(blocked.controller.run(123), /cancellation could not be confirmed/)
})
test('cancellation refuses a production deployment before sending a mutation', async () => {
  const f = fixture()
  f.controller.vercel = async () => deployment({ target: 'production' })
  await assert.rejects(f.controller.settleBuild(pull(), 'dpl_fixture'), /unrelated deployment/)
})

test('a recovered job settles abandoned older builds before requesting the current head', async () => {
  const f = fixture({ existing: false })
  const delegate = f.controller.vercel
  let canceled = false
  const oldSha = 'b'.repeat(40)
  f.controller.vercel = async (path, options = {}) => {
    if (path === '/v7/deployments') return { deployments: [{ uid: 'dpl_old', state: 'BUILDING' }] }
    if (path === '/v13/deployments/dpl_old') return deployment({ id: 'dpl_old', readyState: canceled ? 'CANCELED' : 'BUILDING',
      gitSource: { ...deployment().gitSource, sha: oldSha } })
    if (path === '/v12/deployments/dpl_old/cancel') { canceled = true; return {} }
    if (path === '/v13/deployments' && options.method === 'POST') assert.equal(canceled, true)
    return delegate(path, options)
  }
  assert.equal((await f.controller.run(123)).state, 'ready')
  assert.equal(canceled, true)
})
