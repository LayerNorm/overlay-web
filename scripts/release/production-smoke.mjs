import assert from 'node:assert/strict'
import { join } from 'node:path'
import { PRODUCTION, verifyProductionProject, verifyProductionLive } from './production-control.mjs'
import { browserRuntimeErrors, probeReactiveQueries } from './reactive-smoke.mjs'

/** Uses only a separately configured synthetic production account. No seed runs. */
export async function productionSmoke({ env, vercel, deployment, sha, launch,
  evidenceDirectory, probeRealtime = probeReactiveQueries, report = console.log }) {
  assert.ok(evidenceDirectory, 'An ignored evidence directory is required')
  assert.ok(env.PRODUCTION_SMOKE_EMAIL === 'overlay-release-qa@getoverlay.io'
    && env.PRODUCTION_SMOKE_PASSWORD && /^user_[A-Za-z0-9]+$/.test(env.PRODUCTION_SMOKE_USER_ID ?? '')
    && env.PRODUCTION_SMOKE_USER_ID !== 'user_01M4R1EKTMDZ4E6BQ5DMZXD0F2', 'Use the production QA identity')
  await verifyProductionProject(vercel)
  await verifyProductionLive(vercel, deployment, sha)
  let browser, context, probeId, phase = 'browser setup'
  try {
    browser = await launch()
    context = await browser.newContext({ baseURL: PRODUCTION.origin,
      extraHTTPHeaders: { origin: PRODUCTION.origin } })
    phase = 'production sign-in'
    const login = await context.request.post('/api/auth/sign-in', { data: {
      email: env.PRODUCTION_SMOKE_EMAIL, password: env.PRODUCTION_SMOKE_PASSWORD,
    } })
    assert.equal(login.status(), 200)
    const user = (await login.json()).user
    assert.equal(user?.id, env.PRODUCTION_SMOKE_USER_ID)
    phase = 'production note CRUD'
    const title = 'Release smoke ' + sha.slice(0, 12) + ' ' + Date.now()
    const created = await context.request.post('/api/v1/notes', { data: { title, content: 'Before smoke edit' } })
    assert.equal(created.status(), 200)
    probeId = (await created.json()).id
    assert.ok(probeId)
    const get = await context.request.get('/api/v1/notes?noteId=' + probeId)
    assert.equal(get.status(), 200)
    const before = await get.json()
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
    phase = 'production chat'
    const page = await context.newPage(), verifyRuntime = browserRuntimeErrors(page)
    await page.goto('/app/chat', { waitUntil: 'domcontentloaded' })
    const composer = page.getByRole('combobox', { name: /Ask anything/ })
    await composer.waitFor({ state: 'visible', timeout: 60_000 })
    assert.equal(await composer.count(), 1)
    const replies = page.getByText('RELEASE_SMOKE_OK', { exact: true })
    const previousReplies = await replies.count()
    await composer.fill('Reply with exactly RELEASE_SMOKE_OK. Do not use tools.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await replies.nth(previousReplies).waitFor({ state: 'visible', timeout: 90_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await replies.nth(previousReplies).waitFor({ state: 'visible', timeout: 60_000 })
    await page.screenshot({ path: join(evidenceDirectory, 'production-smoke-chat.png') })
    phase = 'production files'
    await page.goto('/app/files', { waitUntil: 'domcontentloaded' })
    await page.getByRole('main').getByRole('button', { name: title, exact: true }).waitFor({ state: 'visible', timeout: 60_000 })
    await page.screenshot({ path: join(evidenceDirectory, 'production-smoke-files.png') })
    phase = 'production realtime authorization'
    const token = await context.request.get('/api/auth/convex-token')
    assert.equal(token.status(), 200)
    await probeRealtime({ backendUrl: PRODUCTION.backendUrl, userId: user.id, token: (await token.json()).token })
    verifyRuntime()
    await verifyProductionLive(vercel, await vercel(`/v13/deployments/${deployment.id}`), sha)
    return { authenticatedIdentity: true, noteCrudAndStaleEdit: true,
      realChatReplyAndPersistence: true, filesUi: true, realtimeAuthorization: true }
  } catch (error) {
    report(JSON.stringify({ state: 'failed', sha, phase })) // No request headers, tokens, or raw browser exceptions.
    throw error
  } finally {
    try {
      if (probeId) {
        assert.equal((await context.request.delete('/api/v1/notes?noteId=' + probeId)).status(), 200)
        const remaining = await context.request.get('/api/v1/notes')
        assert.equal(remaining.status(), 200)
        assert.ok(!(await remaining.json()).data.some(n => n._id === probeId), 'Production smoke note cleanup failed')
      }
    } finally { await browser?.close() }
  }
}
