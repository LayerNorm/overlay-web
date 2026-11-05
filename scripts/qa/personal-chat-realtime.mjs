import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'
import { measureInteraction, openIndependentClients, previewOrigin, previewPath } from './realtime-baseline.mjs'

const origin = previewOrigin(process.env.CN01_PREVIEW_ORIGIN)
const path = previewPath(process.env.CN01_CHAT_PATH)
const revision = process.env.CN01_PREVIEW_SHA
if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('Verified current Preview SHA is required')
if (!process.env.CN01_STORAGE_STATE) throw new Error('Private sandbox storage-state file is required')
const scenario = process.env.CN01_SCENARIO ?? 'send'
if (!['send', 'rename', 'archive'].includes(scenario)) throw new Error('Unknown scenario')
const title = process.env.CN01_CHAT_TITLE
if (!title?.startsWith('CN01 QA ')) throw new Error('Use a disposable personal chat named CN01 QA ...')

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
})
let clients
try {
  clients = await openIndependentClients(browser, { origin, path, storageState: process.env.CN01_STORAGE_STATE })
  const [sender, observer] = clients.pages
  const timeout = 30_000
  const row = (page, name) => page.locator('[data-slot="sidebar-menu-sub-item"]').filter({ has: page.getByText(name, { exact: true }) })
  for (const page of clients.pages) {
    if (await row(page, title).count() !== 1) throw new Error('Expected exactly one disposable personal chat row')
    await row(page, title).waitFor({ state: 'visible', timeout })
    await row(page, title).locator('[aria-current="page"]').waitFor({ state: 'visible', timeout })
    if (await row(page, title).getByRole('button', { name: 'Rename chat', exact: true }).count() !== 1) {
      throw new Error('Fixture must be a personal chat')
    }
  }
  let result
  if (scenario === 'send') {
    const prompt = `Reply with only OK. Realtime QA ${randomUUID()}`
    const message = (page) => page.getByText(prompt, { exact: true })
    for (const page of clients.pages) {
      if (await message(page).count()) throw new Error('Message already exists')
      if (await page.getByRole('button', { name: 'Stop generating', exact: true }).count()) throw new Error('A run is already active')
    }
    await sender.getByPlaceholder('Ask anything...', { exact: true }).fill(prompt)
    result = await measureInteraction({
      trigger: () => sender.getByRole('button', { name: 'Send message', exact: true }).click({ timeout }),
      observers: {
        localFeedback: () => message(sender).waitFor({ state: 'visible', timeout }),
        remoteVisible: () => message(observer).waitFor({ state: 'visible', timeout }),
      },
    })
    // Never resend, navigate, or cancel to hide a failed observation.
    await sender.getByRole('button', { name: 'Stop generating', exact: true }).waitFor({ state: 'hidden', timeout: 300_000 })
    result.uniqueRemoteMessage = await message(observer).count() === 1
  } else if (scenario === 'rename') {
    const newTitle = `CN01 QA ${randomUUID()}`
    await row(sender, title).getByRole('button', { name: 'Rename chat', exact: true }).click({ timeout })
    // The row text disappears during editing, so address the single sidebar editor.
    const editor = sender.locator('[data-slot="sidebar-menu-sub-item"]').getByRole('textbox', { name: 'Conversation title', exact: true })
    await editor.fill(newTitle)
    result = await measureInteraction({
      trigger: () => editor.press('Enter', { timeout }),
      observers: {
        localFeedback: () => row(sender, newTitle).waitFor({ state: 'visible', timeout }),
        remoteVisible: () => row(observer, newTitle).waitFor({ state: 'visible', timeout }),
        mutationAcknowledged: () => sender.waitForResponse((response) => {
          const url = new URL(response.url())
          return url.origin === origin && url.pathname === '/api/v1/conversations' && response.request().method() === 'PATCH' && response.ok()
        }, { timeout }),
      },
    })
  } else {
    result = await measureInteraction({
      trigger: () => row(sender, title).getByRole('button', { name: 'Archive chat', exact: true }).click({ timeout }),
      observers: {
        localFeedback: () => row(sender, title).waitFor({ state: 'hidden', timeout }),
        remoteVisible: () => row(observer, title).waitFor({ state: 'hidden', timeout }),
        mutationAcknowledged: () => sender.waitForResponse((response) => {
          const url = new URL(response.url())
          return url.origin === origin && /^\/api\/v1\/conversations\/[^/]+\/state$/.test(url.pathname)
            && response.request().method() === 'PATCH' && response.ok()
        }, { timeout }),
      },
    })
  }
  console.log(JSON.stringify({
    revision, scenario, queryReadyFromNavigationMs: clients.queryReady,
    ...result,
  }, null, 2))
  if (result.action !== 'completed'
    || ['localFeedback', 'remoteVisible'].some((stage) => result.stages[stage].status !== 'observed')
    || result.uniqueRemoteMessage === false) process.exitCode = 1
} catch {
  // Playwright errors can contain page text, URLs, cookies, or selectors.
  console.error('Realtime baseline setup or execution failed; inspect the private browser session. No sample accepted.')
  process.exitCode = 1
} finally {
  await clients?.close()
  await browser.close()
}
