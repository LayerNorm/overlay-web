import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import type { DesktopBridge } from '../packages/overlay-desktop-bridge/src/index'

declare global {
  interface Window {
    overlayDesktop: DesktopBridge
  }
}
let server: Server, app: ElectronApplication, page: Page, profile: string, origin: string
let signedIn = true
let transcriptionReferer: string | undefined

test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/api/auth/session') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ authenticated: signedIn }))
      return
    }
    if (request.url === '/api/v1/transcribe') {
      transcriptionReferer = request.headers.referer
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ text: 'Fixture transcript' }))
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end(
      '<!doctype html><html><head><title>Overlay</title></head><body><h1>Bridge fixture</h1><iframe src="about:blank"></iframe></body></html>'
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  profile = mkdtempSync(join(tmpdir(), 'overlay-bridge-qa-'))
  app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, APP_SERVER_URL: origin }
  })
  page = await app.firstWindow()
  await expect
    .poll(() =>
      app
        .windows()
        .find((win) => win.url().startsWith(origin))
        ?.url()
    )
    .toContain('/app/work')
  page = app.windows().find((win) => win.url().startsWith(origin))!
  await page.waitForLoadState('domcontentloaded')
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  rmSync(profile, { recursive: true, force: true })
})

test('the actual sandboxed preload exposes a versioned bridge and no Node or legacy API', async () => {
  const result = await page.evaluate(async () => ({
    info: await window.overlayDesktop.handshake(),
    node: typeof (window as unknown as { require?: unknown }).require,
    legacy: 'overlay' in window || 'electron' in window,
    recorder: 'recorder' in window
  }))
  expect(result.info.bridgeVersion).toBe(1)
  expect(result.info.capabilities).toContain('agentHost')
  expect(result.node).toBe('undefined')
  expect(result.legacy).toBe(false)
  expect(result.recorder).toBe(false)
  const child = page.frames().find((frame) => frame !== page.mainFrame())!
  expect(await child.evaluate(() => 'overlayDesktop' in window)).toBe(false)
})
test('unknown methods and invalid native arguments are rejected in the main process', async () => {
  const failures = await page.evaluate(async () => {
    const call = window.overlayDesktop.call as (method: string, input: unknown) => Promise<unknown>
    const requests = [
      ['unknown', undefined],
      ['window.setBadgeCount', { count: -1 }],
      ['window.openExternal', { url: 'file:///etc/passwd' }],
      ['panels.show', { kind: 'browser' }]
    ] as const
    return Promise.all(
      requests.map(async ([method, input]) => {
        try {
          await call(method, input)
          return false
        } catch {
          return true
        }
      })
    )
  })
  expect(failures).toEqual([true, true, true, true])
})
test('cloud dictation retains the calling window workspace route', async () => {
  await page.goto(origin + '/w/paid-qa/personal/chat')
  const result = await page.evaluate(() =>
    window.overlayDesktop.call('transcription.transcribe', {
      audio: new Uint8Array([1, 2, 3]),
      mime: 'audio/wav',
      model: 'cloud'
    })
  )
  expect(result.text).toBe('Fixture transcript')
  expect(transcriptionReferer).toBe(origin + '/w/paid-qa/personal/chat')
  await page.goto(origin + '/app/work')
})
test('panels load web routes with the same cookie partition, and sign-out stops native state', async () => {
  await app.evaluate(async ({ session }) => {
    await session
      .fromPartition('persist:overlay')
      .cookies.set({ url: process.env.APP_SERVER_URL!, name: 'qa-partition', value: 'shared' })
  })
  await page.evaluate(() => window.overlayDesktop.call('panels.show', { kind: 'chat' }))
  await expect
    .poll(() =>
      app
        .windows()
        .find((win) => win.url().includes('surface=panel'))
        ?.url()
    )
    .toContain('/app/chat?surface=panel')
  const panel = app.windows().find((win) => win.url().includes('surface=panel'))!
  expect(await panel.evaluate(() => document.cookie)).toContain('qa-partition=shared')
  expect((await panel.evaluate(() => window.overlayDesktop.handshake())).surface).toBe('panel')
  // Chat replaces its URL after creating a conversation. Surface identity survives
  // both that navigation and reload, independently of the URL query string.
  await panel.goto(origin + '/app/chat?id=fixture-conversation')
  expect((await panel.evaluate(() => window.overlayDesktop.handshake())).surface).toBe('panel')
  await panel.evaluate(() =>
    window.overlayDesktop.call('panels.setDocked', { kind: 'chat', edge: 'right' })
  )
  await page.evaluate(() => window.overlayDesktop.call('auth.signedOut', undefined))
  expect(panel.isClosed()).toBe(true)
  signedIn = false
  const denied = await page.evaluate(async () => {
    try {
      await window.overlayDesktop.call('panels.show', { kind: 'chat' })
      return false
    } catch {
      return true
    }
  })
  expect(denied).toBe(true)
})
test('offline fallback has no bridge and retries the pinned server', async () => {
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await page.reload().catch(() => {})
  await expect(page.getByRole('heading', { name: "Can't reach Overlay" })).toBeVisible()
  expect(await page.evaluate(() => 'overlayDesktop' in window)).toBe(false)
  expect(await page.evaluate(() => 'recorder' in window)).toBe(false)
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  await page.getByRole('link', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: 'Bridge fixture' })).toBeVisible()
  expect((await page.evaluate(() => window.overlayDesktop.handshake())).bridgeVersion).toBe(1)
})
test('sign-out delivers cancellation once and unsubscribe detaches the listener', async () => {
  const received = await page.evaluate(async () => {
    let cancelled = 0
    const off = window.overlayDesktop.on('transcription.cancel', () => cancelled++)
    await window.overlayDesktop.call('auth.signedOut', undefined)
    await new Promise((resolve) => setTimeout(resolve, 25))
    off()
    await window.overlayDesktop.call('auth.signedOut', undefined)
    await new Promise((resolve) => setTimeout(resolve, 25))
    return cancelled
  })
  expect(received).toBe(1)
})
test('event unsubscribe stops delivery and a foreign top frame receives no bridge', async () => {
  const count = await page.evaluate(async () => {
    let calls = 0
    const off = window.overlayDesktop.on('window.focus', () => calls++)
    off()
    off()
    return calls
  })
  expect(count).toBe(0)
  await page.goto('data:text/html,<title>Untrusted</title><h1>Untrusted</h1>')
  expect(await page.evaluate(() => 'overlayDesktop' in window)).toBe(false)
})

test('quitting with an open floating panel exits the native app', async () => {
  signedIn = true
  await page.goto(origin + '/app/work')
  await page.evaluate(() => window.overlayDesktop.call('panels.show', { kind: 'chat' }))
  await expect
    .poll(() => app.windows().some((win) => win.url().includes('surface=panel')))
    .toBe(true)
  const closed = app.waitForEvent('close', { timeout: 10_000 })
  await app.evaluate(({ app: nativeApp }) => nativeApp.quit())
  await closed
})
