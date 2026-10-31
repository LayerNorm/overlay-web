import { _electron as electron, expect, test } from '@playwright/test'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('the native HUD captures audio and delivers the transcription without a preload name collision', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'overlay-recorder-qa-'))
  let audioBytes = 0
  let holdAuth = true
  let authAllowed = true
  const pendingAuth: ServerResponse[] = []
  let failNext = false
  let requests = 0
  let holdTranscription = false
  const pendingTranscriptions: ServerResponse[] = []
  const server = createServer((request, response) => {
    if (request.url === '/api/auth/session') {
      response.setHeader('Content-Type', 'application/json')
      if (holdAuth) pendingAuth.push(response)
      else response.end(JSON.stringify({ authenticated: authAllowed }))
    } else if (request.url === '/api/v1/transcribe') {
      request.on('data', (chunk) => {
        audioBytes += chunk.length
      })
      request.on('end', () => {
        response.setHeader('Content-Type', 'application/json')
        requests++
        if (holdTranscription) {
          pendingTranscriptions.push(response)
          return
        }
        response.statusCode = failNext ? 503 : 200
        failNext = false
        response.end(JSON.stringify({ text: 'Recorder acceptance passed' }))
      })
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end('<title>Recorder QA</title><h1>Recorder fixture</h1>')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const app = await electron.launch({
    args: [
      '.',
      `--user-data-dir=${profile}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream'
    ],
    env: { ...process.env, APP_SERVER_URL: origin }
  })
  try {
    await app.firstWindow()
    await expect.poll(() => app.windows().some((page) => page.url().startsWith(origin))).toBe(true)
    const page = app.windows().find((page) => page.url().startsWith(origin))!
    await expect
      .poll(() => app.windows().some((page) => page.url().includes('recorder.html')))
      .toBe(true)
    const hud = app.windows().find((page) => page.url().includes('recorder.html'))!
    hud.on('console', (message) => {
      if (message.text().startsWith('Microphone acquisition:')) console.info(message.text())
    })
    await hud.evaluate(() => {
      const qa = window as unknown as { qaStreams: MediaStream[] }
      qa.qaStreams = []
      const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const began = performance.now()
        const stream = await open(constraints)
        console.info(`Microphone acquisition: ${Math.round(performance.now() - began)}ms`)
        qa.qaStreams.push(stream)
        return stream
      }
    })
    expect(
      await hud.evaluate(() => (window as unknown as { qaStreams: MediaStream[] }).qaStreams.length)
    ).toBe(0)
    await page.evaluate(() => {
      Object.assign(window, { recorderResult: null, finalCount: 0 })
      window.overlayDesktop.on('transcription.final', (result) => {
        const state = window as unknown as { finalCount: number }
        state.finalCount++
        Object.assign(window, { recorderResult: result.text })
      })
    })
    await page.evaluate(() =>
      window.overlayDesktop.call('transcription.start', { target: 'system', model: 'cloud' })
    )
    // Native media capture must actually be live before stopping it.
    await expect
      .poll(() => hud.evaluate(() => document.querySelector('#status')?.textContent))
      .toBe('Listening…')
    expect(pendingAuth.length).toBeGreaterThan(0)
    const firstAudioMs = (
      await page.evaluate(() => window.overlayDesktop.call('transcription.status', undefined))
    ).firstAudioMs
    expect(firstAudioMs).toBeGreaterThanOrEqual(0)
    console.info(`First native PCM frame: ${firstAudioMs}ms; cloud admission still blocked`)
    expect(
      await hud.evaluate(
        () =>
          (window as unknown as { qaStreams: MediaStream[] }).qaStreams[0].getTracks()[0].readyState
      )
    ).toBe('live')
    // First audio is real even while session admission is deliberately blocked.
    holdAuth = false
    for (const response of pendingAuth) response.end(JSON.stringify({ authenticated: authAllowed }))
    await hud.waitForTimeout(150)
    await hud.screenshot({ path: 'test-results/dictation-listening.png', omitBackground: true })
    // Give the synthetic media source a short, measured capture interval.
    await hud.waitForTimeout(300)
    await page.evaluate(() => window.overlayDesktop.call('transcription.stop', undefined))
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { recorderResult: string }).recorderResult)
      )
      .toBe('Recorder acceptance passed')
    expect(audioBytes).toBeGreaterThan(100)
    expect(
      await hud.evaluate(() =>
        (window as unknown as { qaStreams: MediaStream[] }).qaStreams.every((stream) =>
          stream.getTracks().every((track) => track.readyState === 'ended')
        )
      )
    ).toBe(true)
    expect(
      (await page.evaluate(() => window.overlayDesktop.call('transcription.status', undefined)))
        .recording
    ).toBe(false)
    // A provider failure retains audio for an explicit retry, without reopening the mic.
    failNext = true
    await page.evaluate(() =>
      window.overlayDesktop.call('transcription.start', { target: 'system', model: 'cloud' })
    )
    await expect(hud.getByRole('status')).toHaveText('Listening…')
    console.info(
      `Repeated native PCM frame: ${(await page.evaluate(() => window.overlayDesktop.call('transcription.status', undefined))).firstAudioMs}ms`
    )
    await hud.waitForTimeout(150)
    await hud.getByRole('button', { name: 'Finish dictation' }).click()
    await expect(hud.getByRole('button', { name: 'Retry transcription' })).toBeVisible()
    await expect(hud.locator('#notice')).not.toContainText('remote method')
    const beforeRetry = requests
    await hud.getByRole('button', { name: 'Retry transcription' }).click()
    await expect.poll(() => requests).toBe(beforeRetry + 1)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.overlayDesktop.call('transcription.status', undefined)))
            .phase
      )
      .toMatch(/ready|delivered/)
    await hud.getByRole('button', { name: 'Dismiss dictation' }).click()
    // Dismiss while the provider is in flight: abort its request and reject late paste.
    holdTranscription = true
    const beforeCancel = await page.evaluate(
      () => (window as unknown as { finalCount: number }).finalCount
    )
    await page.evaluate(() =>
      window.overlayDesktop.call('transcription.start', { target: 'system', model: 'cloud' })
    )
    await expect(hud.getByRole('status')).toHaveText('Listening…')
    console.info(
      `Repeated native PCM frame: ${(await page.evaluate(() => window.overlayDesktop.call('transcription.status', undefined))).firstAudioMs}ms`
    )
    await hud.waitForTimeout(150)
    await hud.getByRole('button', { name: 'Finish dictation' }).click()
    await expect.poll(() => pendingTranscriptions.length).toBe(1)
    await hud.getByRole('button', { name: 'Dismiss dictation' }).click()
    await expect.poll(() => pendingTranscriptions[0].destroyed).toBe(true)
    expect(
      await page.evaluate(() => (window as unknown as { finalCount: number }).finalCount)
    ).toBe(beforeCancel)
    holdTranscription = false
    const firstRequestBytes = audioBytes
    await hud.evaluate(() => {
      const local = window as unknown as {
        recorder: { onStart(callback: (model: string, epoch: number) => void): void }
        cancelledCaptureEpoch: number
      }
      local.recorder.onStart((_model, epoch) => {
        local.cancelledCaptureEpoch = epoch
      })
    })
    await page.evaluate(() =>
      window.overlayDesktop.call('transcription.start', { target: 'system', model: 'cloud' })
    )
    await expect(hud.getByRole('status')).toHaveText('Listening…')
    console.info(
      `Repeated native PCM frame: ${(await page.evaluate(() => window.overlayDesktop.call('transcription.status', undefined))).firstAudioMs}ms`
    )
    await page.evaluate(() => window.overlayDesktop.call('auth.signedOut', undefined))
    const staleRejected = await hud.evaluate(async () => {
      const local = window as unknown as {
        recorder: { transcribe(input: unknown, epoch: number): Promise<unknown> }
        cancelledCaptureEpoch: number
      }
      try {
        await local.recorder.transcribe(
          { audio: new Uint8Array([1, 2, 3]), mime: 'audio/wav', model: 'cloud' },
          local.cancelledCaptureEpoch
        )
        return false
      } catch {
        return true
      }
    })
    expect(staleRejected).toBe(true)
    await expect
      .poll(() =>
        hud.evaluate(() =>
          (window as unknown as { qaStreams: MediaStream[] }).qaStreams.every((stream) =>
            stream.getTracks().every((track) => track.readyState === 'ended')
          )
        )
      )
      .toBe(true)
    expect(audioBytes).toBe(firstRequestBytes)
    authAllowed = false
    await page.evaluate(() =>
      window.overlayDesktop.call('transcription.start', { target: 'system', model: 'cloud' })
    )
    await expect(hud.getByRole('status')).toHaveText('Unavailable')
    await expect(hud.locator('#notice')).toHaveText('Sign in to Overlay first.')
    await expect
      .poll(() =>
        hud.evaluate(() =>
          (window as unknown as { qaStreams: MediaStream[] }).qaStreams.every((stream) =>
            stream.getTracks().every((track) => track.readyState === 'ended')
          )
        )
      )
      .toBe(true)
    expect(audioBytes).toBe(firstRequestBytes)
  } finally {
    await app.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(profile, { recursive: true, force: true })
  }
})
