#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { CONFIG, PreviewBackends, apiClient, deploymentMatches, previewAddress, previewBackendClient,
  previewRequested, trustedPull } from './preview-control.mjs'

export function recoveryInput({ number, fixture, availableCents, requestId }) {
  previewAddress(number)
  if (!['personal', 'paid-workspace', 'computer-workspace', 'exhausted-workspace'].includes(fixture)) throw new Error('Unknown Preview fixture')
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(requestId ?? '')) throw new Error('Recovery requires a unique non-secret request ID')
  const paid = ['paid-workspace', 'computer-workspace'].includes(fixture)
  if (!paid && availableCents !== undefined) throw new Error('Free recovery cannot grant paid credit')
  if (paid && (!Number.isSafeInteger(availableCents) || availableCents < 0 || availableCents > 5000)) {
    throw new Error('Synthetic available credit must be from 0 to 5000 cents')
  }
  return { number, fixture, requestId, ...(paid ? { availableCents } : {}) }
}

export class PreviewFixtureRecovery {
  constructor({ github, vercel, backends, authorize, invoke }) {
    Object.assign(this, { github, vercel, backends, authorize, invoke })
  }
  async run(input) {
    const args = recoveryInput(input)
    const pull = async () => trustedPull(await this.github(`/repos/${CONFIG.repository}/pulls/${args.number}`))
    const pr = await pull()
    if (pr.state !== 'open' || !previewRequested(pr)) throw new Error('Recovery requires an open needs-preview PR')
    const backend = await this.backends.find(args.number)
    if (!backend) throw new Error('Recovery requires an owned Preview backend')
    new PreviewBackends({ api: null }).validate(backend, args.number)
    const alias = await this.vercel(`/v4/aliases/${previewAddress(args.number).hostname}`)
    if (alias.projectId !== CONFIG.projectId || !alias.deployment?.id) throw new Error('Recovery alias ownership mismatch')
    const deployment = await this.vercel(`/v13/deployments/${encodeURIComponent(alias.deployment.id)}`)
    if (!deploymentMatches(deployment, pr, { ready: true })) throw new Error('Recovery requires the current-head READY Preview')
    const auth = await this.authorize({ number: args.number, backend })
    if (auth.deploymentType !== 'preview' || auth.deploymentName !== backend.name
      || auth.url !== `https://${backend.name}.convex.cloud` || typeof auth.adminKey !== 'string' || !auth.adminKey) {
      throw new Error('Recovery authorization target mismatch')
    }
    const latest = await pull()
    if (latest.state !== 'open' || !previewRequested(latest) || latest.head.sha !== pr.head.sha) throw new Error('Preview changed before recovery')
    const { number, ...operation } = args
    const result = await this.invoke(auth, operation)
    if (typeof result?.applied !== 'boolean') throw new Error('Invalid recovery result')
    // Never print arbitrary remote return fields or function logs.
    return { number, fixture: args.fixture, applied: result.applied }
  }
}

async function postJson(url, headers, body, fetchImpl) {
  let response
  try { response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }) }
  catch { throw new Error('Preview recovery request failed') }
  if (!response.ok) throw new Error(`Preview recovery API ${response.status}`)
  try { return await response.json() } catch { throw new Error('Invalid Preview recovery response') }
}

export async function main(env = process.env, fetchImpl = fetch) {
  if (env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_REPOSITORY !== CONFIG.repository) throw new Error('Recovery runs only from trusted main')
  const backendApi = previewBackendClient(env.CONVEX_PREVIEW_CONTROL_KEY, { fetchImpl })
  const number = Number(env.PR_NUMBER)
  if (!/^[1-9]\d*$/.test(env.PR_NUMBER ?? '')) throw new Error('Invalid PR number')
  const fixture = env.QA_FIXTURE
  const paid = ['paid-workspace', 'computer-workspace'].includes(fixture)
  const supplied = env.QA_AVAILABLE_CENTS?.trim()
  if (supplied && !/^(0|[1-9]\d*)$/.test(supplied)) throw new Error('Invalid synthetic available cents')
  const availableCents = supplied ? Number(supplied) : paid ? 1000 : undefined
  const requestId = env.QA_REQUEST_ID?.trim() || `gha-${env.GITHUB_RUN_ID}`
  if (!env.QA_REQUEST_ID?.trim() && !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')) throw new Error('Recovery request ID is missing')
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'))
  const version = lock.packages['node_modules/convex']?.version
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Pinned Convex client version is missing')
  const controller = new PreviewFixtureRecovery({
    github: apiClient({ token: env.GITHUB_TOKEN, service: 'GitHub', base: 'https://api.github.com', fetchImpl }),
    vercel: apiClient({ token: env.VERCEL_PREVIEW_TOKEN, service: 'Vercel', base: 'https://api.vercel.com', teamId: CONFIG.teamId, fetchImpl }),
    backends: new PreviewBackends({ api: backendApi }),
    authorize: async ({ number }) => await postJson('https://api.convex.dev/api/deployment/authorize_preview', {
      authorization: `Bearer ${env.CONVEX_PREVIEW_CONTROL_KEY}`, 'Convex-Client': `npm-cli-${version}`,
    }, { previewName: `pr-${number}`, projectSelection: { kind: 'teamAndProjectSlugs',
      teamSlug: 'divyansh-lalwani-37bb7', projectSlug: 'overlay' } }, fetchImpl),
    invoke: async (auth, args) => {
      const response = await postJson(`${auth.url}/api/function`, { authorization: `Convex ${auth.adminKey}` },
        { path: 'dev/qa:recover', format: 'convex_encoded_json', args }, fetchImpl)
      if (response.status !== 'success') throw new Error('Preview fixture recovery rejected; inspect the selected fixture state')
      return response.value
    },
  })
  return await controller.run({ number, fixture, availableCents, requestId })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await main())) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
