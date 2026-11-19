import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type APIRequestContext } from 'playwright'

const baseUrl = required('P6_AUTOMATION_UI_QA_URL').replace(/\/$/, '')
const storageState = path.resolve(required('P6_AUTOMATION_UI_QA_STORAGE_STATE'))
await access(storageState)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const pageErrors: string[] = []
const serverErrors: string[] = []

page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('response', (response) => {
  if (response.status() >= 500 && new URL(response.url()).origin === baseUrl) {
    serverErrors.push(response.status() + ' ' + response.request().method() + ' ' + response.url())
  }
})

let automationId: string | undefined
const instructions = 'P6 browser QA ' + Date.now() + ': summarize the latest project activity.'
const renamed = 'P6 browser QA renamed ' + Date.now()

try {
  const session = await context.request.get(baseUrl + '/api/auth/session')
  assert.equal(session.ok(), true, 'Session endpoint returned ' + session.status())
  assert.equal((await session.json() as { authenticated?: boolean }).authenticated, true)

  // A new automation is an ordinary composer message with a schedule picked beside the model.
  await page.goto(baseUrl + '/app/automations', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /^Schedule: / }).click()
  await page.getByRole('radio', { name: 'Every day' }).click()
  await page.getByLabel('Time', { exact: true }).fill('09:15')
  await page.keyboard.press('Escape')
  const composer = page.locator('[data-chat-composer] [contenteditable="true"]').first()
  await composer.fill(instructions)
  await composer.press('Enter')

  // Sending creates the automation, runs it once and opens its thread with the details panel.
  await page.waitForURL((url) => Boolean(url.searchParams.get('automationId')), { timeout: 60_000 })
  automationId = new URL(page.url()).searchParams.get('automationId') ?? undefined
  assert.ok(automationId, 'Sending did not open the new automation')
  const panel = page.getByRole('complementary', { name: 'Automation sidebar' })
  await panel.waitFor()
  await panel.getByText('Every day · 9:15 AM').first().waitFor()

  let detail = await readAutomation(context.request, automationId)
  assert.equal(detail.schedule?.kind, 'daily')
  assert.equal(detail.schedule?.hour, 9)
  assert.equal(detail.schedule?.minute, 15)
  assert.equal(detail.enabled, true)

  await panel.getByRole('switch', { name: 'Active' }).click()
  await panel.getByText('Paused', { exact: true }).waitFor()
  detail = await readAutomation(context.request, automationId)
  assert.equal(detail.enabled, false)
  await panel.getByRole('switch', { name: 'Active' }).click()
  await panel.getByText('Active', { exact: true }).waitFor()

  await panel.getByRole('button', { name: 'Edit automation name' }).click()
  await panel.getByRole('textbox', { name: 'Automation name' }).fill(renamed)
  await panel.getByRole('textbox', { name: 'Automation name' }).press('Enter')
  await panel.getByText(renamed, { exact: true }).waitFor()

  await panel.getByRole('heading', { name: 'Recent runs' }).waitFor()

  await panel.getByRole('button', { name: 'Delete automation' }).click()
  await panel.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.waitForURL((url) => !url.searchParams.get('automationId'))
  automationId = undefined

  assert.deepEqual(pageErrors, [], 'Page errors: ' + pageErrors.join(' | '))
  assert.deepEqual(serverErrors, [], 'Server errors: ' + serverErrors.join(' | '))
  console.log(JSON.stringify({
    createdFromComposer: true,
    detailsPanelOpened: true,
    enabledLifecycle: ['pause', 'resume'],
    ok: true,
    renamedInPanel: true,
    schedulePersisted: 'daily 09:15',
    deletedFromPanel: true,
  }, null, 2))
} finally {
  if (automationId) {
    await context.request.delete(
      baseUrl + '/api/v1/automations?automationId=' + encodeURIComponent(automationId),
    ).catch(() => undefined)
  }
  await context.close()
  await browser.close()
}

async function readAutomation(request: APIRequestContext, id: string) {
  const response = await request.get(baseUrl + '/api/v1/automations?automationId=' + encodeURIComponent(id))
  assert.equal(response.ok(), true, 'Automation detail returned ' + response.status())
  const payload = await response.json() as Record<string, unknown>
  return ('data' in payload && payload.data ? payload.data : payload) as {
    enabled?: boolean
    schedule?: { kind?: string; hour?: number; minute?: number }
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}
