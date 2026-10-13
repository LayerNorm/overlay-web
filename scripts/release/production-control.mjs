import assert from 'node:assert/strict'
import { CONFIG } from './preview-control.mjs'
import { STAGING, candidateOrigin, revision, stagingDeploymentMatches } from './staging-control.mjs'
import { verifiedSmoke } from './staging-publish.mjs'

export const PRODUCTION = Object.freeze({ ...CONFIG,
  projectId: 'prj_wucEZdZyA2xKUurHLXSuQNcS1YPy', projectName: 'overlay-landing',
  teamSlug: 'divyansh-lalwanis-projects', hostname: 'www.getoverlay.io',
  origin: 'https://www.getoverlay.io', backend: 'colorful-chickadee-419',
  backendUrl: 'https://colorful-chickadee-419.convex.cloud',
})

export function productionDeploymentMatches(d, sha) {
  revision(sha)
  return d.projectId === PRODUCTION.projectId && d.target === 'production'
    && (d.readyState ?? d.state) === 'READY'
    && d.meta?.overlayReleaseLane === 'production' && d.meta?.overlayReleaseSha === sha
    && d.meta?.overlayConvexBackend === PRODUCTION.backend
    && d.meta?.githubCommitSha === sha && d.meta?.githubCommitRef === 'main'
    && /^[a-z0-9-]+\.vercel\.app$/.test(d.url ?? '')
}

export async function verifyProductionProject(vercel) {
  const p = await vercel(`/v9/projects/${PRODUCTION.projectId}`)
  assert.ok(p.id === PRODUCTION.projectId && p.name === PRODUCTION.projectName
    && p.accountId === PRODUCTION.teamId && p.link?.type === 'github'
    && Number(p.link.repoId) === PRODUCTION.repositoryId && p.link.org === 'LayerNorm'
    && p.link.repo === 'overlay-web' && p.link.productionBranch === 'main', 'Wrong production project or owner')
  return p
}

export async function verifyProductionLive(vercel, deployment, sha) {
  assert.ok(productionDeploymentMatches(deployment, sha), 'Production deployment provenance mismatch')
  const alias = await vercel(`/v4/aliases/${PRODUCTION.hostname}`)
  assert.ok(alias.projectId === PRODUCTION.projectId && alias.deployment?.id === deployment.id,
    'The expected production web deployment is not live')
}

export function promotionEvidence(evidence, sha, run, job) {
  verifiedSmoke(evidence, sha)
  assert.ok(run.id === Number(evidence.runId) && run.head_sha === sha && run.head_branch === 'main'
    && run.repository?.id === PRODUCTION.repositoryId && run.status === 'completed'
    && run.conclusion === 'success' && run.event === 'workflow_dispatch'
    && run.path === '.github/workflows/staging-release.yml', 'Wrong staging evidence producer')
  assert.ok(job.name === 'deploy' && job.status === 'completed' && job.conclusion === 'success'
    && job.steps.some(s => s.name === 'Verify authenticated staging behavior' && s.conclusion === 'success'),
  'The staging smoke job did not pass')
  if (evidence.published === true) assert.ok(job.steps.some(s => s.name === 'Verify canonical staging after cutover'
    && s.conclusion === 'success'), 'Canonical cutover smoke did not pass')
  return evidence
}

export async function verifyStagingLive({ github, vercel, evidence, sha }) {
  const main = await github(`/repos/${PRODUCTION.repository}/git/ref/heads/main`)
  assert.equal(main.object?.sha, sha, 'Main changed since staging acceptance')
  const d = await vercel(`/v13/deployments/${evidence.deploymentId}`)
  assert.ok(stagingDeploymentMatches(d, sha, { ready: true }), 'Staging deployment no longer matches acceptance')
  if (evidence.published === false) {
    assert.equal(evidence.url, candidateOrigin(d), 'Release candidate origin changed')
  } else {
    assert.equal(evidence.url, STAGING.origin, 'Wrong published release origin')
    const alias = await vercel(`/v4/aliases/${STAGING.hostname}`)
    assert.ok(alias.projectId === STAGING.projectId && alias.deployment?.id === d.id,
      'Published release candidate no longer serves the accepted revision')
  }
}

export function productionCredentials(env) {
  assert.ok(env.PRODUCTION_SMOKE_EMAIL === 'overlay-release-qa@getoverlay.io'
    && env.PRODUCTION_SMOKE_PASSWORD && /^user_[A-Za-z0-9]+$/.test(env.PRODUCTION_SMOKE_USER_ID ?? '')
    && env.PRODUCTION_SMOKE_USER_ID !== 'user_01M4R1EKTMDZ4E6BQ5DMZXD0F2',
  'Configure the separate synthetic production smoke account')
  const key = env.CONVEX_PRODUCTION_DEPLOY_KEY
  assert.ok(typeof key === 'string' && key.startsWith('prod:' + PRODUCTION.backend + '|')
    && key.split('|')[1] && !/[\r\n"\\]/.test(key), 'An exact production Convex deploy key is required')
}
