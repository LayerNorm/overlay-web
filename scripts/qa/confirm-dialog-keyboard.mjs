// Browser regression checks; callbacks only increment counters and never delete data.
// Run: node scripts/qa/confirm-dialog-keyboard.mjs
// Set PLAYWRIGHT_CHANNEL=chrome to use an installed Chrome instead of Playwright Chromium.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = await build({
  stdin: {
    contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {ConfirmDialog} from './packages/overlay-ui/src/components/overlays/ConfirmDialog';
      window.qa = {confirmed: 0, cancelled: 0};
      createRoot(document.getElementById('root')).render(<ConfirmDialog
        isOpen title="Delete fixture item?" description="Local counters only. No data is deleted."
        busy={window.busy} onConfirm={() => window.qa.confirmed++} onCancel={() => window.qa.cancelled++}
      />);`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const results = []
try {
  for (const scenario of [
    { name: 'Cancel + Enter', focus: 'Cancel', key: 'Enter', expected: { confirmed: 0, cancelled: 1 } },
    { name: 'Cancel + Space', focus: 'Cancel', key: 'Space', expected: { confirmed: 0, cancelled: 1 } },
    { name: 'Delete + Enter', focus: 'Delete', key: 'Enter', expected: { confirmed: 1, cancelled: 0 } },
    { name: 'Delete + Space', focus: 'Delete', key: 'Space', expected: { confirmed: 1, cancelled: 0 } },
    { name: 'Escape', key: 'Escape', expected: { confirmed: 0, cancelled: 1 } },
    { name: 'Busy + Enter', busy: true, key: 'Enter', expected: { confirmed: 0, cancelled: 0 } },
    { name: 'Busy + Space', busy: true, key: 'Space', expected: { confirmed: 0, cancelled: 0 } },
    { name: 'Busy + Escape', busy: true, key: 'Escape', expected: { confirmed: 0, cancelled: 0 } },
  ]) {
    const page = await browser.newPage()
    try {
      await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>')
      await page.evaluate(busy => { window.busy = busy }, Boolean(scenario.busy))
      await page.addScriptTag({ content: bundle.outputFiles[0].text })
      await page.getByRole('alertdialog').waitFor()
      if (scenario.busy) {
        assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true)
        assert.equal(await page.getByRole('button', { name: 'Deleting…', exact: true }).isDisabled(), true)
      } else {
        assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).evaluate(el => el === document.activeElement), true)
      }
      if (scenario.focus) await page.getByRole('button', { name: scenario.focus, exact: true }).focus()
      await page.keyboard.press(scenario.key)
      const actual = await page.evaluate(() => window.qa)
      assert.deepEqual(actual, scenario.expected, scenario.name)
      results.push({ scenario: scenario.name, ...actual })
    } finally { await page.close() }
  }
} finally { await browser.close() }
console.log(JSON.stringify(results, null, 2))
