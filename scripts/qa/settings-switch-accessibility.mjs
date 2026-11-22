// Verify computed switch names and keyboard operation in a real browser.
// Run: node scripts/qa/settings-switch-accessibility.mjs
// Set PLAYWRIGHT_CHANNEL=chrome to use an installed Chrome.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const bundle = await build({
  stdin: {
    contents: `import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {SettingRow} from './packages/overlay-modules-react/src/settings/rows';
      function Fixture() {
        const [checked, setChecked] = useState(false);
        return <>
          <SettingRow icon={null} title="Auto-continue" description="Automatically resume chats."
            checked={checked} onChange={() => setChecked(value => !value)} />
          <SettingRow icon={null} title="Only allow ZDR models" description="Hide other models."
            checked disabled onChange={() => { throw new Error('Disabled switch activated') }} />
        </>;
      }
      createRoot(document.getElementById('root')).render(<Fixture />);`,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('switch').first().waitFor()
  const snapshots = await Promise.all((await page.getByRole('switch').all()).map(control => control.ariaSnapshot()))
  assert.match(snapshots[0], /switch "Auto-continue"/)
  assert.match(snapshots[1], /switch "Only allow ZDR models".*\[checked\].*\[disabled\]/)
  const control = page.getByRole('switch', { name: 'Auto-continue', exact: true })
  await control.focus()
  await page.keyboard.press('Space')
  assert.equal(await control.getAttribute('aria-checked'), 'true')
  await page.keyboard.press('Enter')
  assert.equal(await control.getAttribute('aria-checked'), 'false')
  const disabled = page.getByRole('switch', { name: 'Only allow ZDR models', exact: true })
  assert.equal(await disabled.isDisabled(), true)
  await disabled.evaluate(element => element.click())
  assert.equal(await disabled.getAttribute('aria-checked'), 'true')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ snapshots, spaceTurnsOn: true, enterTurnsOff: true, disabledRemainsChecked: true, errors }, null, 2))
} finally { await browser.close() }
