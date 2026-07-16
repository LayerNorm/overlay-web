import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = required('P7_UI_QA_URL').replace(/\/$/, '')
const storageState = path.resolve(required('P7_UI_QA_STORAGE_STATE'))
const profile = process.env.P7_UI_QA_PROFILE ?? 'institution'
const expectAdmin = process.env.P7_UI_QA_EXPECT_ADMIN === '1'
if (!['billing-disabled', 'institution', 'stripe'].includes(profile)) {
  throw new Error('P7_UI_QA_PROFILE must be billing-disabled, institution, or stripe')
}
await access(storageState)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ storageState })
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl })
const page = await context.newPage()
const convexTraffic = new Set<string>()
const pageErrors: string[] = []

context.on('request', (request) => {
  if (isConvex(request.url())) convexTraffic.add(request.url())
})
context.on('websocket', (socket) => {
  if (isConvex(socket.url())) convexTraffic.add(socket.url())
})
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  const session = await context.request.get(`${baseUrl}/api/auth/session`)
  assert.equal(session.ok(), true)
  assert.equal((await session.json() as { authenticated: boolean }).authenticated, true)

  const capabilitiesResponse = await context.request.get(`${baseUrl}/api/v1/capabilities`)
  assert.equal(capabilitiesResponse.ok(), true)
  const capabilities = await capabilitiesResponse.json() as {
    capabilities: { billing?: boolean; apiKeys?: boolean }
    appDataCapabilities: { provider?: string; requiresConvexClient?: boolean; supportsApiKeys?: boolean }
  }
  assert.equal(capabilities.appDataCapabilities.provider, 'postgres')
  assert.equal(capabilities.appDataCapabilities.requiresConvexClient, false)
  assert.equal(capabilities.appDataCapabilities.supportsApiKeys, true)

  await page.goto(`${baseUrl}/app/settings?section=account`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('api-key-settings').waitFor()
  if (profile === 'stripe') {
    assert.equal(capabilities.capabilities.billing, true)
  } else {
    assert.equal(capabilities.capabilities.billing, false)
    await page.getByText('This deployment does not use Overlay-managed billing.').waitFor()
  }

  const keyName = `P7 QA ${Date.now()}`
  await page.getByLabel('API key name').fill(keyName)
  await page.getByRole('button', { name: 'Create key' }).click()
  const revealed = page.getByTestId('revealed-api-key')
  await revealed.waitFor()
  assert.match((await revealed.textContent()) ?? '', /^ovl_sk_/)
  await page.getByRole('button', { name: 'Copy API key' }).click()

  const secondTab = await context.newPage()
  await secondTab.goto(`${baseUrl}/app/settings?section=account`, { waitUntil: 'domcontentloaded' })
  await secondTab.getByText(keyName).waitFor()
  await secondTab.close()

  await page.getByRole('button', { name: `Rotate ${keyName}` }).click()
  await page.getByTestId('revealed-api-key').waitFor()
  await page.getByRole('button', { name: `Revoke ${keyName}` }).click()
  await page.getByText(/revoked/).waitFor()

  const expired = await context.request.post(`${baseUrl}/api/v1/api-keys`, {
    data: { expiresAt: Date.now() - 1, scopes: ['chat:read'] },
  })
  assert.equal(expired.status(), 400)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('api-key-settings').waitFor()

  await page.goto(`${baseUrl}/app/admin`, { waitUntil: 'domcontentloaded' })
  if (expectAdmin) {
    await page.getByTestId('admin-console').waitFor()
    await page.getByTestId('admin-usage').waitFor()
    await page.getByTestId('admin-audit').waitFor()
  } else {
    await page.getByTestId('admin-forbidden').waitFor()
  }

  assert.deepEqual([...convexTraffic], [], `Convex traffic detected: ${[...convexTraffic].join(', ')}`)
  assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(' | ')}`)

  console.log(JSON.stringify({
    admin: expectAdmin,
    baseUrl,
    convexRequests: 0,
    keyLifecycle: ['create', 'copy', 'second-tab', 'rotate', 'revoke', 'expiry-rejected'],
    ok: true,
    profile,
  }, null, 2))
} finally {
  await context.close()
  await browser.close()
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function isConvex(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'convex.cloud' || hostname.endsWith('.convex.cloud') ||
      hostname === 'convex.site' || hostname.endsWith('.convex.site')
  } catch {
    return false
  }
}
