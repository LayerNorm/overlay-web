import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.ON_PREM_SMOKE_URL?.trim().replace(/\/$/, '')
const storageState = process.env.ON_PREM_SMOKE_STORAGE_STATE?.trim()
const expectAuthenticated = process.env.ON_PREM_SMOKE_EXPECT_AUTHENTICATED !== '0'
const paths = (process.env.ON_PREM_SMOKE_PATHS ?? '/app/chat,/app/files,/app/settings')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

if (!baseUrl) {
  throw new Error('ON_PREM_SMOKE_URL is required, for example https://overlay-onprem.example.com')
}
if (expectAuthenticated && !storageState) {
  throw new Error(
    'ON_PREM_SMOKE_STORAGE_STATE is required for the authenticated smoke. ' +
    'Set ON_PREM_SMOKE_EXPECT_AUTHENTICATED=0 only for the weaker signed-out check.',
  )
}
async function main(): Promise<void> {
  if (storageState) await access(path.resolve(storageState))

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({
    storageState: storageState ? path.resolve(storageState) : undefined,
  })
  const page = await context.newPage()
  const convexConnections = new Set<string>()
  const pageErrors: string[] = []

  page.on('request', (request) => {
    if (isConvexNetworkUrl(request.url())) convexConnections.add(request.url())
  })
  page.on('websocket', (socket) => {
    if (isConvexNetworkUrl(socket.url())) convexConnections.add(socket.url())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  try {
    const sessionResponse = await context.request.get(`${baseUrl}/api/auth/session`)
    assert.equal(sessionResponse.ok(), true, `Session endpoint returned ${sessionResponse.status()}`)
    const session = await sessionResponse.json() as { authenticated?: boolean }
    assert.equal(
      session.authenticated,
      expectAuthenticated,
      expectAuthenticated
        ? 'The supplied browser state is not authenticated.'
        : 'The signed-out smoke unexpectedly reused an authenticated session.',
    )

    const capabilitiesResponse = await context.request.get(`${baseUrl}/api/v1/capabilities`)
    assert.equal(
      capabilitiesResponse.ok(),
      true,
      `Capabilities endpoint returned ${capabilitiesResponse.status()}`,
    )
    const capabilities = await capabilitiesResponse.json() as {
      appDataCapabilities?: { provider?: string; requiresConvexClient?: boolean }
    }
    assert.equal(capabilities.appDataCapabilities?.provider, 'postgres')
    assert.equal(capabilities.appDataCapabilities?.requiresConvexClient, false)

    for (const routePath of paths) {
      const response = await page.goto(new URL(routePath, baseUrl).toString(), {
        waitUntil: 'domcontentloaded',
      })
      assert.ok(response, `No document response for ${routePath}`)
      assert.ok(response.status() < 500, `${routePath} returned ${response.status()}`)
      await page.waitForTimeout(1_500)

      if (expectAuthenticated) {
        assert.equal(
          new URL(page.url()).pathname.startsWith('/auth/'),
          false,
          `${routePath} redirected to authentication`,
        )
      }
    }

    assert.deepEqual(
      [...convexConnections],
      [],
      `Postgres browser flow opened Convex connections: ${[...convexConnections].join(', ')}`,
    )
    assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join(' | ')}`)

    console.log(JSON.stringify({
      authenticated: expectAuthenticated,
      baseUrl,
      checkedPaths: paths,
      convexConnections: 0,
      ok: true,
    }, null, 2))
  } finally {
    await context.close()
    await browser.close()
  }
}

function isConvexNetworkUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'convex.cloud' ||
      hostname.endsWith('.convex.cloud') ||
      hostname === 'convex.site' ||
      hostname.endsWith('.convex.site')
  } catch {
    return false
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
