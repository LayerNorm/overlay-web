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
  if (process.env.WORK_QA_ONLY && !name.includes(process.env.WORK_QA_ONLY)) return
  if (process.env.WORK_QA_VERBOSE) console.error(`> ${name}`)
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
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
/** Navigates inside the page, keeping the fake API's state (a full load starts it over). */
const go = (page, query) => page.evaluate((q) => { window.history.pushState(null, '', `/?${q}`); window.dispatchEvent(new PopStateEvent('popstate')) }, query)
/** Tells the page tasks changed elsewhere and waits until the list has been fetched and shown again. */
async function refreshList(page) {
  const before = await page.evaluate(() => window.__work.state.calls.filter((c) => /^\/api\/v1\/work(\?|$)/.test(c.path) && c.method === 'GET').length)
  await page.evaluate(() => window.dispatchEvent(new Event('overlay:work-updated')))
  await page.waitForFunction((n) => window.__work.state.calls.filter((c) => /^\/api\/v1\/work(\?|$)/.test(c.path) && c.method === 'GET').length > n, before)
  await page.waitForTimeout(150)
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

await check('task panel: open from the list, edit every field, and each change saves', async (page, shot) => {
  await open(page, 'scope=workspace')
  await page.waitForSelector('[data-testid="work-list"]')
  await page.locator('[data-task-id]', { hasText: 'Record the 60 second product walkthrough' }).click()
  await page.getByTestId('work-peek').waitFor()
  assert.match(page.url(), /task=t\d+/)
  assert.equal(await page.getByRole('textbox', { name: 'Title', exact: true }).inputValue(), 'Record the 60 second product walkthrough')
  await page.waitForTimeout(400)
  await shot('light')

  const peek = page.getByTestId('work-peek')
  const saved = () => page.evaluate(() => window.__work.dump().find((i) => i.title.includes('walkthrough')))

  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Record the 90 second walkthrough')
  await page.getByRole('textbox', { name: 'Title', exact: true }).press('Enter')
  await page.waitForFunction(() => window.__work.dump().some((i) => i.title === 'Record the 90 second walkthrough'))

  await peek.getByRole('button', { name: /^Priority:/ }).click()
  await page.getByRole('menuitemradio', { name: 'High' }).click()
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.includes('90 second')).priority === 3)

  await peek.getByRole('button', { name: /^Reviewer:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Priya Nair' }).click()
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.includes('90 second')).reviewerUserId === 'user-priya')

  await peek.getByLabel('Due date').fill('2026-01-01')
  await page.waitForSelector('[role="alert"]:has-text("on or before")')
  const before = await saved()
  assert.notEqual(before.dueDate, '2026-01-01')
  const future = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 20); return d.toISOString().slice(0, 10) })
  await peek.getByLabel('Due date').fill(future)
  await page.waitForFunction((value) => window.__work.dump().find((i) => i.title.includes('90 second')).dueDate === value, future)

  await peek.getByRole('switch', { name: 'Blocked' }).click()
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.includes('90 second')).blocked === true)

  await peek.getByRole('button', { name: /^Inside:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Q4 customer research' }).click()
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.includes('90 second')).parentId !== null)
  await peek.getByRole('button', { name: /^Inside:/ }).click()
  await page.getByRole('menuitem', { name: 'Not inside another task' }).click()
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.includes('90 second')).parentId === null)

  // The objective is Markdown: formatted when read, plain text when edited.
  await peek.getByRole('button', { name: 'Edit objective' }).click()
  await peek.getByRole('textbox', { name: 'Objective' }).fill('One take, **no cuts**.\n\n- screen\n- voice')
  await peek.getByRole('textbox', { name: 'Objective' }).blur()
  await peek.locator('[data-testid="work-objective"] strong').waitFor()
  assert.equal(await peek.locator('[data-testid="work-objective"] li').count(), 2)

  // Context: a link, and something found by search.
  await peek.getByRole('button', { name: 'Add file, note, chat or link' }).click()
  await page.getByLabel('Search files, notes and chats, or paste a link').fill('https://www.figma.com/file/abc')
  await page.getByRole('button', { name: /Add link figma.com/ }).click()
  await peek.getByRole('button', { name: 'Add file, note, chat or link' }).click()
  await page.getByLabel('Search files, notes and chats, or paste a link').fill('launch')
  await page.getByRole('button', { name: 'launch-brief.pdf' }).click()
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.includes('90 second')).context.length === 2)
  assert.equal(await peek.locator('a[href="https://www.figma.com/file/abc"]').getAttribute('target'), '_blank')
  assert.equal(await peek.locator('a[href="/app/files?file=f1"]').count(), 1)

  // Done when: add, tick, rename, remove.
  await peek.getByRole('textbox', { name: 'Add a condition' }).fill('Under 90 seconds')
  await peek.getByRole('textbox', { name: 'Add a condition' }).press('Enter')
  await peek.getByRole('textbox', { name: 'Add a condition' }).fill('Captions exported')
  await peek.getByRole('textbox', { name: 'Add a condition' }).press('Enter')
  await peek.getByRole('checkbox', { name: 'Under 90 seconds' }).click()
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.includes('90 second')).doneWhen.filter((d) => d.checked).length === 1)
  assert.match(await peek.innerText(), /1 of 2/)
  await peek.getByRole('button', { name: /Remove “Captions exported”/ }).click({ force: true })
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.includes('90 second')).doneWhen.length === 1)

  // Comment and activity.
  await peek.getByRole('textbox', { name: 'Leave a comment' }).fill('Script is in the launch note')
  await peek.getByRole('textbox', { name: 'Leave a comment' }).press('Enter')
  await peek.getByText('Script is in the launch note').waitFor()
  const log = await peek.getByTestId('work-activity').innerText()
  assert.match(log, /set the priority to High/)
  assert.match(log, /asked Priya Nair to review/)
  assert.match(log, /marked this as blocked/)
  await shot('edited')

  // Esc closes the panel and clears ?task=.
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="work-peek"]', { state: 'detached' })
  assert.doesNotMatch(page.url(), /task=/)
})

await check('task panel: reviewer approves, archive closes it, restore brings it back, and a link opens in its own scope', async (page) => {
  await open(page, 'scope=workspace')
  await page.waitForSelector('[data-testid="work-list"]')
  await page.locator('[data-task-id]', { hasText: 'Write the launch announcement post' }).click()
  const peek = page.getByTestId('work-peek')
  await peek.getByTestId('work-review-card').waitFor()
  await peek.getByRole('button', { name: 'Approve' }).click()
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.startsWith('Write the launch')).status === 'done')
  await page.waitForSelector('[data-testid="work-review-card"]', { state: 'detached' })

  await peek.getByRole('button', { name: 'Archive' }).click()
  await page.waitForSelector('[data-testid="work-peek"]', { state: 'detached' })
  assert.ok(!(await titles(page)).includes('Write the launch announcement post'))
  assert.ok(await page.evaluate(() => window.__work.dump().find((i) => i.title.startsWith('Write the launch')).archivedAt !== null))

  // Opening a personal task from a link while on Workspace switches to Personal.
  const personalId = await page.evaluate(() => window.__work.dump().find((i) => i.title.startsWith('Renew the domain')).id)
  await open(page, `scope=workspace&task=${personalId}`)
  await page.getByTestId('work-peek').waitFor()
  await page.waitForFunction(() => /scope=personal/.test(location.search))
  await page.waitForSelector('[data-testid="work-list"] [data-task-id]:has-text("Renew the domain names")')
})

await check('task panel: an archived task is read-only with Restore; a person without access sees a plain message', async (page) => {
  await open(page, 'scope=workspace')
  await page.waitForSelector('[data-testid="work-list"]')
  const id = await page.evaluate(() => {
    window.__work.patchWhere((i) => i.title.startsWith('Reconcile September'), { archivedAt: Date.now(), archivedFromScope: 'workspace' })
    window.dispatchEvent(new Event('overlay:work-updated'))
    return window.__work.dump().find((i) => i.title.startsWith('Reconcile September')).id
  })
  await page.waitForSelector('[data-task-id]:has-text("Reconcile September")', { state: 'detached' })
  await go(page, `scope=workspace&task=${id}`)
  const peek = page.getByTestId('work-peek')
  await peek.getByTestId('work-archived-note').waitFor()
  assert.ok(await peek.getByRole('textbox', { name: 'Title', exact: true }).isDisabled())
  assert.equal(await peek.getByRole('textbox', { name: 'Leave a comment' }).count(), 0)
  await peek.getByRole('button', { name: 'Restore' }).click()
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.startsWith('Reconcile')).archivedAt === null)

  await go(page, 'scope=workspace&task=nope')
  await page.getByText('This task is not available').waitFor()
})

await check('task panel: a member who may not edit sees it read-only (admins-only policy)', async (page) => {
  await open(page, 'scope=workspace&role=member&policy=admins')
  await page.waitForSelector('[data-testid="work-list"]')
  // Not assigned to this member, created by someone else: read-only.
  await page.evaluate(() => window.__work.patchWhere((i) => i.scope === 'workspace' && i.assigneePrincipalId !== 'p-me', { createdBy: 'user-sam' }))
  await refreshList(page)
  await page.locator('[data-task-id]', { hasText: 'Fix the pricing table layout' }).click()
  const peek = page.getByTestId('work-peek')
  await peek.waitFor()
  assert.ok(await peek.getByRole('textbox', { name: 'Title', exact: true }).isDisabled())
  assert.ok(await peek.getByRole('button', { name: /^Status:/ }).isDisabled())
})

const column = (status) => `[data-testid="work-column-${status}"]`
const cards = (page, status) => page.locator(`${column(status)} [data-testid="work-card"]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))

await check('board: five columns, cards, and drag to another column and within a column', async (page, shot) => {
  await open(page, 'scope=workspace&view=board')
  await page.waitForSelector('[data-testid="work-board"]')
  assert.equal(await page.locator('[data-testid^="work-column-"]').count(), 5)
  await shot('light')
  await open(page, 'scope=workspace&view=board&theme=dark')
  await page.waitForSelector('[data-testid="work-board"]')
  await shot('dark')
  await open(page, 'scope=workspace&view=board')
  await page.waitForSelector('[data-testid="work-board"]')

  // To another column: Draft interview questions (Todo) goes to In review.
  const card = page.locator('[data-card-id]', { hasText: 'Draft interview questions for churned customers' })
  await card.dragTo(page.locator(`${column('review')} [data-testid="work-card"]`).first(), { targetPosition: { x: 40, y: 4 } })
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.startsWith('Draft interview')).status === 'review')
  assert.deepEqual((await cards(page, 'review'))[0], 'Draft interview questions for churned customers', 'dropped above the first card')

  // Within a column: move the last In progress card to the top.
  const progress = await cards(page, 'progress')
  const last = page.locator(`${column('progress')} [data-testid="work-card"]`).last()
  await last.dragTo(page.locator(`${column('progress')} [data-testid="work-card"]`).first(), { targetPosition: { x: 40, y: 4 } })
  await page.waitForFunction(([title]) => {
    const first = document.querySelector('[data-testid="work-column-progress"] [data-testid="work-card"]')
    return first?.getAttribute('aria-label') === title
  }, [progress.at(-1)])
  // The order is what the server keeps: reload the list and it is the same.
  await refreshList(page)
  assert.equal((await cards(page, 'progress'))[0], progress.at(-1))

  // Into an empty column.
  await page.locator('[data-card-id]', { hasText: 'Billing cleanup' }).dragTo(page.locator(column('backlog')))
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title === 'Billing cleanup').status === 'backlog')
})

await check('board: a refused move snaps back with a message; the keyboard and the status button move cards too', async (page) => {
  await open(page, 'scope=workspace&view=board')
  await page.waitForSelector('[data-testid="work-board"]')
  await page.evaluate(() => { window.__work.state.failNext = { match: /POST .*\/move$/, status: 400, error: 'That change is not allowed.' } })
  await page.locator('[data-card-id]', { hasText: 'Migrate legacy plan names' }).dragTo(page.locator(column('done')))
  await page.getByRole('alert').waitFor()
  assert.ok((await cards(page, 'todo')).includes('Migrate legacy plan names in Stripe'), 'back in Todo')
  assert.ok(!(await cards(page, 'done')).includes('Migrate legacy plan names in Stripe'))

  // Keyboard: Alt+Right moves to the next column, Alt+Up reorders, focus stays on the card.
  const card = page.locator('[data-card-id]', { hasText: 'Summarize competitor changelogs' })
  await card.focus()
  await page.keyboard.press('Alt+ArrowRight')
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.startsWith('Summarize competitor')).status === 'progress')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Summarize competitor'))
  assert.match(await page.getByRole('status').first().innerText(), /Moved to In progress, position \d+ of \d+/)
  const before = await cards(page, 'progress')
  await page.keyboard.press('Alt+ArrowUp')
  await page.waitForFunction((titles) => {
    const now = [...document.querySelectorAll('[data-testid="work-column-progress"] [data-testid="work-card"]')].map((n) => n.getAttribute('aria-label'))
    return now.join('|') !== titles.join('|')
  }, before)
  await page.keyboard.press('Enter')
  await page.getByTestId('work-peek').waitFor()
  await page.keyboard.press('Escape')

  // The status button on a card is the pointer-free alternative.
  const stripe = page.locator('[data-card-id]', { hasText: 'Migrate legacy plan names' })
  await stripe.getByRole('button', { name: /^Status:/ }).click()
  await page.getByRole('menuitemradio', { name: 'In review' }).click()
  await page.waitForFunction(() => window.__work.dump().find((i) => i.title.startsWith('Migrate legacy')).status === 'review')
  assert.ok((await cards(page, 'review')).includes('Migrate legacy plan names in Stripe'))
})

await check('board: filters apply, a card opens the panel, and tasks you cannot edit are not draggable', async (page) => {
  await open(page, 'scope=workspace&view=board&filter=needs-you')
  await page.waitForSelector('[data-testid="work-board"]')
  const all = await page.locator('[data-testid="work-card"]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')))
  assert.deepEqual(all.sort(), ['Which analytics events can we drop before launch?', 'Write the launch announcement post'].sort())
  await page.locator('[data-card-id]', { hasText: 'Write the launch announcement' }).click()
  await page.getByTestId('work-peek').waitFor()
  assert.match(page.url(), /view=board/)

  await open(page, 'scope=workspace&view=board&role=member&policy=admins')
  await page.waitForSelector('[data-testid="work-board"]')
  await page.evaluate(() => window.__work.patchWhere((i) => i.scope === 'workspace' && i.assigneePrincipalId !== 'p-me', { createdBy: 'user-sam' }))
  await refreshList(page)
  assert.equal(await page.locator('[data-card-id]', { hasText: 'Fix the pricing table layout' }).getAttribute('draggable'), 'false')
  assert.equal(await page.locator('[data-card-id]', { hasText: 'Which analytics events' }).getAttribute('draggable'), 'true')
})

await browser.close()
await harness.close()
let failed = 0
for (const [name, ok, error] of results) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) { failed += 1; console.log(`     ${error?.message ?? error}`) }
}
process.exit(failed ? 1 : 0)
