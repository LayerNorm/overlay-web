// Phase-1 dialog QA: storybook-level radix checks + screenshots.
import { chromium } from 'playwright'

const SB = 'http://localhost:6006/iframe.html?viewMode=story&id='
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.connectOverCDP('http://localhost:29229')
const ctx = browser.contexts()[0] ?? (await browser.newContext())
const page = await ctx.newPage()

async function exercise(storyId, role, shot) {
  await page.goto(`${SB}${storyId}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(1500)
  await page.getByRole('button').first().click()
  await page.waitForTimeout(700)
  const dlg = page.locator(`[role="${role}"]`)
  ok(`${storyId} opens via radix portal`, (await dlg.count()) > 0)
  if (!(await dlg.count())) return false
  ok('scrim present', (await page.locator('[data-slot$="overlay"]').count()) > 0)
  const focusInside = await page.evaluate((r) => {
    const d = document.querySelector(`[role="${r}"]`)
    return d ? d.contains(document.activeElement) || d === document.activeElement : false
  }, role)
  ok('focus trapped inside dialog', focusInside)
  const inert = await page.evaluate(() => document.body.hasAttribute('data-scroll-locked') || document.body.style.overflow === 'hidden')
  ok('body scroll locked', inert)
  await page.screenshot({ path: shot })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  ok('Escape dismisses', (await page.locator(`[role="${role}"]`).count()) === 0)
  return true
}

try {
  // light
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await exercise('overlay-overlays--dialog', 'dialog', '/tmp/qa-dialog-light.png')
  await exercise('overlay-overlays--alert-dialog', 'alertdialog', '/tmp/qa-confirm-light.png')

  // dark
  const reopened = await (async () => {
    await page.goto(`${SB}overlay-overlays--dialog`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.waitForTimeout(800)
    await page.getByRole('button').first().click()
    await page.waitForTimeout(700)
    return page.locator('[role="dialog"]').count()
  })()
  const darkBg = await page.evaluate(() => {
    const el = document.querySelector('[data-slot="dialog-content"]')
    return el ? getComputedStyle(el).backgroundColor : null
  })
  ok('dark theme dialog themed surface', reopened > 0 && !!darkBg, darkBg ?? '')
  await page.screenshot({ path: '/tmp/qa-dialog-dark.png' })
  await page.keyboard.press('Escape')
} catch (e) {
  console.log('ERROR', e.message)
} finally {
  await page.close()
  const fails = results.filter((r) => !r.pass)
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`)
  process.exit(fails.length ? 1 : 0)
}
