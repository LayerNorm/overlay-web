// Drives the real Work UI (List, and later Board, Timeline and the task panel) in Chromium against an in-page fake API.
//   node scripts/qa/work-ui-qa.mjs            run the checks
//   WORK_QA_SHOTS=artifacts/work-qa node scripts/qa/work-ui-qa.mjs   also write screenshots (light and dark)
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { startWorkHarness } from './work-ui/harness.mjs'

const shots = process.env.WORK_QA_SHOTS
const harness = await startWorkHarness()
// WORK_QA_CHROMIUM points at an installed Chromium when Playwright's own download is not present.
const browser = await chromium.launch({ headless: true, ...(process.env.WORK_QA_CHROMIUM ? { executablePath: process.env.WORK_QA_CHROMIUM } : {}) })
const results = []

async function check(name, run) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  try {
    await run(page, async (label) => {
      if (!shots) return
      await mkdir(shots, { recursive: true })
      await page.screenshot({ path: path.join(shots, `${name.replace(/\W+/g, '-')}-${label}.png`) })
    })
    assert.deepEqual(errors, [], `console errors in "${name}"`)
    results.push([name, true])
  } catch (error) {
    results.push([name, false, error])
  } finally {
    await context.close()
  }
}

const open = async (page, query = '') => {
  await page.goto(`${harness.url}/?${query}`)
  await page.waitForSelector('[data-testid="work-page"]')
}
const titles = (page) => page.locator('[data-testid="work-row"] button.truncate').allTextContents()

await check('list: groups, rows, filters and search', async (page, shot) => {
  await open(page, 'scope=workspace')
  await page.waitForSelector('[data-testid="work-list"]')
  assert.ok(await page.locator('[data-testid="work-group-review"]').isVisible())
  assert.ok(await page.locator('[data-testid="work-group-progress"]').isVisible())
  // Done starts collapsed.
  assert.equal(await page.locator('[data-testid="work-group-done"] [data-testid="work-row"]').count(), 0)
  await shot('light')
  await open(page, 'scope=workspace&theme=dark')
  await page.waitForSelector('[data-testid="work-list"]')
  await shot('dark')
  await open(page, 'scope=workspace')
  await page.waitForSelector('[data-testid="work-list"]')
  await page.locator('[data-testid="work-group-done"] button[aria-expanded]').click()
  assert.equal(await page.locator('[data-testid="work-group-done"] [data-testid="work-row"]').count(), 2)

  await page.getByRole('button', { name: /Needs you/ }).click()
  const needs = await titles(page)
  assert.ok(needs.includes('Write the launch announcement post'))
  assert.ok(needs.includes('Which analytics events can we drop before launch?'))
  assert.ok(!needs.includes('Fix the pricing table layout on small screens'))
  assert.match(page.url(), /filter=needs-you/)

  await page.getByRole('button', { name: 'Everything' }).click()
  await page.getByRole('button', { name: 'Search tasks' }).click()
  await page.getByPlaceholder('Search tasks').fill('stripe')
  assert.deepEqual(await titles(page), ['Migrate legacy plan names in Stripe'])
  await page.getByPlaceholder('Search tasks').fill('zzzz')
  assert.ok(await page.getByText('Nothing matches').isVisible())
})

await check('list: quick add creates in Todo and survives a reload', async (page) => {
  await open(page, 'scope=workspace')
  await page.waitForSelector('[data-testid="work-list"]')
  const before = await page.locator('[data-testid="work-group-todo"] [data-testid="work-row"]').count()
  await page.getByTestId('work-quick-add').fill('Plan the offsite')
  await page.getByTestId('work-quick-add').press('Enter')
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="work-group-todo"] [data-testid="work-row"]').length === n + 1, before)
  const todo = await page.locator('[data-testid="work-group-todo"] button.truncate').allTextContents()
  assert.equal(todo.at(-1), 'Plan the offsite')
  assert.equal(await page.getByTestId('work-quick-add').inputValue(), '')
  const saved = await page.evaluate(() => window.__work.dump().find((item) => item.title === 'Plan the offsite'))
  assert.equal(saved.scope, 'workspace')
  assert.equal(saved.status, 'todo')
})

await check('list: change status and owner, rename, and a refused change rolls back with a message', async (page, shot) => {
  await open(page, 'scope=workspace')
  await page.waitForSelector('[data-testid="work-list"]')
  const row = page.locator('[data-task-id]', { hasText: 'Draft interview questions for churned customers' })
  await row.getByRole('button', { name: /^Status:/ }).click()
  await page.getByRole('menuitemradio', { name: 'In progress' }).click()
  await page.waitForSelector('[data-testid="work-group-progress"] [data-task-id]:has-text("Draft interview questions")')
  await row.getByRole('button', { name: /^Owner:/ }).click()
  await page.waitForTimeout(250)
  await shot('owner-menu')
  await page.getByRole('menuitemradio', { name: 'Sam Okafor' }).click()
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.startsWith('Draft interview')).assigneePrincipalId === 'p-sam')

  await row.locator('button.truncate').dblclick()
  await page.getByRole('textbox', { name: 'Task title', exact: true }).fill('Draft ten interview questions')
  await page.getByRole('textbox', { name: 'Task title', exact: true }).press('Enter')
  await page.waitForFunction(() => window.__work.dump().some((i) => i.title === 'Draft ten interview questions'))

  await page.evaluate(() => { window.__work.state.failNext = { match: /PATCH/, status: 400, error: 'That change is not allowed.' } })
  const renamed = page.locator('[data-task-id]', { hasText: 'Draft ten interview questions' })
  await renamed.getByRole('button', { name: /^Status:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Backlog' }).click()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /not allowed/)
  assert.ok(await page.locator('[data-testid="work-group-progress"] [data-task-id]:has-text("Draft ten interview questions")').isVisible(), 'rolled back to In progress')
  await shot('error-banner')
})

await check('personal tasks differ from workspace tasks; a workspace of one sees a single list', async (page) => {
  await open(page, 'scope=personal')
  await page.waitForSelector('[data-testid="work-list"]')
  assert.deepEqual((await titles(page)).sort(), ['Book flights for the investor trip', 'Renew the domain names', 'Review the investor update draft'])
  await open(page, 'scope=workspace')
  await page.waitForSelector('[data-testid="work-list"]')
  assert.ok(!(await titles(page)).includes('Renew the domain names'))
  await open(page, 'solo=1&scope=workspace')
  await page.waitForSelector('[data-testid="work-list"]')
  assert.match(await page.locator('header h1').innerText(), /^List$/)
  assert.ok((await titles(page)).includes('Renew the domain names'), 'solo shows everything active')
})

await check('empty and error states', async (page, shot) => {
  await open(page, 'scope=personal')
  await page.waitForSelector('[data-testid="work-list"]')
  await page.evaluate(() => { window.__work.clear(); window.dispatchEvent(new Event('overlay:work-updated')) })
  await page.getByText('No tasks yet').waitFor()
  await shot('empty')
  await page.getByTestId('work-quick-add').fill('First task')
  await page.getByTestId('work-quick-add').press('Enter')
  await page.waitForSelector('[data-testid="work-row"]')

  await open(page, 'scope=workspace&failList=1')
  await page.getByText('Could not load tasks').first().waitFor()
  await shot('load-error')
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.waitForSelector('[data-testid="work-list"]')
})

await browser.close()
await harness.close()
let failed = 0
for (const [name, ok, error] of results) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) { failed += 1; console.log(`     ${error?.message ?? error}`) }
}
process.exit(failed ? 1 : 0)
