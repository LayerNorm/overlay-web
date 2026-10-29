import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Drives the built app in web shell mode with a throwaway profile, so the run
// starts signed out and never touches the developer's own session.
// The real provider login in the system browser is the one manual step; the
// test stands in for the browser by stubbing openExternal and delivering the
// overlay:// transfer link itself.

const DEEP_LINK_TOKEN = 'ab'.repeat(16)

let app: ElectronApplication
let profileDir: string

async function webShellWindow(electronApp: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const page = electronApp.windows().find((win) => win.url().startsWith('https://'))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('The web shell window never loaded a remote page')
}

test.beforeAll(async () => {
  profileDir = mkdtempSync(join(tmpdir(), 'overlay-web-shell-e2e-'))
  app = await electron.launch({
    args: ['.', `--user-data-dir=${profileDir}`],
    env: { ...process.env, OVERLAY_WEB_SHELL: '1' }
  })
  await app.evaluate(({ shell, session }) => {
    const state = globalThis as unknown as { opened: string[]; completeHeaders: Record<string, string> | null }
    state.opened = []
    state.completeHeaders = null
    shell.openExternal = async (url: string) => {
      state.opened.push(url)
    }
    session.fromPartition('persist:overlay').webRequest.onBeforeSendHeaders(
      { urls: ['https://*/auth/desktop/complete*', 'http://localhost/auth/desktop/complete*'] },
      (details, callback) => {
        state.completeHeaders = details.requestHeaders
        callback({ requestHeaders: details.requestHeaders })
      }
    )
  })
})

test.afterAll(async () => {
  await app?.close()
  rmSync(profileDir, { recursive: true, force: true })
})

test('signed-out window shows the web app sign-in dialog with no preload bridge', async () => {
  const page = await webShellWindow(app)
  await expect(page).toHaveURL(/\/app/)
  const dialog = page.getByRole('dialog', { name: /sign in/i })
  await expect(dialog.getByRole('button', { name: /continue with google/i })).toBeVisible()
  expect(await page.evaluate(() => 'overlay' in window || 'electron' in window)).toBe(false)
})

test('Google sign-in opens the browser handoff, then the transfer link is redeemed in the window', async () => {
  const page = await webShellWindow(app)
  const origin = new URL(page.url()).origin
  const signInUrl = page.url()

  // The app cancels this navigation, so don't wait for it to finish.
  await page
    .getByRole('dialog', { name: /sign in/i })
    .getByRole('button', { name: /continue with google/i })
    .click({ noWaitAfter: true })

  // The window stays put and the browser handoff opens instead.
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.length))
    .toBe(1)
  expect(page.url()).toBe(signInUrl)
  const opened = await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened[0])
  const handoff = new URL(opened)
  expect(handoff.origin).toBe(origin)
  expect(handoff.pathname).toBe('/account')
  const challenge = handoff.searchParams.get('desktop_code_challenge') ?? ''
  expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)

  // Stand in for the browser: deliver the one-time transfer link.
  const link = `overlay://auth/transfer?token=${DEEP_LINK_TOKEN}&server=${encodeURIComponent(origin)}`
  await app.evaluate(({ app: electronApp }, url) => {
    electronApp.emit('open-url', { preventDefault: () => undefined }, url)
  }, link)

  // The window asks the server to redeem it, carrying the matching verifier.
  // This token was never issued, so the server answers with a sign-in error
  // (a real token would land on /app).
  await expect(page).toHaveURL(/\/auth\/sign-in\?error=desktop_sign_in_failed/)
  const headers = await app.evaluate(
    () => (globalThis as unknown as { completeHeaders: Record<string, string> | null }).completeHeaders
  )
  const verifier = headers?.['x-overlay-code-verifier'] ?? headers?.['X-Overlay-Code-Verifier'] ?? ''
  expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/)
  expect(createHash('sha256').update(verifier, 'ascii').digest('base64url')).toBe(challenge)
})
