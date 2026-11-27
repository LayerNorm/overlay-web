import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('a real legacy file-origin profile exports privately and keeps recordings on upgrade', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'overlay-upgrade-e2e-'))
  const profile = join(directory, 'profile')
  const fixture = join(directory, 'legacy.cjs')
  const hook = join(directory, 'notice.cjs')
  writeFileSync(
    fixture,
    `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.loadFile(${JSON.stringify(resolve('out/renderer/index.html'))})})`
  )
  writeFileSync(
    hook,
    `globalThis.upgradeNotices=0;require('electron').dialog.showMessageBox=async()=>{globalThis.upgradeNotices++;return {response:0}}`
  )
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<h1>Upgrade smoke</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [fixture, `--user-data-dir=${profile}`] })
    const legacy = await app.firstWindow()
    await legacy.waitForLoadState('load')
    await legacy.evaluate(() => {
      localStorage.setItem(
        'transcriptions',
        JSON.stringify([{ id: 'old', text: 'Keep this local transcript' }])
      )
      localStorage.setItem(
        'overlay-settings',
        JSON.stringify({ selectedModelId: 'parakeet_v2', apiKey: 'must-not-export' })
      )
    })
    await app.close()
    writeFileSync(join(profile, 'settings.json'), '{}')
    mkdirSync(join(profile, 'recordings'))
    writeFileSync(join(profile, 'recordings', 'old.wav'), 'retained audio')
    writeFileSync(join(profile, 'knowledge-journal.json'), 'retained journal')
    const launch = () =>
      electron.launch({
        args: ['-r', hook, '.', `--user-data-dir=${profile}`],
        env: { ...process.env, APP_SERVER_URL: origin }
      })
    app = await launch()
    await expect.poll(() => app!.windows().some((page) => page.url().startsWith(origin))).toBe(true)
    const exported = join(profile, 'legacy-desktop-export', 'transcripts-and-settings.json')
    expect(JSON.parse(readFileSync(exported, 'utf8'))).toEqual({
      transcriptions: [{ id: 'old', text: 'Keep this local transcript' }],
      settings: { selectedModelId: 'parakeet_v2' }
    })
    expect(statSync(exported).mode & 0o077).toBe(0)
    expect(readFileSync(join(profile, 'recordings', 'old.wav'), 'utf8')).toBe('retained audio')
    expect(readFileSync(join(profile, 'knowledge-journal.json'), 'utf8')).toBe('retained journal')
    expect(
      await app.evaluate(() => (globalThis as unknown as { upgradeNotices: number }).upgradeNotices)
    ).toBe(1)
    await app.close()
    app = await launch()
    await expect.poll(() => app!.windows().some((page) => page.url().startsWith(origin))).toBe(true)
    expect(
      await app.evaluate(() => (globalThis as unknown as { upgradeNotices: number }).upgradeNotices)
    ).toBe(0)
  } finally {
    await app?.close().catch(() => {})
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
