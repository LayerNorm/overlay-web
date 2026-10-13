// Render the real wrappers and Radix primitives in an isolated browser.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = await mkdtemp(path.join(tmpdir(), 'overlay-dialog-qa-'))
let browser
const server = createServer(async (_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(await readFile(path.join(directory, 'index.html')))
})
try {
  const result = await build({
    stdin: {
      contents: `
        import React, { useState } from 'react'
        import { createRoot } from 'react-dom/client'
        import { ConfirmDialog } from './packages/overlay-ui/src/components/overlays/ConfirmDialog'
        import { DialogFrame } from './packages/overlay-ui/src/components/primitives/Dialog'
        function App() {
          const [confirm, setConfirm] = useState(false)
          const [dialog, setDialog] = useState(false)
          const [busy, setBusy] = useState(false)
          const [confirmed, setConfirmed] = useState(0)
          const [cancelled, setCancelled] = useState(0)
          return <>
            <button id="confirm-opener" onClick={() => setConfirm(true)}>Open confirm</button>
            <button id="dialog-opener" onClick={() => setDialog(true)}>Open dialog</button>
            <output id="counts">{confirmed}:{cancelled}</output>
            <ConfirmDialog isOpen={confirm} title="Delete fixture" description="Interaction fixture"
              busy={busy} onConfirm={() => { setConfirmed(n => n + 1); setBusy(true) }}
              onCancel={() => { setCancelled(n => n + 1); setConfirm(false) }} />
            <DialogFrame open={dialog} title="Dialog fixture" description="Focus fixture" onOpenChange={setDialog}>
              <button onClick={() => setDialog(false)}>Done</button>
            </DialogFrame>
          </>
        }
        createRoot(document.getElementById('root')).render(<App />)
      `,
      resolveDir: root,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(path.join(directory, 'index.html'), `<!doctype html><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script>', '<\\/script>')}</script>`)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const origin = `http://127.0.0.1:${address.port}`
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const checks = []
  async function check(name, exercise) {
    try { await exercise(); checks.push({ name, pass: true }) }
    catch (error) { checks.push({ name, pass: false, detail: error.message }) }
  }
  await check('confirm click keeps the async dialog open without cancellation', async () => {
    await page.goto(origin)
    await page.locator('#confirm-opener').click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Deleting…' }).waitFor({ timeout: 2000 })
    assert.equal(await page.locator('#counts').textContent(), '1:0')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#counts').textContent(), '1:0')
    assert.equal(await page.getByRole('alertdialog').count(), 1)
  })
  await check('Enter confirms once and ignores repeated confirmation while busy', async () => {
    await page.goto(origin)
    await page.locator('#confirm-opener').click()
    await page.getByRole('alertdialog').waitFor()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Deleting…' }).waitFor({ timeout: 2000 })
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('#counts').textContent(), '1:0')
  })
  for (const action of ['Cancel', 'Escape']) {
    await check(`${action} cancels once and returns focus to the external opener`, async () => {
      await page.goto(origin)
      await page.locator('#confirm-opener').click()
      await page.getByRole('alertdialog').waitFor()
      if (action === 'Cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      else await page.keyboard.press('Escape')
      await page.getByRole('alertdialog').waitFor({ state: 'detached' })
      await page.waitForFunction(() => document.activeElement?.id === 'confirm-opener', null, { timeout: 2000 })
      assert.equal(await page.locator('#counts').textContent(), '0:1')
    })
  }
  for (const action of ['Done', 'Escape']) {
    await check(`DialogFrame ${action} returns focus to its external opener`, async () => {
      await page.goto(origin)
      await page.locator('#dialog-opener').click()
      await page.getByRole('dialog').waitFor()
      if (action === 'Done') await page.getByRole('button', { name: 'Done', exact: true }).click()
      else await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      await page.waitForFunction(() => document.activeElement?.id === 'dialog-opener', null, { timeout: 2000 })
    })
  }
  assert.deepEqual(errors, [], 'browser runtime errors')
  console.log(JSON.stringify(checks, null, 2))
  assert.ok(checks.every(check => check.pass), 'dialog interaction checks failed')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
