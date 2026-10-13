#!/usr/bin/env node
import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { apiClient } from './preview-control.mjs'
import { STAGING, StagingController, candidateOrigin, revision, stagingDeploymentMatches } from './staging-control.mjs'
import { smokeCandidate } from './staging-smoke.mjs'

export const SMOKE_CHECKS = Object.freeze(['authenticatedSandboxIdentity', 'dedicatedFixture',
  'noteCrudAndStaleEdit', 'noteCleanup', 'realChatReply', 'filesUi'])

export function verifiedSmoke(value, sha) {
  smokeCandidate(value, sha)
  if (value.smoke !== 'passed' || !/^\d+$/.test(value.runId ?? '')
    || !SMOKE_CHECKS.every(name => value.checks?.[name] === true)) {
    throw new Error('Authenticated smoke evidence is incomplete')
  }
  return value
}

/** Candidate publication occurs in the same serialized, trusted main job. */
export async function publish({ env = process.env, github, vercel, evidence }) {
  if (env.GITHUB_REPOSITORY !== STAGING.repository || env.GITHUB_REF !== 'refs/heads/main'
    || env.STAGING_ISOLATION_VERIFIED !== 'enabled') {
    throw new Error('Candidate publication requires protected main and verified provider isolation')
  }
  const sha = revision(env.GITHUB_SHA), candidate = verifiedSmoke(evidence, sha)
  assert.equal(candidate.published, false, 'Only an unpublished candidate can be cut over')
  assert.equal(candidate.runId, env.GITHUB_RUN_ID, 'Smoke must complete within the current serialized job')
  const controller = new StagingController({ github, vercel })
  await controller.verifyProject()
  assert.equal(await controller.currentMain(), sha, 'Main advanced before cutover')
  const deployment = await vercel(`/v13/deployments/${candidate.deploymentId}`)
  assert.ok(stagingDeploymentMatches(deployment, sha, { ready: true }))
  assert.equal(candidate.url, candidateOrigin(deployment))
  const before = await vercel(`/v4/aliases/${STAGING.hostname}`)
  assert.equal(before.projectId, STAGING.projectId)
  assert.equal(before.deployment?.id, candidate.previousDeploymentId, 'Canonical staging changed before cutover')
  await vercel(`/v2/deployments/${candidate.deploymentId}/aliases`, {
    method: 'POST', body: { alias: STAGING.hostname },
  })
  const after = await vercel(`/v4/aliases/${STAGING.hostname}`)
  assert.equal(after.projectId, STAGING.projectId)
  assert.equal(after.deployment?.id, candidate.deploymentId, 'Cutover alias readback failed')
  assert.equal(await controller.currentMain(), sha, 'Main advanced during cutover')
  const result = { ...candidate, candidateUrl: candidate.url, url: STAGING.origin,
    published: true, smoke: 'pending' }
  await controller.status(sha, 'success', `READY ${sha.slice(0, 12)}; verify canonical staging smoke`, STAGING.origin)
  return result
}

export async function main(env = process.env) {
  const result = await publish({ env,
    github: apiClient({ token: env.GITHUB_TOKEN, service: 'GitHub', base: 'https://api.github.com' }),
    vercel: apiClient({ token: env.VERCEL_STAGING_TOKEN, service: 'Vercel', base: 'https://api.vercel.com', teamId: STAGING.teamId }),
    evidence: JSON.parse(readFileSync('staging-smoke.json', 'utf8')),
  })
  writeFileSync('staging-deployment.json', JSON.stringify(result, null, 2))
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'published=true\n')
  console.log(JSON.stringify(result))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Candidate publication failed; canonical staging is not promotion evidence'); process.exitCode = 1 })
}
