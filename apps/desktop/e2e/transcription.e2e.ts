import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DesktopBridge } from '../packages/overlay-desktop-bridge/src/index'

test('a pinned local model transcribes synthetic speech through the native bridge', async () => {
  test.setTimeout(15 * 60_000)
  const directory = mkdtempSync(join(tmpdir(), 'overlay-asr-smoke-'))
  const audio = join(directory, 'speech.wav')
  const offlineHook = join(directory, 'offline.cjs')
  // Deny networking only to the actual ASR helper, after the model download.
  // The app still needs the trusted HTTP fixture to exercise its real preload.
  writeFileSync(
    offlineHook,
    `const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const original=cp.execFile;globalThis.offlineTranscriptions=0;
cp.execFile=function(file,args,options,callback){
 if(!file.endsWith('/whisperkit-cli'))return original(file,args,options,callback);
 globalThis.offlineTranscriptions++;
 const mode=globalThis.asrDiagnosticMode||'default';
 const policy=mode==='ip-only'?'(version 1)(allow default)(deny network-outbound (remote ip "*:*"))(deny network-inbound (local ip "*:*"))':'(version 1)(allow default)(deny network*)';
 const extra=mode==='cpu'?['--audio-encoder-compute-units','cpuOnly','--text-decoder-compute-units','cpuOnly']:mode==='english'?['--language','en']:[];
 return original('/usr/bin/sandbox-exec',['-p',policy,file,...args,...extra,'--verbose'],options,(error,stdout,stderr)=>{
   fs.writeFileSync(${JSON.stringify(test.info().outputPath('whisper-helper-'))}+mode+'.log',String(stdout||'')+'\\n'+String(stderr||''));
   const directory=args[args.indexOf('--report-path')+1];
   if(directory&&fs.existsSync(directory))for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.json')))fs.copyFileSync(path.join(directory,name),${JSON.stringify(test.info().outputPath('whisper-report-'))}+mode+'-'+name);
   callback(error,stdout,stderr);
 });
}`
  )
  execFileSync('/usr/bin/say', [
    '-v',
    'Samantha',
    '-r',
    '160',
    '-o',
    join(directory, 'speech.aiff'),
    'The desktop application keeps all of my work together.'
  ])
  execFileSync('/usr/bin/afconvert', [
    '-f',
    'WAVE',
    '-d',
    'LEI16@16000',
    '-c',
    '1',
    join(directory, 'speech.aiff'),
    audio
  ])
  // Pin the voice across macOS runner images and retain the synthetic input for diagnosis.
  copyFileSync(audio, test.info().outputPath('synthetic-speech.wav'))
  console.info(
    execFileSync('/usr/bin/afinfo', [audio], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => /estimated duration|Data format/.test(line))
      .join('; ')
  )
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<h1>Local dictation smoke</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({
      args: [
        '-r',
        offlineHook,
        '.',
        `--user-data-dir=${join(directory, 'profile')}`,
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required'
      ],
      env: { ...process.env, APP_SERVER_URL: origin }
    })
    await expect
      .poll(() => app!.windows().some((page) => page.url().startsWith(origin)), { timeout: 30_000 })
      .toBe(true)
    const page = app.windows().find((page) => page.url().startsWith(origin))!
    await page.evaluate(async () => {
      const bridge = (window as unknown as { overlayDesktop: DesktopBridge }).overlayDesktop
      await bridge.call('transcription.downloadModel', { id: 'openai_whisper-base' })
    })
    const models = await page.evaluate(() =>
      (window as unknown as { overlayDesktop: DesktopBridge }).overlayDesktop.call(
        'transcription.listModels',
        undefined
      )
    )
    expect(models.find((model) => model.id === 'openai_whisper-base')?.downloaded).toBe(true)
    const result = await page.evaluate(
      async (bytes) =>
        (window as unknown as { overlayDesktop: DesktopBridge }).overlayDesktop.call(
          'transcription.transcribe',
          { audio: Uint8Array.from(bytes), mime: 'audio/wav', model: 'openai_whisper-base' }
        ),
      [...readFileSync(audio)]
    )
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { offlineTranscriptions: number }).offlineTranscriptions
      )
    ).toBe(1)
    if (!result.text.toLowerCase().includes('desktop')) {
      for (const mode of ['ip-only', 'cpu', 'english']) {
        await app.evaluate((_electron, value) => {
          ;(globalThis as unknown as { asrDiagnosticMode: string }).asrDiagnosticMode = value
        }, mode)
        const diagnostic = await page.evaluate(
          async (bytes) => {
            try {
              return await (
                window as unknown as { overlayDesktop: DesktopBridge }
              ).overlayDesktop.call('transcription.transcribe', {
                audio: Uint8Array.from(bytes),
                mime: 'audio/wav',
                model: 'openai_whisper-base'
              })
            } catch (error) {
              return { error: error instanceof Error ? error.message : 'unknown' }
            }
          },
          [...readFileSync(audio)]
        )
        console.info('ASR diagnostic', mode, JSON.stringify(diagnostic))
      }
    }
    expect(result.text.toLowerCase()).toContain('desktop')
    expect(result.text.toLowerCase()).toContain('work together')
    // Exercise the actual native PCM capture path too; a direct WAV call alone
    // cannot prove that microphone capture reaches offline inference.
    await page.evaluate(() => {
      Object.assign(window, { offlineHudTranscript: null })
      const bridge = (window as unknown as { overlayDesktop: DesktopBridge }).overlayDesktop
      bridge.on('transcription.final', (result) =>
        Object.assign(window, { offlineHudTranscript: result.text })
      )
    })
    await expect
      .poll(() => app!.windows().some((page) => page.url().includes('recorder.html')))
      .toBe(true)
    const hud = app.windows().find((page) => page.url().includes('recorder.html'))!
    // Feed known speech into a real capture MediaStream deterministically.
    // Chromium's default fake microphone is a tone, not spoken audio.
    await hud.evaluate(
      async (bytes) => {
        const context = new AudioContext()
        const buffer = await context.decodeAudioData(Uint8Array.from(bytes).buffer)
        const destination = context.createMediaStreamDestination()
        navigator.mediaDevices.getUserMedia = async () => {
          const source = context.createBufferSource()
          source.buffer = buffer
          source.loop = true
          source.connect(destination)
          await context.resume()
          source.start()
          return destination.stream
        }
      },
      [...readFileSync(audio)]
    )
    await page.evaluate(() =>
      (window as unknown as { overlayDesktop: DesktopBridge }).overlayDesktop.call(
        'transcription.start',
        { target: 'system', model: 'openai_whisper-base' }
      )
    )
    await expect(hud.getByRole('status')).toHaveText('Listening…')
    await hud.waitForTimeout(5000)
    await page.evaluate(() =>
      (window as unknown as { overlayDesktop: DesktopBridge }).overlayDesktop.call(
        'transcription.stop',
        undefined
      )
    )
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { offlineHudTranscript: string | null }).offlineHudTranscript
          ),
        { timeout: 180_000 }
      )
      .toMatch(/desktop/i)
    expect(
      await page.evaluate(() =>
        (window as unknown as { offlineHudTranscript: string }).offlineHudTranscript.toLowerCase()
      )
    ).toContain('work together')
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { offlineTranscriptions: number }).offlineTranscriptions
      )
    ).toBe(2)
  } finally {
    await app?.close().catch(() => {})
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
