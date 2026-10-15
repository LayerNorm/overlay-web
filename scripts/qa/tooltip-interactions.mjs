// Real React/Radix tooltip association, pointer and coarse-input regression checks.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import path from 'node:path'
const root = process.cwd()
const require = createRequire(path.join(root, 'package.json'))
const { build } = require('esbuild')
const { chromium } = require('playwright')
const output = await build({
  stdin: {
    contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {DelayedTooltip} from './packages/overlay-ui/src/components/overlays/DelayedTooltip';
import {Button} from './packages/overlay-ui/src/components/primitives/Button';
window.qaRoot=createRoot(document.getElementById('root'));window.qaRoot.render(<><DelayedTooltip label="Description from tooltip"><button id="trigger">Nested action</button></DelayedTooltip><button id="next">Next control</button><DelayedTooltip label="Nested group description"><span><button id="nested" aria-describedby="existing-description">Nested control</button></span></DelayedTooltip><span id="existing-description">Existing detail</span><DelayedTooltip label="Fragment description"><><button id="fragment">Fragment control</button></></DelayedTooltip><DelayedTooltip label="Custom button description"><Button id="custom" aria-describedby="existing-description">Custom control</Button></DelayedTooltip><DelayedTooltip label="Text description">Plain text</DelayedTooltip><DelayedTooltip label="Info tooltip"><span id="info" role="img" aria-label="Existing info label">Info icon</span></DelayedTooltip></>);
`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const html = `<!doctype html><style>.inline-flex {display:inline-flex} [data-slot="tooltip-content"] {pointer-events:none}</style><div id="root"></div><script>${output.outputFiles[0].text.replaceAll('</script>', '<\\/script>')}</script>`
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const origin = `http://127.0.0.1:${server.address().port}`
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(origin)
  await page.locator('#trigger').waitFor()
  assert.equal(
    await page.locator('#info').getAttribute('aria-label'),
    'Existing info label',
  )
  assert.equal(await page.locator('span[tabindex]').count(), 0)
  await page.keyboard.press('Tab')
  await page.getByRole('tooltip').waitFor()
  const association = await page
    .locator('#trigger')
    .evaluate((button) => ({
      focused: document.activeElement === button,
      buttonDescribedBy: button.getAttribute('aria-describedby'),
      wrapperDescribedBy: button.parentElement.getAttribute('aria-describedby'),
      tooltipId: document.querySelector('[role="tooltip"]')?.id,
      wrapperTabindex: button.parentElement.getAttribute('tabindex'),
    }))
  const client = await page.context().newCDPSession(page)
  const { root: document } = await client.send('DOM.getDocument')
  const { nodeId } = await client.send('DOM.querySelector', {
    nodeId: document.nodeId,
    selector: '#trigger',
  })
  const ax = await client.send('Accessibility.getPartialAXTree', {
    nodeId,
    fetchRelatives: false,
  })
  const accessibleButton = ax.nodes.find(
    (node) => node.role?.value === 'button',
  )
  assert.equal(association.focused, true)
  assert.equal(association.buttonDescribedBy, association.tooltipId)
  assert.equal(accessibleButton.description.value, 'Description from tooltip')
  console.log(
    JSON.stringify(
      {
        keyboard: {
          ...association,
          accessibleName: accessibleButton?.name?.value,
          accessibleDescription: accessibleButton?.description?.value ?? null,
        },
      },
      null,
      2,
    ),
  )
  await page.keyboard.press('Escape')
  await page.getByRole('tooltip').waitFor({ state: 'detached' })
  console.log('keyboard Escape hides tooltip')
  for (const [id, description] of [
    ['nested', 'Nested group description'],
    ['fragment', 'Fragment description'],
    ['custom', 'Custom button description'],
  ]) {
    await page.locator('#' + id).focus()
    await page.getByRole('tooltip').waitFor()
    await page.waitForFunction(
      ({ id }) =>
        document
          .getElementById(id)
          .getAttribute('aria-describedby')
          ?.split(/\s+/)
          .some((value) =>
            document
              .getElementById(value)
              ?.textContent?.includes('description'),
          ),
      { id },
    )
    const { nodeId: controlId } = await client.send('DOM.querySelector', {
      nodeId: document.nodeId,
      selector: '#' + id,
    })
    const { nodes } = await client.send('Accessibility.getPartialAXTree', {
      nodeId: controlId,
      fetchRelatives: false,
    })
    assert.equal(
      nodes[0].description?.value,
      id === 'nested' || id === 'custom'
        ? 'Existing detail ' + description
        : description,
    )
    await page.keyboard.press('Escape')
    await page.getByRole('tooltip').waitFor({ state: 'detached' })
    if (id === 'nested' || id === 'custom')
      assert.equal(
        await page.locator('#nested').getAttribute('aria-describedby'),
        'existing-description',
      )
    console.log(
      id +
        ' associates tooltip with focused button, preserving existing description',
    )
  }

  await page.locator('#nested').focus()
  await page.getByRole('tooltip').waitFor()
  await page.waitForFunction(
    () =>
      document
        .getElementById('nested')
        .getAttribute('aria-describedby')
        .split(/\s+/).length === 2,
  )
  await page.locator('#next').focus()
  await page.getByRole('tooltip').waitFor({ state: 'detached' })
  assert.equal(
    await page.locator('#nested').getAttribute('aria-describedby'),
    'existing-description',
  )
  await page.locator('#nested').focus()
  await page.getByRole('tooltip').waitFor()
  const retained = await page.locator('#nested').elementHandle()
  await page.evaluate(() => window.qaRoot.unmount())
  assert.equal(
    await retained.evaluate((element) =>
      element.getAttribute('aria-describedby'),
    ),
    'existing-description',
  )
  console.log(
    'blur and unmount restore prior descriptions with no stale tooltip ID',
  )
  await page.goto(origin)
  await page.locator('#trigger').waitFor()
  await page.locator('#trigger').hover()
  await page.waitForTimeout(250)
  assert.equal(await page.getByRole('tooltip').count(), 0)
  console.log('hover absent before delay')
  await page.getByRole('tooltip').waitFor({ timeout: 2000 })
  console.log('hover opens after delay')
  await page.mouse.move(800, 600, { steps: 15 })
  await page.getByRole('tooltip').waitFor({ state: 'detached', timeout: 1000 })
  console.log('pointer leave hides tooltip')
  await page.locator('#trigger').hover()
  await page.getByRole('tooltip').waitFor({ timeout: 2000 })
  await page.keyboard.press('Escape')
  await page.getByRole('tooltip').waitFor({ state: 'detached' })
  console.log('hover Escape hides tooltip')

  await page.locator('#trigger').focus()
  await page.getByRole('tooltip').waitFor()
  await client.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  })
  await page.waitForFunction(
    () => !matchMedia('(hover: hover) and (pointer: fine)').matches,
  )
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-slot="tooltip-trigger"]').length === 0,
  )
  assert.equal(await page.getByRole('tooltip').count(), 0)
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await page.waitForFunction(
    () => matchMedia('(hover: hover) and (pointer: fine)').matches,
  )
  await page.locator('[data-slot="tooltip-trigger"]').first().waitFor()
  assert.equal(await page.getByRole('tooltip').count(), 0)
  console.log(
    'real media-query changes disable and restore fine-hover capability without reopening',
  )
  await page.getByText('Plain text', { exact: true }).hover()
  await page.getByRole('tooltip').waitFor()
  assert.equal(
    await page.getByRole('tooltip').textContent(),
    'Text description',
  )
  await page.mouse.move(800, 600, { steps: 15 })
  await page.getByRole('tooltip').waitFor({ state: 'detached' })
  const touch = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 400, height: 700 },
  })
  const touchPage = await touch.newPage()
  await touchPage.goto(origin)
  await touchPage.locator('#trigger').waitFor()
  await touchPage.locator('#trigger').focus()
  await touchPage.waitForTimeout(650)
  assert.equal(await touchPage.getByRole('tooltip').count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify(
      {
        coarsePointer: {
          matchesFineHover: await touchPage.evaluate(
            () => matchMedia('(hover: hover) and (pointer: fine)').matches,
          ),
          tooltipCount: await touchPage.getByRole('tooltip').count(),
          triggerAttribute: await touchPage
            .locator('#trigger')
            .evaluate((button) =>
              button.parentElement.getAttribute('data-slot'),
            ),
        },
        errors,
      },
      null,
      2,
    ),
  )
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
