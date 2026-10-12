#!/usr/bin/env node
// Runs only from trusted main workflow code. No dependencies, PR checkout, or shell evaluation.
import { readFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const CONFIG = Object.freeze({
  repository: 'LayerNorm/overlay-web', repositoryId: 1133644268,
  teamId: 'team_VT3uNspuyAOwicxedhtG4SMe',
  projectId: 'prj_IKvugqekF8qLP14p7Rg4ilWErXPr', projectName: 'overlay-web-staging',
  convexProjectId: 1649204,
})
const segment = encodeURIComponent
export function previewAddress(number) {
  if (!/^[1-9]\d*$/.test(String(number)) || !Number.isSafeInteger(Number(number))) {
    throw new Error('Invalid PR number')
  }
  return { hostname: `pr-${number}.preview.getoverlay.io`, origin: `https://pr-${number}.preview.getoverlay.io`,
    marker: `overlay-preview-control:pr-${number}` }
}
export function trustedPull(pr, { requireMain = true } = {}) {
  previewAddress(pr.number)
  if (pr.base?.repo?.full_name !== CONFIG.repository || (requireMain && pr.base?.ref !== 'main')
    || pr.head?.repo?.full_name !== CONFIG.repository || pr.head?.repo?.id !== CONFIG.repositoryId) {
    throw new Error('Preview requires an internal pull request targeting main')
  }
  if (!/^[a-f0-9]{40}$/.test(pr.head.sha) || !pr.head.ref || pr.head.ref === 'main') {
    throw new Error('Invalid PR source revision')
  }
  return pr
}
export function deploymentMatches(deployment, pr, { ready = false } = {}) {
  const source = deployment.gitSource
  const meta = deployment.meta ?? {}
  return deployment.projectId === CONFIG.projectId
    && (deployment.target === null || deployment.target === undefined || deployment.target === 'preview')
    && source?.type === 'github' && Number(source.repoId) === CONFIG.repositoryId
    && source.ref === pr.head.ref && source.sha === pr.head.sha
    && (!meta.githubCommitSha || meta.githubCommitSha === pr.head.sha)
    && (!meta.githubCommitRef || meta.githubCommitRef === pr.head.ref)
    && (!ready || (deployment.readyState ?? deployment.state) === 'READY')
}

export class ApiError extends Error {
  constructor(service, status, code) {
    // Never include API response bodies or auth headers in logs.
    super(`${service} API ${status}${code && /^[\w-]+$/.test(code) ? ` (${code})` : ''}`)
    this.status = status
  }
}
export function apiClient({ token, service, base, teamId, fetchImpl = fetch }) {
  if (!token) throw new Error(`${service} credential is missing`)
  return async (path, { method = 'GET', body, query = {} } = {}) => {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path')
    const url = new URL(base + path)
    for (const [key, value] of Object.entries({ ...query, ...(teamId ? { teamId } : {}) })) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const response = await fetchImpl(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json',
        ...(service === 'GitHub' ? { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    let value
    try {
      const raw = response.status === 204 ? '' : await response.text()
      value = raw ? JSON.parse(raw) : {}
    } catch {
      throw new ApiError(service, response.status, 'invalid_json')
    }
    if (!response.ok) throw new ApiError(service, response.status, value.error?.code)
    return value
  }
}

export class PreviewBackends {
  constructor({ api, now = Date.now }) { this.api = api; this.now = now }
  async find(number) {
    previewAddress(number)
    const items = await this.api(`/projects/${CONFIG.convexProjectId}/list_deployments`)
    const matches = items.filter(d => d.reference === `preview/pr-${number}`)
    if (matches.length > 1) throw new Error('Ambiguous PR backend')
    const d = matches[0]
    if (d && (d.projectId !== CONFIG.convexProjectId || d.deploymentType !== 'preview'
      || d.previewIdentifier !== `pr-${number}` || !/^[a-z0-9-]+$/.test(d.name))) {
      throw new Error('PR backend identity mismatch')
    }
    return d
  }
  async active(number) {
    const d = await this.find(number)
    return !!d && (d.expiresAt === null || d.expiresAt > this.now())
  }
  async renew(number) {
    const d = await this.find(number)
    if (!d || (d.expiresAt !== null && d.expiresAt <= this.now())) throw new Error('PR backend is missing or expired')
    // Starter permits five days from now. Renew to four days, safely inside
    // that entitlement. Closed PRs stop renewing and expire naturally.
    if (d.expiresAt !== null && d.expiresAt > this.now() + 2 * 86400_000) return d
    const expiresAt = this.now() + 4 * 86400_000
    await this.api(`/deployments/${segment(d.name)}`, { method: 'PATCH', body: { expiresAt } })
    const after = await this.find(number)
    if (!after || after.name !== d.name || after.expiresAt !== expiresAt) throw new Error('Preview renewal readback failed')
    return after
  }
}
async function optional(api, path) {
  try { return await api(path) } catch (error) { if (error.status === 404) return null; throw error }
}
async function remove(api, path) {
  try { await api(path, { method: 'DELETE' }) } catch (error) { if (error.status !== 404) throw error }
}
async function pages(api, path, key, query = {}) {
  const items = []
  let until
  do {
    const page = await api(path, { query: { ...query, limit: 100, ...(until ? { until } : {}) } })
    items.push(...page[key])
    until = page.pagination?.next
  } while (until)
  return items
}

export class PreviewController {
  constructor({ github, vercel, backends, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    now = Date.now, report = console.log, verifyHttps = async origin => {
      const result = await fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
      // A protected preview can return 401/403 or redirect to Vercel sign-in.
      // Receiving an HTTP response proves TLS issuance; redirects to staging do not.
      const location = result.headers.get('location')
      if (result.status >= 500 || (location && new URL(location, origin).hostname === 'staging.getoverlay.io')) {
        throw new Error('Canonical preview HTTPS probe failed')
      }
    } }) {
    this.github = github; this.vercel = vercel; this.backends = backends
    this.sleep = sleep; this.now = now; this.report = report
    this.verifyHttps = verifyHttps
    this.repoPath = `/repos/${CONFIG.repository}`
    this.projectPath = `/v9/projects/${CONFIG.projectId}`
  }
  async pull(number) { return this.github(`${this.repoPath}/pulls/${number}`) }
  async verifyProject() {
    const p = await this.vercel(this.projectPath)
    if (p.id !== CONFIG.projectId || p.name !== CONFIG.projectName || p.link?.type !== 'github'
      || Number(p.link.repoId) !== CONFIG.repositoryId || p.link.org !== 'LayerNorm' || p.link.repo !== 'overlay-web') {
      throw new Error('Staging project repository identity mismatch')
    }
  }
  async status(pr, state, description, url) {
    await this.github(`${this.repoPath}/statuses/${pr.head.sha}`, { method: 'POST', body: {
      state, context: 'PR Preview', description,
      ...(url ? { target_url: url } : {}),
    } })
  }
  async environment(pr) {
    const result = await this.vercel(`/v10/projects/${CONFIG.projectId}/env`, { query: { gitBranch: pr.head.ref, decrypt: 'false' } })
    return result.envs.filter(e => e.gitBranch === pr.head.ref && e.key === 'NEXT_PUBLIC_APP_URL'
      && e.target?.includes('preview'))
  }
  async provision(pr) {
    const address = previewAddress(pr.number)
    const variables = await this.environment(pr)
    if (variables.some(e => e.comment !== address.marker || e.target.some(t => t !== 'preview'))) {
      throw new Error('Refusing to overwrite an unmanaged branch app URL')
    }
    await this.vercel(`/v10/projects/${CONFIG.projectId}/env`, { method: 'POST', query: { upsert: 'true' }, body: {
      key: 'NEXT_PUBLIC_APP_URL', value: address.origin, type: 'plain', target: ['preview'],
      gitBranch: pr.head.ref, comment: address.marker,
    } })
    const path = `${this.projectPath}/domains/${segment(address.hostname)}`
    const domain = await optional(this.vercel, path)
    if (domain && (domain.gitBranch !== pr.head.ref || domain.redirect)) {
      throw new Error('Preview domain is already assigned to a different source')
    }
    if (!domain) {
      await this.vercel(`/v10/projects/${CONFIG.projectId}/domains`, { method: 'POST',
        body: { name: address.hostname, gitBranch: pr.head.ref } })
    }
    const configured = await this.vercel(path)
    if (configured.gitBranch !== pr.head.ref || configured.verified !== true) {
      throw new Error('PR custom domain is not verified and bound to the source branch')
    }
    return address
  }
  async cleanup(pr) {
    const address = previewAddress(pr.number)
    const variables = await this.environment(pr)
    if (variables.some(e => e.comment !== address.marker || e.target.some(t => t !== 'preview'))) {
      throw new Error('Refusing to remove an unmanaged branch app URL')
    }
    const domainPath = `${this.projectPath}/domains/${segment(address.hostname)}`
    const domain = await optional(this.vercel, domainPath)
    if (domain && domain.gitBranch !== pr.head.ref) throw new Error('Refusing to remove another branch domain')
    const alias = await optional(this.vercel, `/v4/aliases/${segment(address.hostname)}`)
    if (alias && alias.projectId !== CONFIG.projectId) throw new Error('Refusing to remove another project alias')
    if (alias) await remove(this.vercel, `/v2/aliases/${segment(alias.uid)}`)
    if (domain) await remove(this.vercel, domainPath)
    for (const variable of variables) await remove(this.vercel, `${this.projectPath}/env/${segment(variable.id)}`)
    if (await optional(this.vercel, domainPath) || await optional(this.vercel, `/v4/aliases/${segment(address.hostname)}`)
      || (await this.environment(pr)).some(e => e.comment === address.marker)) {
      throw new Error('Preview cleanup readback failed')
    }
    this.report(`PR ${pr.number}: domain, alias, and branch app URL removed`)
    return { state: 'closed', number: pr.number }
  }
  async start(pr) {
    const backendActive = await this.backends.active(pr.number)
    const results = await this.vercel('/v7/deployments', { query: {
      projectId: CONFIG.projectId, branch: pr.head.ref, sha: pr.head.sha, limit: 100,
    } })
    // List records omit gitSource; inspect each candidate before reuse.
    for (const candidate of results.deployments) {
      if (!['READY', 'QUEUED', 'INITIALIZING', 'BUILDING'].includes(candidate.readyState ?? candidate.state)) continue
      if ((candidate.readyState ?? candidate.state) === 'READY' && !backendActive) continue
      const d = await this.vercel(`/v13/deployments/${segment(candidate.uid ?? candidate.id)}`)
      if (deploymentMatches(d, pr)) return d
    }
    return this.vercel('/v13/deployments', { method: 'POST', query: { forceNew: '1' }, body: {
      name: CONFIG.projectName, project: CONFIG.projectId,
      // The controller owns canonical assignment; native branch aliases must
      // not assign an older deployment before provenance checks run.
      autoAssignCustomDomains: false,
      projectSettings: { buildCommand: 'bash scripts/vercel-build.sh' },
      gitSource: { type: 'github', repoId: CONFIG.repositoryId, ref: pr.head.ref, sha: pr.head.sha },
      meta: { overlayPreviewPr: String(pr.number), overlayPreviewSha: pr.head.sha },
    } })
  }
  async run(number) {
    previewAddress(number)
    await this.verifyProject()
    const pr = trustedPull(await this.pull(number), { requireMain: false })
    if (pr.state !== 'open' || pr.base.ref !== 'main') return this.cleanup(pr)
    const siblings = await this.github(`${this.repoPath}/pulls`, { query: { state: 'open', head: `LayerNorm:${pr.head.ref}`, base: 'main', per_page: 100 } })
    if (siblings.some(other => other.number !== pr.number)) throw new Error('One PR per source branch is required')
    const address = await this.provision(pr)
    await this.status(pr, 'pending', `Building ${pr.head.sha.slice(0, 12)} at canonical PR URL`)
    let deployment
    try {
      deployment = await this.start(pr)
      const deadline = this.now() + 30 * 60_000
      let lastState
      while (this.now() < deadline) {
        const current = trustedPull(await this.pull(number), { requireMain: false })
        if (current.state !== 'open' || current.base.ref !== 'main') return this.cleanup(current)
        if (current.head.sha !== pr.head.sha || current.head.ref !== pr.head.ref) {
          this.report(`PR ${number}: head changed; superseded deployment will not be aliased`)
          return { state: 'superseded', number }
        }
        deployment = await this.vercel(`/v13/deployments/${segment(deployment.id ?? deployment.uid)}`)
        if (!deploymentMatches(deployment, pr)) throw new Error('Deployment provenance mismatch')
        const state = deployment.readyState ?? deployment.state
        if (state !== lastState) { this.report(`PR ${number}: ${state} (${pr.head.sha.slice(0, 12)})`); lastState = state }
        if (state === 'READY') break
        if (['ERROR', 'CANCELED'].includes(state)) throw new Error(`Preview deployment ${state}`)
        await this.sleep(10_000)
      }
      if (!deploymentMatches(deployment, pr, { ready: true })) throw new Error('Preview build readiness timeout')
      const current = trustedPull(await this.pull(number), { requireMain: false })
      if (current.state !== 'open' || current.base.ref !== 'main') return this.cleanup(current)
      if (current.head.sha !== pr.head.sha) return { state: 'superseded', number }
      const backend = await this.backends.renew(number)
      await this.vercel(`/v2/deployments/${segment(deployment.id)}/aliases`, { method: 'POST', body: { alias: address.hostname } })
      const alias = await this.vercel(`/v4/aliases/${segment(address.hostname)}`)
      if (alias.projectId !== CONFIG.projectId || alias.deployment?.id !== deployment.id) throw new Error('Alias deployment readback mismatch')
      await this.verifyHttps(address.origin)
      // Recheck after assignment: a push or close during the API call must not publish stale success.
      const after = trustedPull(await this.pull(number), { requireMain: false })
      if (after.state !== 'open' || after.base.ref !== 'main') return this.cleanup(after)
      if (after.head.sha !== pr.head.sha) return { state: 'superseded', number }
      await this.status(pr, 'success', `READY ${pr.head.sha.slice(0, 12)}; browser QA required`, address.origin)
      const evidence = { number, sha: pr.head.sha, url: address.origin, deploymentId: deployment.id,
        backend: backend.name, backendExpiresAt: backend.expiresAt, state: 'ready' }
      this.report(JSON.stringify(evidence))
      return evidence
    } catch (error) {
      await this.status(pr, 'failure', 'Preview provisioning/build failed; inspect trusted workflow logs')
      throw error
    }
  }
  async inventory() {
    await this.verifyProject()
    const numbers = new Set()
    // GitHub uses page pagination rather than timestamps.
    for (let page = 1; ; page++) {
      const pulls = await this.github(`${this.repoPath}/pulls`, { query: { state: 'open', base: 'main', per_page: 100, page } })
      for (const pr of pulls) {
        try { trustedPull(pr); numbers.add(pr.number) } catch { /* Fork previews have no credentials. */ }
      }
      if (pulls.length < 100) break
    }
    const domains = await pages(this.vercel, `${this.projectPath}/domains`, 'domains')
    for (const domain of domains) {
      const match = /^pr-([1-9]\d*)\.preview\.getoverlay\.io$/.exec(domain.name)
      if (match && domain.gitBranch) numbers.add(Number(match[1]))
    }
    // Also reconcile an env provisioned before a domain-creation failure.
    const { envs } = await this.vercel(`/v10/projects/${CONFIG.projectId}/env`, { query: { decrypt: 'false' } })
    for (const env of envs) {
      const match = /^overlay-preview-control:pr-([1-9]\d*)$/.exec(env.comment ?? '')
      if (match && env.key === 'NEXT_PUBLIC_APP_URL' && env.gitBranch) numbers.add(Number(match[1]))
    }
    return [...numbers].sort((a, b) => a - b)
  }
}

export async function main(env = process.env, args = process.argv.slice(2)) {
  if (env.GITHUB_REPOSITORY && env.GITHUB_REPOSITORY !== CONFIG.repository) throw new Error('Unexpected workflow repository')
  const controller = new PreviewController({
    github: apiClient({ token: env.GITHUB_TOKEN, service: 'GitHub', base: 'https://api.github.com' }),
    vercel: apiClient({ token: env.VERCEL_STAGING_TOKEN, service: 'Vercel', base: 'https://api.vercel.com', teamId: CONFIG.teamId }),
    backends: new PreviewBackends({ api: apiClient({ token: env.CONVEX_PREVIEW_CONTROL_KEY,
      service: 'Convex', base: 'https://api.convex.dev/v1' }) }),
  })
  if (args[0] === 'inventory') {
    const numbers = await controller.inventory()
    console.log(JSON.stringify(numbers))
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `numbers=${JSON.stringify(numbers)}\n`)
    return
  }
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {}
  const number = args[0] || event.pull_request?.number || event.inputs?.pr_number
  await controller.run(number)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
