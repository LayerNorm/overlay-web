import assert from 'node:assert/strict'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Locator, type Page } from 'playwright'

const baseUrl = required('KNOWLEDGE_PROJECT_UI_QA_URL').replace(/\/$/, '')
const storageState = path.resolve(required('KNOWLEDGE_PROJECT_UI_QA_STORAGE_STATE'))
const artifactRoot = path.resolve(
  process.env.KNOWLEDGE_PROJECT_UI_QA_ARTIFACT_DIR?.trim()
    || 'output/playwright/knowledge-project-qa',
)
await access(storageState)
await mkdir(artifactRoot, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 960 } })
const page = await context.newPage()
const pageErrors: string[] = []
const serverErrors: string[] = []
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('response', (response) => {
  if (response.status() >= 500 && new URL(response.url()).origin === baseUrl) {
    serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`)
  }
})

let knowledgeBaseId: string | undefined
let sourceId: string | undefined
const suffix = Date.now()
const knowledgeTitle = `Knowledge UI QA ${suffix}`
const sourceTitle = `Lifecycle source ${suffix}`

try {
  const session = await context.request.get(`${baseUrl}/api/auth/session`)
  assert.equal(session.ok(), true, `Session endpoint returned ${session.status()}`)
  assert.equal((await session.json() as { authenticated?: boolean }).authenticated, true)

  const capabilities = await context.request.get(`${baseUrl}/api/v1/capabilities`)
  assert.equal(capabilities.ok(), true, `Capabilities endpoint returned ${capabilities.status()}`)
  assert.equal(
    (await capabilities.json() as { capabilities?: { knowledge?: boolean } }).capabilities?.knowledge,
    true,
  )

  const createdBase = await context.request.post(`${baseUrl}/api/v1/knowledge-bases`, {
    data: {
      description: 'Disposable corpus for browser lifecycle and visual-state QA.',
      kind: 'personal',
      title: knowledgeTitle,
    },
  })
  assert.equal(createdBase.status(), 201, `Knowledge base creation returned ${createdBase.status()}`)
  knowledgeBaseId = (await createdBase.json() as {
    knowledgeBase: { id: string }
  }).knowledgeBase.id

  const createdSource = await context.request.post(
    `${baseUrl}/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/sources`,
    {
      data: {
        content: 'The exact lifecycle marker is VISUAL-QA-742. It persists across refreshes.',
        mimeType: 'text/plain',
        title: sourceTitle,
      },
    },
  )
  assert.equal(createdSource.status(), 202, `Knowledge source creation returned ${createdSource.status()}`)
  sourceId = (await createdSource.json() as { source?: { id?: string } }).source?.id
  assert.ok(sourceId, 'Knowledge source creation did not return a source id')

  const workspaceUrl = `${baseUrl}/app/knowledge/${encodeURIComponent(knowledgeBaseId)}`
  await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded' })
  const sourceRow = page.getByTestId(`knowledge-source-${sourceId}`)
  await sourceRow.waitFor()

  const sourceListUrl = `${baseUrl}/api/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/sources`
  const simulatedStatuses = ['pending', 'indexing', 'ready'] as const
  let lifecycleResponse = 0
  await page.route(sourceListUrl, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const payload = await response.json() as {
      sources: Array<{ source: { id: string; status: string } }>
    }
    const status = simulatedStatuses[Math.min(lifecycleResponse, simulatedStatuses.length - 1)]
    lifecycleResponse += 1
    await route.fulfill({
      response,
      json: {
        ...payload,
        sources: payload.sources.map((detail) => (
          detail.source.id === sourceId
            ? { ...detail, source: { ...detail.source, status } }
            : detail
        )),
      },
    })
  })

  const status = page.getByTestId(`knowledge-source-status-${sourceId}`)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await waitForText(status, 'pending')
  await waitForText(status, 'indexing')
  await waitForText(status, 'ready')
  assert.ok(lifecycleResponse >= 3, 'The workspace did not poll source lifecycle updates')
  await page.unroute(sourceListUrl)

  await setTheme(page, 'light')
  await page.screenshot({ path: path.join(artifactRoot, 'knowledge-workspace-light.png') })

  await page.goto(`${workspaceUrl}?source=${encodeURIComponent(sourceId)}`, {
    waitUntil: 'domcontentloaded',
  })
  const closeSource = page.getByRole('button', { name: 'Close source' })
  await closeSource.waitFor()
  assert.match(await closeSource.locator('xpath=..').innerText(), new RegExp(escapeRegExp(sourceTitle)))
  await page.screenshot({ path: path.join(artifactRoot, 'knowledge-citation-source.png') })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId(`knowledge-source-${sourceId}`).waitFor()
  await page.getByRole('button', { name: 'Close source' }).waitFor()

  await page.goto(`${baseUrl}/app/knowledge`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Search knowledge bases' }).click()
  await page.getByPlaceholder('Search').fill(`no-match-${suffix}`)
  await page.getByTestId('knowledge-base-empty').waitFor()
  await page.screenshot({ path: path.join(artifactRoot, 'knowledge-empty-search-light.png') })

  await setTheme(page, 'dark')
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  await page.screenshot({ path: path.join(artifactRoot, 'knowledge-empty-search-dark.png') })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded' })
  const mobileSources = page.getByRole('button', { name: 'Sources', exact: true })
  await mobileSources.waitFor()
  await mobileSources.click()
  await page.getByTestId(`knowledge-source-${sourceId}`).waitFor()
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  assert.ok(
    overflow.scrollWidth <= overflow.clientWidth,
    `Mobile workspace overflows horizontally: ${JSON.stringify(overflow)}`,
  )
  await page.screenshot({ path: path.join(artifactRoot, 'knowledge-workspace-mobile.png') })

  assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(' | ')}`)
  assert.deepEqual(serverErrors, [], `Server errors: ${serverErrors.join(' | ')}`)
  console.log(JSON.stringify({
    artifactRoot,
    citationDeepLink: true,
    emptyState: true,
    lifecycleWithoutRefresh: simulatedStatuses,
    lightAndDark: true,
    mobile: true,
    ok: true,
    refreshPersistence: true,
  }, null, 2))
} finally {
  if (knowledgeBaseId) {
    await context.request.delete(`${baseUrl}/api/v1/knowledge-bases`, {
      data: { knowledgeBaseId },
    }).catch(() => undefined)
  }
  await context.close()
  await browser.close()
}

async function waitForText(locator: Locator, expected: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await locator.textContent().catch(() => null))?.trim().includes(expected)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.fail(`Timed out waiting for "${expected}" in ${await locator.textContent().catch(() => '')}`)
}

async function setTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.evaluate((nextTheme) => {
    document.documentElement.dataset.theme = nextTheme
    document.documentElement.style.colorScheme = nextTheme
  }, theme)
  await page.waitForTimeout(100)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
