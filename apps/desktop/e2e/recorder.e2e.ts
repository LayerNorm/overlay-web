import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('the native HUD captures audio and delivers the transcription without a preload name collision', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'overlay-recorder-qa-'))
  let audioBytes = 0
  const server = createServer((request, response) => {
    if (request.url === '/api/auth/session') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ authenticated: true }))
    } else if (request.url === '/api/v1/transcribe') {
      request.on('data', chunk => { audioBytes += chunk.length })
      request.on('end', () => {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ text: 'Recorder acceptance passed' }))
      })
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end('<title>Recorder QA</title><h1>Recorder fixture</h1>')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, APP_SERVER_URL: origin },
  })
  try {
    await app.firstWindow()
    await expect.poll(() => app.windows().some(page => page.url().startsWith(origin))).toBe(true)
    const page = app.windows().find(page => page.url().startsWith(origin))!
    await expect.poll(() => app.windows().some(page => page.url().includes('recorder.html'))).toBe(true)
    const hud = app.windows().find(page => page.url().includes('recorder.html'))!
    await page.evaluate(() => {
      Object.assign(window, { recorderResult: null })
      window.overlayDesktop.on('transcription.final', result => Object.assign(window, { recorderResult: result.text }))
    })
    await page.evaluate(() => window.overlayDesktop.call('transcription.start', { target: 'system', model: 'cloud' }))
    // Native media capture must actually be live before stopping it.
    await expect.poll(() => hud.evaluate(() => document.querySelector('#status')?.textContent)).toBe('Listening…')
    // Give the synthetic media source a short, measured capture interval.
    await hud.waitForTimeout(300)
    await page.evaluate(() => window.overlayDesktop.call('transcription.stop', undefined))
    await expect.poll(() => page.evaluate(() => (window as unknown as { recorderResult: string }).recorderResult)).toBe('Recorder acceptance passed')
    expect(audioBytes).toBeGreaterThan(100)
    expect((await page.evaluate(() => window.overlayDesktop.call('transcription.status', undefined))).recording).toBe(false)
    const firstRequestBytes = audioBytes
    await hud.evaluate(() => {
      const local = window as unknown as { recorder: { onStart(callback: (model: string, epoch: number) => void): void }; cancelledCaptureEpoch: number }
      local.recorder.onStart((_model, epoch) => { local.cancelledCaptureEpoch = epoch })
    })
    await page.evaluate(() => window.overlayDesktop.call('transcription.start', { target: 'system', model: 'cloud' }))
    await expect(hud.getByRole('status')).toHaveText('Listening…')
    await page.evaluate(() => window.overlayDesktop.call('auth.signedOut', undefined))
    const staleRejected = await hud.evaluate(async () => {
      const local = window as unknown as { recorder: { transcribe(input: unknown, epoch: number): Promise<unknown> }; cancelledCaptureEpoch: number }
      try {
        await local.recorder.transcribe({ audio: new Uint8Array([1, 2, 3]), mime: 'audio/wav', model: 'cloud' }, local.cancelledCaptureEpoch)
        return false
      } catch { return true }
    })
    expect(staleRejected).toBe(true)
    expect(audioBytes).toBe(firstRequestBytes)
  } finally {
    await app.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(profile, { recursive: true, force: true })
  }
})
