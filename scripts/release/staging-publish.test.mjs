import assert from 'node:assert/strict'
import test from 'node:test'
import { publish, verifiedSmoke, SMOKE_CHECKS } from './staging-publish.mjs'
import { STAGING } from './staging-control.mjs'
const sha = 'a'.repeat(40)
const evidence = { state: 'ready', sha, projectId: STAGING.projectId, backend: STAGING.backend,
  backendUrl: STAGING.backendUrl, url: 'https://candidate.vercel.app', published: false,
  deploymentId: 'dpl_candidate', previousDeploymentId: 'dpl_previous', smoke: 'passed', runId: '123',
  checks: Object.fromEntries(SMOKE_CHECKS.map(name => [name, true])) }
const env = { GITHUB_REPOSITORY: STAGING.repository, GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: sha, GITHUB_RUN_ID: '123', STAGING_ISOLATION_VERIFIED: 'enabled' }
function fixture({ mainSha = sha, aliasId = 'dpl_previous', url = 'candidate.vercel.app', projectId = STAGING.projectId } = {}) {
  const writes = []
  const github = async (path, options = {}) => {
    if (options.method) { writes.push({ path, ...options }); return {} }
    if (path.endsWith('/git/ref/heads/main')) return { ref: 'refs/heads/main', object: { type: 'commit', sha: mainSha } }
    return { id: STAGING.repositoryId, full_name: STAGING.repository }
  }
  const vercel = async (path, options = {}) => {
    if (path === `/v9/projects/${STAGING.projectId}`) return { id: projectId, name: STAGING.projectName,
      accountId: STAGING.teamId, link: { type: 'github', repoId: STAGING.repositoryId,
        org: 'LayerNorm', repo: 'overlay-web', productionBranch: 'main' } }
    if (path.includes('/domains/')) return { name: STAGING.hostname, verified: true }
    if (path === '/v13/deployments/dpl_candidate') return { id: 'dpl_candidate', projectId, url,
      target: 'production', readyState: 'READY', gitSource: { type: 'github', repoId: STAGING.repositoryId, ref: 'main', sha },
      meta: { overlayReleaseLane: 'staging', overlayStagingSha: sha, overlayStagingBackend: STAGING.backend } }
    if (path === `/v4/aliases/${STAGING.hostname}`) return { projectId, deployment: { id: aliasId } }
    if (path === '/v2/deployments/dpl_candidate/aliases') { writes.push({ path, ...options }); aliasId = 'dpl_candidate'; return {} }
    throw new Error('Unexpected test API route')
  }
  return { github, vercel, writes }
}
test('cutover requires every authenticated smoke check and a valid producer run', () => {
  assert.equal(verifiedSmoke(evidence, sha), evidence)
  for (const name of SMOKE_CHECKS) assert.throws(() => verifiedSmoke({ ...evidence,
    checks: { ...evidence.checks, [name]: false } }, sha))
  for (const patch of [{ smoke: 'pending' }, { runId: '' }, { sha: 'b'.repeat(40) }]) {
    assert.throws(() => verifiedSmoke({ ...evidence, ...patch }, sha))
  }
})
test('publication checks isolation, current main, source, origin and old alias before writing', async () => {
  for (const settings of [{ mainSha: 'b'.repeat(40) }, { aliasId: 'dpl_unrelated' },
    { url: 'another.vercel.app' }, { projectId: 'production' }]) {
    const f = fixture(settings)
    await assert.rejects(publish({ env, evidence, ...f }))
    assert.deepEqual(f.writes, [])
  }
  for (const patch of [{ STAGING_ISOLATION_VERIFIED: '' }, { GITHUB_RUN_ID: '456' }, { GITHUB_REF: 'refs/heads/codex/feature' }]) {
    const f = fixture()
    await assert.rejects(publish({ env: { ...env, ...patch }, evidence, ...f }))
    assert.deepEqual(f.writes, [])
  }
})
test('a verified candidate publishes only its canonical staging alias and requires final smoke', async () => {
  const f = fixture(), result = await publish({ env, evidence, ...f })
  assert.equal(result.url, STAGING.origin)
  assert.equal(result.candidateUrl, evidence.url)
  assert.equal(result.published, true)
  assert.equal(result.smoke, 'pending')
  const aliases = f.writes.filter(w => w.path.endsWith('/aliases'))
  assert.equal(aliases.length, 1)
  assert.deepEqual(aliases[0].body, { alias: STAGING.hostname })
})
