import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

const baseUrl = required('P6_AUTOMATION_UI_QA_URL').replace(/\/$/, '')
const storageState = path.resolve(required('P6_AUTOMATION_UI_QA_STORAGE_STATE'))
await access(storageState)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ storageState })
const page = await context.newPage()
const pageErrors: string[] = []
const serverErrors: string[] = []

page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('response', (response) => {
  if (response.status() >= 500 && new URL(response.url()).origin === baseUrl) {
    serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`)
  }
})

let automationId: string | undefined
const automationName = `P6 browser QA ${Date.now()}`

try {
  const session = await context.request.get(`${baseUrl}/api/auth/session`)
  assert.equal(session.ok(), true, `Session endpoint returned ${session.status()}`)
  assert.equal((await session.json() as { authenticated?: boolean }).authenticated, true)

  const capabilities = await context.request.get(`${baseUrl}/api/v1/capabilities`)
  assert.equal(capabilities.ok(), true, `Capabilities endpoint returned ${capabilities.status()}`)
  assert.equal(
    (await capabilities.json() as { capabilities?: { automations?: boolean } }).capabilities?.automations,
    true,
  )

  await page.goto(`${baseUrl}/app/automations`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForURL((url) => Boolean(url.searchParams.get('automationId')) && url.searchParams.get('tab') === 'edit')
  automationId = new URL(page.url()).searchParams.get('automationId') ?? undefined
  assert.ok(automationId, 'Creating an automation draft did not produce an automationId')

  await expectEditor(page)
  await page.getByLabel('Name').fill(automationName)
  await page.getByLabel('Description').fill('Created by the P6 automation browser gate')
  const instructions = page.locator('.ProseMirror').first()
  await instructions.waitFor()
  await instructions.fill('Summarize the latest project activity and record the result.')

  await persistSchedule(page, 'interval', async () => {
    await page.getByLabel('Every N minutes').fill('30')
  })
  await persistSchedule(page, 'daily', async () => {
    await page.getByLabel('Time').fill('09:15')
  })
  await persistSchedule(page, 'weekly', async () => {
    await page.getByLabel('Time').fill('10:30')
    await page.getByLabel('Day of week').selectOption('2')
  })
  await persistSchedule(page, 'monthly', async () => {
    await page.getByLabel('Time').fill('11:45')
    await page.getByLabel('Day of month').fill('12')
  })

  const enabledSwitch = page.getByRole('switch').first()
  await enabledSwitch.click()
  await saveAndReload(page)
  assert.equal(await page.getByRole('switch').first().getAttribute('aria-checked'), 'true')
  await page.getByRole('switch').first().click()
  await saveAndReload(page)
  assert.equal(await page.getByRole('switch').first().getAttribute('aria-checked'), 'false')

  await page.getByRole('heading', { name: 'Run history' }).waitFor()
  const runsResponse = await context.request.get(
    `${baseUrl}/api/v1/automations?automationId=${encodeURIComponent(automationId)}&includeRuns=true`,
  )
  assert.equal(runsResponse.ok(), true, `Run history returned ${runsResponse.status()}`)
  const runsPayload = await runsResponse.json() as { data?: unknown[] } | unknown[]
  assert.equal(Array.isArray(runsPayload) || Array.isArray((runsPayload as { data?: unknown[] }).data), true)

  const editorDetail = await context.request.get(
    `${baseUrl}/api/v1/automations?automationId=${encodeURIComponent(automationId)}`,
  )
  assert.equal(editorDetail.ok(), true, `Automation detail returned ${editorDetail.status()}`)
  const detail = await editorDetail.json() as {
    _id?: string
    description?: string
    name?: string
    schedule?: { kind?: string }
  }
  assert.equal(detail._id, automationId)
  assert.equal(detail.name, automationName)
  assert.equal(detail.description, 'Created by the P6 automation browser gate')
  assert.equal(detail.schedule?.kind, 'monthly')

  const row = page.getByText(automationName, { exact: true }).last().locator('xpath=ancestor::div[contains(@class,"group/automation-row")]')
  await row.hover()
  await row.getByRole('button', { name: 'Delete automation' }).click()
  await row.getByRole('button', { name: 'Confirm delete automation' }).click()
  await page.getByText(automationName, { exact: true }).waitFor({ state: 'detached' })
  automationId = undefined

  assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(' | ')}`)
  assert.deepEqual(serverErrors, [], `Server errors: ${serverErrors.join(' | ')}`)
  console.log(JSON.stringify({
    createdThroughUi: true,
    editorOpened: true,
    enabledLifecycle: ['resume', 'pause'],
    ok: true,
    runHistoryRendered: true,
    schedulesPersisted: ['interval', 'daily', 'weekly', 'monthly'],
  }, null, 2))
} finally {
  if (automationId) {
    await context.request.delete(
      `${baseUrl}/api/v1/automations?automationId=${encodeURIComponent(automationId)}`,
    ).catch(() => undefined)
  }
  await context.close()
  await browser.close()
}

async function expectEditor(page: Page): Promise<void> {
  await page.getByText('Automation editor', { exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Run history' }).waitFor()
  await page.locator('.ProseMirror').first().waitFor()
}

async function persistSchedule(
  page: Page,
  kind: 'daily' | 'interval' | 'monthly' | 'weekly',
  configure: () => Promise<void>,
): Promise<void> {
  await page.getByLabel('Frequency').selectOption(kind)
  await configure()
  await saveAndReload(page)
  assert.equal(await page.getByLabel('Frequency').inputValue(), kind)
}

async function saveAndReload(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByRole('button', { name: 'Saved' }).waitFor()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expectEditor(page)
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
