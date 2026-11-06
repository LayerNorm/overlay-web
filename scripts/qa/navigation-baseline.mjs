import { stat } from 'node:fs/promises'
import { chromium } from 'playwright'
import { measureInteraction, openIndependentClients, previewOrigin, previewPath } from './realtime-baseline.mjs'

let browser
let clients
try {
  const origin = previewOrigin(process.env.CN01_PREVIEW_ORIGIN)
  const path = previewPath(process.env.CN01_START_PATH)
  const revision = process.env.CN01_PREVIEW_SHA
  const scenario = process.env.CN01_SCENARIO
  const name = process.env.CN01_FIXTURE_NAME
  const resourceId = process.env.CN01_RESOURCE_ID
  const sentinel = process.env.CN01_SENTINEL
  const storageState = process.env.CN01_STORAGE_STATE
  if (!/^[a-f0-9]{40}$/.test(revision ?? '') || !['open-thread', 'open-file'].includes(scenario)
    || !name?.startsWith('CN01 QA ') || !sentinel?.startsWith('CN01 QA ') || !resourceId) throw new Error('Invalid fixture')
  if (scenario === 'open-file' && !name.endsWith('.txt')) throw new Error('Use a synthetic plain-text fixture')
  if ((await stat(storageState)).mode & 0o077) throw new Error('Storage state must be private')
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  })
  clients = await openIndependentClients(browser, { origin, path, storageState, requirePersonalQueryReady: false })
  const timeout = 30_000
  const samples = []
  for (const page of clients.pages) {
    let trigger
    let feedback
    let content
    if (scenario === 'open-thread') {
      const row = page.locator('[data-slot="sidebar-menu-sub-item"]').filter({ has: page.getByText(name, { exact: true }) })
      await row.waitFor({ state: 'visible', timeout })
      if (await row.count() !== 1 || await row.locator('[aria-current="page"]').count()
        || await row.getByRole('button', { name: 'Rename chat', exact: true }).count() !== 1
        || await page.getByText(sentinel, { exact: true }).count()) throw new Error('Thread must not already be open')
      trigger = () => row.getByText(name, { exact: true }).click({ timeout })
      feedback = () => row.locator('[aria-current="page"]').waitFor({ state: 'visible', timeout })
      content = () => page.getByText(sentinel, { exact: true }).waitFor({ state: 'visible', timeout })
    } else {
      const file = page.locator('.overlay-knowledge-row').getByRole('button', { name, exact: true })
      await file.waitFor({ state: 'visible', timeout })
      const shell = page.locator('.overlay-file-viewer-panel, [aria-label="File title"]').first()
      if (await file.count() !== 1 || await shell.count()) throw new Error('File viewer must start closed')
      trigger = () => file.click({ timeout })
      feedback = () => shell.waitFor({ state: 'visible', timeout })
      content = () => page.waitForFunction((expected) => {
        const editors = [...document.querySelectorAll('[aria-label="File contents"]')]
        return editors.some((element) => element.value === expected)
          || [...document.querySelectorAll('pre')].some((element) => element.textContent?.trim() === expected)
      }, sentinel, { timeout })
    }
    const readAcknowledged = async () => {
      const response = await page.waitForResponse((response) => {
        const url = new URL(response.url())
        const thread = scenario === 'open-thread'
        return url.origin === origin && url.pathname === (thread ? '/api/v1/conversations' : '/api/v1/files')
          && url.searchParams.get(thread ? 'conversationId' : 'fileId') === resourceId
          && url.searchParams.get(thread ? 'messages' : 'fullText') === 'true'
          && response.request().method() === 'GET' && response.ok()
      }, { timeout })
      if (await response.finished()) throw new Error('Read did not finish')
    }
    samples.push(await measureInteraction({ trigger,
      stages: ['localFeedback', 'readAcknowledged', 'contentVisible'],
      observers: { localFeedback: feedback, readAcknowledged, contentVisible: content },
    }))
    if (new URL(page.url()).origin !== origin) throw new Error('Navigation left Preview')
  }
  console.log(JSON.stringify({ revision, scenario, samples }, null, 2))
  if (samples.some((sample) => sample.action !== 'completed'
    || Object.values(sample.stages).some((stage) => stage.status !== 'observed'))) process.exitCode = 1
} catch {
  console.error('Navigation baseline failed; no sample accepted and no private details recorded.')
  process.exitCode = 1
} finally {
  await clients?.close()
  await browser?.close()
}
