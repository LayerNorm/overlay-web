#!/usr/bin/env node
// Trusted main only; management credentials never execute feature-branch code.
import { appendFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { apiClient, CONFIG } from './preview-control.mjs'

export const STAGING = Object.freeze({
  ...CONFIG,
  hostname: 'staging.getoverlay.io',
  origin: 'https://staging.getoverlay.io',
  convexProjectId: 3199896,
  backend: 'doting-cuttlefish-819',
  backendUrl: 'https://doting-cuttlefish-819.convex.cloud',
})
const segment = encodeURIComponent
const stateOf = d => d.readyState ?? d.state
const terminal = d => ['READY', 'ERROR', 'CANCELED'].includes(stateOf(d))

export function revision(value) {
  if (!/^[a-f0-9]{40}$/.test(value ?? '')) throw new Error('An exact main SHA is required')
  return value
}

export function candidateOrigin(deployment) {
  if (!/^[a-z0-9-]+\.vercel\.app$/.test(deployment.url ?? '')) {
    throw new Error('Expected the verified staging deployment native hostname')
  }
  return 'https://' + deployment.url
}

export function stagingDeploymentMatches(d, sha, { ready = false } = {}) {
  const source = d.gitSource
  const meta = d.meta ?? {}
  return d.projectId === STAGING.projectId && d.target === 'production'
    && source?.type === 'github' && Number(source.repoId) === STAGING.repositoryId
    && source.ref === 'main' && source.sha === sha
    && (!meta.githubCommitSha || meta.githubCommitSha === sha)
    && (!meta.githubCommitRef || meta.githubCommitRef === 'main')
    && meta.overlayReleaseLane === 'staging' && meta.overlayStagingSha === sha
    && meta.overlayStagingBackend === STAGING.backend
    && (!ready || stateOf(d) === 'READY')
}

export function stagingBuildSettings(sha) {
  revision(sha)
  // Only fixed strings and a validated hex SHA reach the build shell. These
  // overrides are per request: dashboard defaults cannot authorize manual builds.
  const prefix = `OVERLAY_STAGING_BUILD=trusted-main OVERLAY_STAGING_BUILD_SHA=${sha} `
  return {
    buildCommand: prefix + 'bash scripts/vercel-build.sh',
    commandForIgnoringBuildStep: prefix + 'bash scripts/vercel-ignore-build.sh',
  }
}

export class StagingController {
  constructor({ github, vercel, now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), report = console.log }) {
    this.github = github; this.vercel = vercel; this.now = now
    this.sleep = sleep; this.report = report
    this.repoPath = `/repos/${STAGING.repository}`
    this.projectPath = `/v9/projects/${STAGING.projectId}`
  }
  async currentMain() {
    const result = await this.github(`${this.repoPath}/git/ref/heads/main`)
    if (result.ref !== 'refs/heads/main' || result.object?.type !== 'commit') {
      throw new Error('Invalid main branch reference')
    }
    return revision(result.object.sha)
  }
  async verifyProject() {
    const repository = await this.github(this.repoPath)
    if (repository.id !== STAGING.repositoryId || repository.full_name !== STAGING.repository) {
      throw new Error('GitHub repository identity mismatch')
    }
    const p = await this.vercel(this.projectPath)
    if (p.id !== STAGING.projectId || p.name !== STAGING.projectName || p.accountId !== STAGING.teamId
      || p.link?.type !== 'github' || Number(p.link.repoId) !== STAGING.repositoryId
      || p.link.org !== 'LayerNorm' || p.link.repo !== 'overlay-web' || p.link.productionBranch !== 'main') {
      throw new Error('Dedicated staging project is not configured for Divyansh main')
    }
    const domain = await this.vercel(`${this.projectPath}/domains/${segment(STAGING.hostname)}`)
    if (domain.name !== STAGING.hostname || !domain.verified || domain.redirect
      || (domain.gitBranch && domain.gitBranch !== 'main')) {
      throw new Error('Staging domain must be verified and assigned to main')
    }
  }
  async status(sha, state, description, url) {
    await this.github(`${this.repoPath}/statuses/${sha}`, { method: 'POST', body: {
      state, context: 'Staging Deploy', description,
      ...(url ? { target_url: url } : {}),
    } })
  }
  async settle(sha, id) {
    const path = `/v13/deployments/${segment(id)}`
    let d = await this.vercel(path)
    if (!stagingDeploymentMatches(d, sha)) throw new Error('Refusing to cancel an unrelated staging deployment')
    if (terminal(d)) return d
    try {
      await this.vercel(`/v12/deployments/${segment(id)}/cancel`, { method: 'PATCH' })
    } catch {
      d = await this.vercel(path)
      if (!stagingDeploymentMatches(d, sha) || !terminal(d)) {
        throw new Error('Staging cancellation could not be confirmed')
      }
      return d
    }
    const deadline = this.now() + 60_000
    do {
      d = await this.vercel(path)
      if (!stagingDeploymentMatches(d, sha)) throw new Error('Canceled staging deployment provenance mismatch')
      if (terminal(d)) return d
      await this.sleep(1000)
    } while (this.now() < deadline)
    throw new Error('Staging cancellation readiness timeout')
  }
  async start(sha) {
    let until
    // Drain every abandoned main build before a new build can change the shared
    // staging backend. Inspect individual records; lists omit source provenance.
    do {
      const page = await this.vercel('/v7/deployments', { query: {
        projectId: STAGING.projectId, branch: 'main', target: 'production', limit: 100,
        ...(until ? { until } : {}),
      } })
      for (const candidate of page.deployments) {
        if (!['QUEUED', 'INITIALIZING', 'BUILDING'].includes(stateOf(candidate))) continue
        const d = await this.vercel(`/v13/deployments/${segment(candidate.uid ?? candidate.id)}`)
        const oldSha = revision(d.gitSource?.sha)
        if (!stagingDeploymentMatches(d, oldSha)) throw new Error('Unmanaged main staging build is still running')
        await this.settle(oldSha, d.id)
      }
      until = page.pagination?.next
    } while (until)
    // Always rebuild. READY proves web provenance, but cannot establish that a
    // persistent backend still has that revision after another attempted build.
    if (await this.currentMain() !== sha) return null
    return this.vercel('/v13/deployments', { method: 'POST', query: { forceNew: '1' }, body: {
      name: STAGING.projectName, project: STAGING.projectId, target: 'production',
      autoAssignCustomDomains: false,
      projectSettings: stagingBuildSettings(sha),
      gitSource: { type: 'github', repoId: STAGING.repositoryId, ref: 'main', sha },
      meta: { overlayReleaseLane: 'staging', overlayStagingSha: sha, overlayStagingBackend: STAGING.backend },
    } })
  }
  async run(sha, { prepareOnly = false } = {}) {
    revision(sha)
    await this.verifyProject()
    if (await this.currentMain() !== sha) return { state: 'superseded', sha }
    let previousDeploymentId
    if (prepareOnly) {
      const current = await this.vercel(`/v4/aliases/${segment(STAGING.hostname)}`)
      if (current.projectId !== STAGING.projectId || !current.deployment?.id) {
        throw new Error('Candidate preparation requires the existing canonical staging alias')
      }
      previousDeploymentId = current.deployment.id
    }
    await this.status(sha, 'pending', `Building dedicated staging for ${sha.slice(0, 12)}`)
    let deployment
    try {
      deployment = await this.start(sha)
      if (!deployment) return this.superseded(sha)
      const deadline = this.now() + 30 * 60_000
      let lastState
      while (this.now() < deadline) {
        if (await this.currentMain() !== sha) {
          await this.settle(sha, deployment.id ?? deployment.uid)
          return this.superseded(sha)
        }
        deployment = await this.vercel(`/v13/deployments/${segment(deployment.id ?? deployment.uid)}`)
        if (!stagingDeploymentMatches(deployment, sha)) throw new Error('Staging deployment provenance mismatch')
        const state = stateOf(deployment)
        if (state !== lastState) { this.report(`Staging ${sha.slice(0, 12)}: ${state}`); lastState = state }
        if (state === 'READY') break
        if (['ERROR', 'CANCELED'].includes(state)) throw new Error(`Staging deployment ${state}`)
        await this.sleep(10_000)
      }
      if (!stagingDeploymentMatches(deployment, sha, { ready: true })) throw new Error('Staging build readiness timeout')
      if (await this.currentMain() !== sha) return this.superseded(sha)
      if (prepareOnly) {
        const current = await this.vercel(`/v4/aliases/${segment(STAGING.hostname)}`)
        if (current.projectId !== STAGING.projectId || current.deployment?.id !== previousDeploymentId) {
          throw new Error('Canonical staging changed while preparing its candidate')
        }
        const evidence = { state: 'ready', sha, projectId: STAGING.projectId,
          deploymentId: deployment.id, backend: STAGING.backend, backendUrl: STAGING.backendUrl,
          url: candidateOrigin(deployment), published: false, previousDeploymentId, smoke: 'pending' }
        await this.status(sha, 'success', `Candidate READY ${sha.slice(0, 12)}; canonical staging unchanged`, evidence.url)
        return evidence
      }
      await this.vercel(`/v2/deployments/${segment(deployment.id)}/aliases`, { method: 'POST',
        body: { alias: STAGING.hostname } })
      const alias = await this.vercel(`/v4/aliases/${segment(STAGING.hostname)}`)
      if (alias.projectId !== STAGING.projectId || alias.deployment?.id !== deployment.id) {
        throw new Error('Staging alias readback mismatch')
      }
      // Main can advance during the assignment call. Do not publish a stale
      // success; the next serialized job deploys the new revision.
      if (await this.currentMain() !== sha) return this.superseded(sha)
      const evidence = { state: 'ready', sha, projectId: STAGING.projectId,
        deploymentId: deployment.id, backend: STAGING.backend, backendUrl: STAGING.backendUrl,
        url: STAGING.origin, smoke: 'pending' }
      await this.status(sha, 'success', `READY ${sha.slice(0, 12)}; staging smoke required`, STAGING.origin)
      return evidence
    } catch (error) {
      // A timeout or a failed read must not leave a remote build writing the
      // persistent backend after the workflow has released its concurrency lock.
      if (deployment) await this.settle(sha, deployment.id ?? deployment.uid)
      await this.status(sha, 'failure', 'Staging deployment failed; inspect trusted workflow logs')
      throw error
    }
  }
  async superseded(sha) {
    await this.status(sha, 'error', 'Main advanced; this revision is not promotion evidence')
    return { state: 'superseded', sha }
  }
}

export async function main(env = process.env) {
  if (env.GITHUB_REPOSITORY !== STAGING.repository || env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Staging controller must run from protected main')
  }
  const sha = revision(env.GITHUB_SHA)
  const controller = new StagingController({
    github: apiClient({ token: env.GITHUB_TOKEN, service: 'GitHub', base: 'https://api.github.com' }),
    vercel: apiClient({ token: env.VERCEL_STAGING_TOKEN, service: 'Vercel',
      base: 'https://api.vercel.com', teamId: STAGING.teamId }),
  })
  const result = await controller.run(sha, { prepareOnly: env.STAGING_PREPARE_ONLY === '1' })
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT,
    `ready=${result.state === 'ready'}\nsha=${sha}\ndeployment_id=${result.deploymentId ?? ''}\n`)
  writeFileSync('staging-deployment.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
