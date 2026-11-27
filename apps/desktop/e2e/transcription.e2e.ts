import { _electron as electron, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DesktopBridge } from '../packages/overlay-desktop-bridge/src/index'

test('a pinned local model transcribes synthetic speech through the native bridge', async () => {
  test.setTimeout(15 * 60_000)
  const directory = mkdtempSync(join(tmpdir(), 'overlay-asr-smoke-'))
  const audio = join(directory, 'speech.wav')
  const offlineHook = join(directory, 'offline.cjs')
  const isolatedAppData = join(directory, 'app-data')
  mkdirSync(isolatedAppData, { recursive: true })
  // Deny networking only to the actual ASR helper, after the model download.
  // The app still needs the trusted HTTP fixture to exercise its real preload.
  writeFileSync(
    offlineHook,
    `require('electron').app.setPath('appData',${JSON.stringify(isolatedAppData)});
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const original=cp.execFile;globalThis.offlineTranscriptions=0;
cp.execFile=function(file,args,options,callback){
 if(!file.endsWith('/whisperkit-cli'))return original(file,args,options,callback);
 globalThis.offlineTranscriptions++;
 fs.copyFileSync(args[args.indexOf('--audio-path')+1],${JSON.stringify(test.info().outputPath('helper-input-'))}+globalThis.offlineTranscriptions+'.wav');
 const mode=globalThis.asrDiagnosticMode||'default';
 const policy=mode==='ip-only'?'(version 1)(allow default)(deny network-outbound (remote ip "*:*"))(deny network-inbound (local ip "*:*"))':'(version 1)(allow default)(deny network*)';
 const extra=mode==='vad-none'?['--chunking-strategy','none']:[];
 const actualArgs=mode==='timestamps'?args.filter(arg=>arg!=='--without-timestamps'):args;
 return original('/usr/bin/sandbox-exec',['-p',policy,file,...actualArgs,...extra,'--verbose'],options,(error,stdout,stderr)=>{
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
    const modelDirectory = join(
      isolatedAppData,
      'Overlay/models/whisperkit-coreml/openai_whisper-base'
    )
    const integrity: { path: string; expected: string; actual: string; size: number }[] = []
    for (const spec of [
      {
        repo: 'argmaxinc/whisperkit-coreml',
        revision: '97a5bf9bbc74c7d9c12c755d04dea59e672e3808',
        folder: 'openai_whisper-base',
        local: modelDirectory
      },
      {
        repo: 'openai/whisper-base',
        revision: 'e37978b90ca9030d5170a5c07aadb050351a65bb',
        folder: '',
        local: join(modelDirectory, 'tokenizer')
      }
    ]) {
      const response = await fetch(
        `https://huggingface.co/api/models/${spec.repo}/tree/${spec.revision}${spec.folder ? '/' + spec.folder : ''}?recursive=true`,
        { signal: AbortSignal.timeout(30_000) }
      )
      expect(response.ok).toBe(true)
      const entries = (await response.json()) as {
        type: string
        path: string
        oid: string
        size: number
        lfs?: { oid: string; size: number }
      }[]
      for (const entry of entries.filter((e) => e.type === 'file')) {
        if (!spec.folder && !['tokenizer.json', 'tokenizer_config.json'].includes(entry.path))
          continue
        const relative = spec.folder ? entry.path.slice(spec.folder.length + 1) : entry.path
        const bytes = readFileSync(join(spec.local, relative))
        const actual = entry.lfs
          ? createHash('sha256').update(bytes).digest('hex')
          : createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
        integrity.push({
          path: relative,
          expected: entry.lfs?.oid ?? entry.oid,
          actual,
          size: bytes.length
        })
      }
    }
    writeFileSync(
      test.info().outputPath('model-integrity.json'),
      JSON.stringify(integrity, null, 2)
    )
    expect(integrity.length).toBeGreaterThan(5)
    expect(integrity.filter((file) => file.expected !== file.actual)).toEqual([])
    console.info('Verified model and tokenizer files:', integrity.length)
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
      const floatingAudio = join(directory, 'speech-float.wav')
      execFileSync('/usr/bin/afconvert', [
        '-f',
        'WAVE',
        '-d',
        'LEF32@16000',
        '-c',
        '1',
        join(directory, 'speech.aiff'),
        floatingAudio
      ])
      for (const mode of ['float32', 'timestamps', 'vad-none']) {
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
          [...readFileSync(mode === 'float32' ? floatingAudio : audio)]
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
        const context = new AudioContext({ sampleRate: 16000, sinkId: { type: 'none' } })
        const buffer = await context.decodeAudioData(Uint8Array.from(bytes).buffer)
        const destination = context.createMediaStreamDestination()
        Object.assign(window, { qaSpeechFinished: false })
        navigator.mediaDevices.getUserMedia = async () => {
          const source = context.createBufferSource()
          source.buffer = buffer
          source.onended = () => Object.assign(window, { qaSpeechFinished: true })
          source.connect(destination)
          await context.resume()
          // Allow the worklet to connect before the first word. Play once;
          // truncating a second loop changes the recognizer's input phrase.
          source.start(context.currentTime + 0.5)
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
    // CI audio clocks can advance slower than wall time. Waiting a fixed five
    // seconds can truncate the sentence even though capture itself is healthy.
    await expect
      .poll(
        () =>
          hud.evaluate(() => (window as unknown as { qaSpeechFinished: boolean }).qaSpeechFinished),
        { timeout: 45_000 }
      )
      .toBe(true)
    await hud.waitForTimeout(500)
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
