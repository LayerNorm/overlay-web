#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { apiClient } from './preview-control.mjs'
import { STAGING, StagingController, candidateOrigin, revision, stagingDeploymentMatches } from './staging-control.mjs'
import { probeReactiveQueries, browserRuntimeErrors } from './reactive-smoke.mjs'

export function smokeCandidate(value, sha) {
  revision(sha)
  if (value.state !== 'ready' || value.sha !== sha || value.projectId !== STAGING.projectId
    || value.backend !== STAGING.backend || value.backendUrl !== STAGING.backendUrl
    || (value.published === false
      ? !/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(value.url ?? '') || !/^dpl_[A-Za-z0-9]+$/.test(value.previousDeploymentId ?? '')
      : value.url !== STAGING.origin)
    || !/^dpl_[A-Za-z0-9]+$/.test(value.deploymentId ?? '')) {
    throw new Error('Smoke requires the exact dedicated staging deployment artifact')
  }
  return value
}

/** Runs inside the staging release job's lock, from reviewed main only. */
export async function runSmoke({ env = process.env, github, vercel, launch, report = console.log,
  artifact, probeRealtime = probeReactiveQueries,
  saveEvidence = evidence => writeFileSync('staging-smoke.json', JSON.stringify(evidence, null, 2)) }) {
  if (env.GITHUB_REPOSITORY !== STAGING.repository || env.GITHUB_REF !== 'refs/heads/main'
    || env.STAGING_SMOKE_EMAIL !== 'overlay-preview-qa@getoverlay.io' || !env.STAGING_SMOKE_PASSWORD
    || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')) {
    throw new Error('Configure the synthetic staging identity on protected main')
  }
  const sha = revision(env.GITHUB_SHA)
  const candidate = smokeCandidate(artifact ?? JSON.parse(readFileSync('staging-deployment.json', 'utf8')), sha)
  const controller = new StagingController({ github, vercel, report })
  await controller.verifyProject()
  async function verify() {
    assert.equal(await controller.currentMain(), sha, 'Main advanced during staging smoke')
    const d = await vercel(`/v13/deployments/${candidate.deploymentId}`)
    assert.ok(stagingDeploymentMatches(d, sha, { ready: true }), 'Staging deployment provenance changed')
    if (candidate.published === false) assert.equal(candidate.url, candidateOrigin(d), 'Candidate origin mismatch')
    const alias = await vercel(`/v4/aliases/${STAGING.hostname}`)
    assert.equal(alias.projectId, STAGING.projectId)
    assert.equal(alias.deployment?.id, candidate.published === false ? candidate.previousDeploymentId : candidate.deploymentId,
      'Staging alias changed')
  }
  const status = (state, description) => github(`/repos/${STAGING.repository}/statuses/${sha}`, {
    method: 'POST', body: { context: 'Staging Smoke', state, description, target_url: STAGING.origin },
  })
  await verify()
  await status('pending', 'Authenticated staging smoke running on the accepted main SHA')
  let browser
  let phase = 'browser setup'
  try {
    const project = await vercel(`/v9/projects/${STAGING.projectId}`)
    const bypass = Object.entries(project.protectionBypass ?? {}).find(([, v]) => v.scope === 'automation-bypass')?.[0]
    browser = await launch()
    const context = await browser.newContext({ baseURL: candidate.url,
      extraHTTPHeaders: { origin: candidate.url, ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) } })
    phase = 'sandbox sign-in'
    const login = await context.request.post('/api/auth/sign-in', {
      data: { email: env.STAGING_SMOKE_EMAIL, password: env.STAGING_SMOKE_PASSWORD },
    })
    assert.equal(login.status(), 200, 'Synthetic staging sign-in failed')
    const identity = await login.json()
    assert.equal(identity.success, true)
    assert.equal(identity.user?.id, 'user_01M4R1EKTMDZ4E6BQ5DMZXD0F2')
    phase = 'notes and fixture'
    const notes = await context.request.get('/api/v1/notes')
    assert.equal(notes.status(), 200)
    const fixture = (await notes.json()).data.find(n => n.title === 'Staging note')
    assert.ok(fixture, 'Dedicated staging fixture missing')
    let probeId
    try {
      const create = await context.request.post('/api/v1/notes', { data: {
        title: `Release smoke ${sha.slice(0, 12)}`, content: 'Before smoke edit',
      } })
      assert.equal(create.status(), 200)
      probeId = (await create.json()).id
      assert.ok(probeId)
      const beforeResponse = await context.request.get('/api/v1/notes?noteId=' + probeId)
      assert.equal(beforeResponse.status(), 200)
      const before = await beforeResponse.json()
      const edit = await context.request.patch('/api/v1/notes', { data: {
        noteId: probeId, content: 'Accepted smoke edit', expectedUpdatedAt: before.updatedAt,
      } })
      assert.equal(edit.status(), 200)
      const stale = await context.request.patch('/api/v1/notes', { data: {
        noteId: probeId, content: 'Stale smoke edit', expectedUpdatedAt: before.updatedAt,
      } })
      assert.equal(stale.status(), 409)
      const after = await context.request.get('/api/v1/notes?noteId=' + probeId)
      assert.equal(after.status(), 200)
      assert.equal((await after.json()).content, 'Accepted smoke edit')
    } finally {
      if (probeId) {
        assert.equal((await context.request.delete('/api/v1/notes?noteId=' + probeId)).status(), 200)
        const remaining = await context.request.get('/api/v1/notes')
        assert.equal(remaining.status(), 200)
        assert.ok(!(await remaining.json()).data.some(n => n._id === probeId), 'Smoke note cleanup failed')
      }
    }
    phase = 'real chat reply'
    const page = await context.newPage()
    const verifyRuntime = browserRuntimeErrors(page)
    await page.goto('/app/chat', { waitUntil: 'domcontentloaded' })
    const composer = page.locator('textarea')
    await composer.waitFor({ state: 'visible', timeout: 60_000 })
    assert.equal(await composer.count(), 1)
    const replies = page.getByText('RELEASE_SMOKE_OK', { exact: true })
    const previousReplies = await replies.count()
    await composer.fill('Reply with exactly RELEASE_SMOKE_OK. Do not use tools.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await replies.nth(previousReplies).waitFor({ state: 'visible', timeout: 90_000 })
    await page.screenshot({ path: 'staging-smoke-chat.png' })
    phase = 'files interface'
    await page.goto(`/app/w/staging-personal-${identity.user.id}/files`, { waitUntil: 'domcontentloaded' })
    await page.getByText('Staging note', { exact: true }).waitFor({ state: 'visible', timeout: 60_000 })
    await page.screenshot({ path: 'staging-smoke-files.png' })
    phase = 'realtime authorization'
    const tokenResponse = await context.request.get('/api/auth/convex-token')
    assert.equal(tokenResponse.status(), 200)
    await probeRealtime({ backendUrl: candidate.backendUrl, userId: identity.user.id,
      token: (await tokenResponse.json()).token, workspaceId: 'staging-personal-' + identity.user.id })
    verifyRuntime()
    phase = 'final provenance'
    await verify()
    const evidence = { ...candidate, smoke: 'passed', runId: env.GITHUB_RUN_ID,
      checks: { authenticatedSandboxIdentity: true, dedicatedFixture: true,
        noteCrudAndStaleEdit: true, noteCleanup: true, realChatReply: true, filesUi: true,
        realtimeAuthorization: true } }
    saveEvidence(evidence)
    await status('success', `Authenticated smoke passed for ${sha.slice(0, 12)}`)
    report(JSON.stringify(evidence))
    return evidence
  } catch (error) {
    // Browser request exceptions may contain auth headers. Log the controlled
    // phase only, never the raw exception or credential-bearing request data.
    report(JSON.stringify({ state: 'failed', sha, phase }))
    await status('failure', 'Staging smoke failed; this revision is not promotion evidence')
    throw error
  } finally { if (browser) await browser.close() }
}

export async function main(env = process.env) {
  const { chromium } = await import('playwright')
  return runSmoke({ env,
    github: apiClient({ token: env.GITHUB_TOKEN, service: 'GitHub', base: 'https://api.github.com' }),
    vercel: apiClient({ token: env.VERCEL_STAGING_TOKEN, service: 'Vercel', base: 'https://api.vercel.com', teamId: STAGING.teamId }),
    launch: () => chromium.launch({ headless: true }),
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Staging smoke failed; consult the failed assertion in trusted diagnostics'); process.exitCode = 1 })
}
