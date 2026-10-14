import assert from 'node:assert/strict'
import { CONFIG } from './preview-control.mjs'

export const PRODUCTION = Object.freeze({ ...CONFIG,
  projectId: 'prj_wucEZdZyA2xKUurHLXSuQNcS1YPy', projectName: 'overlay-landing',
  teamSlug: 'divyansh-lalwanis-projects', hostname: 'www.getoverlay.io',
  origin: 'https://www.getoverlay.io', backend: 'colorful-chickadee-419',
  backendUrl: 'https://colorful-chickadee-419.convex.cloud',
})

export function productionDeploymentMatches(d, sha, { ready = true } = {}) {
  assert.match(sha, /^[a-f0-9]{40}$/, 'Invalid production revision')
  return d.projectId === PRODUCTION.projectId && d.target === 'production'
    && (!ready || (d.readyState ?? d.state) === 'READY')
    && d.meta?.githubCommitSha === sha && d.meta?.githubCommitRef === 'main'
    && (!d.gitSource || (d.gitSource.type === 'github'
      && Number(d.gitSource.repoId) === PRODUCTION.repositoryId
      && d.gitSource.ref === 'main' && d.gitSource.sha === sha))
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
