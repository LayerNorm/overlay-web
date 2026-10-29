#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { CONFIG, deploymentMatches, previewAddress, trustedPull } from './preview-control.mjs'

export function effectivePreviewEnvironment(envs, branch) {
  const selected = new Map()
  for (const specific of [false, true]) {
    const seen = new Set()
    for (const entry of envs) {
      if (!entry.target?.includes('preview') || (specific ? entry.gitBranch !== branch : !!entry.gitBranch)) continue
      if (seen.has(entry.key)) throw new Error('Ambiguous Preview setting: ' + entry.key)
      seen.add(entry.key)
      selected.set(entry.key, entry)
    }
  }
  return selected
}

export function capabilityConfiguration(settings) {
  const value = key => settings.get(key)?.value
  const enabled = key => ['true', '1'].includes(value(key))
  return [
    ['integrations', 'INTEGRATIONS', 'INTEGRATIONS', ['COMPOSIO_API_KEY']],
    ['sandbox', 'SANDBOXES', 'SANDBOX', []],
    ['web search', 'WEB_SEARCH', 'WEB_SEARCH', []],
    ['embeddings', 'VECTOR_SEARCH', 'EMBEDDINGS', []],
    ['billing', 'BILLING', null, ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']],
    ['email', 'TRANSACTIONAL_EMAIL', null, ['OVERLAY_EMAIL_FROM']],
    ['external agents', 'EXTERNAL_AGENTS', null, []],
    ['Computers', 'COMPUTERS', null, ['BOAT_API_KEY']],
  ].map(([capability, flag, provider, keys]) => {
    const missing = []
    if (!enabled('OVERLAY_FEATURE_' + flag)) missing.push('OVERLAY_FEATURE_' + flag)
    if (provider && (!value('OVERLAY_PROVIDER_' + provider) || value('OVERLAY_PROVIDER_' + provider) === 'none')) {
      missing.push('OVERLAY_PROVIDER_' + provider)
    }
    for (const key of keys) if (!settings.has(key)) missing.push(key)
    return { capability, configuration: missing.length ? 'incomplete' : 'present; live test required', missing }
  })
}

function readJson(command, args) {
  try {
    return JSON.parse(execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'] }))
  } catch {
    // CLI errors can contain server response bodies; do not echo captured output.
    throw new Error(command + ' read failed; check account access and explicit project scope')
  }
}

export async function diagnose(number, read = readJson) {
  previewAddress(number)
  const pr = trustedPull(read('gh', ['api', `repos/${CONFIG.repository}/pulls/${number}`]))
  if (pr.state !== 'open') throw new Error('Preview diagnosis requires an open main PR')
  const query = `teamId=${CONFIG.teamId}`
  const alias = read('vercel', ['api', `/v4/aliases/${previewAddress(number).hostname}?${query}`, '--method', 'GET'])
  const deployment = read('vercel', ['api', `/v13/deployments/${alias.deployment?.id}?${query}`, '--method', 'GET'])
  // Use the full REST response: connector summaries can truncate envs to 100.
  const result = read('vercel', ['api', `/v10/projects/${CONFIG.projectId}/env?${query}`, '--method', 'GET'])
  if (!Array.isArray(result.envs) || result.pagination?.next) throw new Error('Environment inventory is incomplete')
  const settings = effectivePreviewEnvironment(result.envs, pr.head.ref)
  const capabilities = capabilityConfiguration(settings)
  return {
    number, head: pr.head.sha, url: previewAddress(number).origin,
    deploymentId: deployment.id, currentHeadReady: deploymentMatches(deployment, pr, { ready: true })
      && alias.projectId === CONFIG.projectId,
    environmentCount: result.envs.length, capabilities,
    backendSelection: `divyansh-lalwani-37bb7:overlay:preview/pr-${number}`,
    requiredLiveChecks: ['browser protection and sandbox login', 'backend identity and callback settings',
      'provider calls and persistence', 'scheduled jobs', 'billing and webhook delivery', 'resource cleanup'],
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await diagnose(Number(process.argv[2]))
    console.log(JSON.stringify(report, null, 2))
    if (!report.currentHeadReady || (process.argv.includes('--require-full')
      && report.capabilities.some(c => c.configuration === 'incomplete'))) process.exitCode = 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
