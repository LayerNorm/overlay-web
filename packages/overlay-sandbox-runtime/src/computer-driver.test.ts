import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { COMPUTER_DRIVER_SOURCE, DRIVER_VERSION } from './computer-driver/driver'

const pythonCheck = spawnSync('python3', ['--version'], { encoding: 'utf8' })
const pythonPath = pythonCheck.status === 0
  ? execFileSync('which', ['python3'], { encoding: 'utf8' }).trim()
  : undefined
const shellCheck = spawnSync('sh', ['-c', 'true'], { encoding: 'utf8' })

if (!pythonPath || shellCheck.status !== 0) {
  test('computer driver tests require Python 3 and sh', (t) => {
    t.skip('Python 3 or sh is unavailable; install both to run the computer driver tests.')
  })
} else {
  test('driver scales clicks and repeats scroll buttons', (t) => {
    const harness = createHarness(t)
    const click = harness.run('click', { x: 100, y: 50, maxWidth: 1280, confirm: true })
    assert.equal(click.status, 0)
    const scrollUp = harness.run('scroll', { direction: 'up', amount: 2, x: 100, y: 50 })
    const scrollDown = harness.run('scroll', { direction: 'down', amount: 3, x: 100, y: 50 })
    assert.equal(scrollUp.status, 0)
    assert.equal(scrollDown.status, 0)

    const commands = readFileSync(harness.xdotoolLog, 'utf8')
    assert.match(commands, /mousemove --sync 200 100/)
    assert.match(commands, /click --repeat 1 --delay 80 1/)
    assert.match(commands, /click --repeat 2 --delay 80 4/)
    assert.match(commands, /click --repeat 3 --delay 80 5/)
  })

  test('the installed driver reports the version the server checks for', (t) => {
    // The server rejects any capabilities report whose version differs from DRIVER_VERSION, so a stale literal in the
    // Python source breaks every computer's screen and browser tools.
    const harness = createHarness(t)
    const capabilities = harness.run('capabilities', {})
    assert.equal(capabilities.status, 0)
    assert.equal((capabilities.payload as { version?: string }).version, DRIVER_VERSION)
  })

  test('driver captures and downsizes screenshots with ImageMagick import', (t) => {
    const harness = createHarness(t)
    const screenshot = harness.run('screenshot', { maxWidth: 1280 })
    assert.equal(screenshot.status, 0)
    assert.deepEqual(screenshot.payload, { width: 1280, height: 720 })
    assert.match(readFileSync(harness.importLog, 'utf8'), /-resize 1280x>/)
  })

  test('missing xdotool reports desktop_unsupported and the missing tool', (t) => {
    const harness = createHarness(t)
    const emptyPath = join(harness.directory, 'empty-path')
    mkdirSync(emptyPath)
    const result = harness.run('click', { x: 10, y: 10 }, { PATH: emptyPath })
    assert.equal(result.status, 1)
    assert.equal(result.payload.error?.code, 'desktop_unsupported')
    assert.deepEqual(result.payload.error?.missing, ['xdotool'])
  })

  test('xdotool errors include bounded diagnostics and redact typed text', (t) => {
    const harness = createHarness(t)
    const typedText = 'private typed phrase'
    const stderr = `xdotool rejected ${typedText} ${'x'.repeat(400)}`
    const result = harness.run(
      'type',
      { text: typedText },
      {
        OVERLAY_XDOTOOL_FAIL_SUBCOMMAND: 'type',
        OVERLAY_XDOTOOL_STDERR: stderr,
        OVERLAY_XDOTOOL_EXIT_CODE: '7',
      },
    )

    assert.equal(result.status, 1)
    assert.equal(result.payload.error?.code, 'desktop_driver_failed')
    assert.equal(result.payload.error?.message, 'The desktop input command failed.')
    assert.deepEqual(result.payload.error?.detail, {
      exit: 7,
      subcommand: 'type',
      stderr: `xdotool rejected [redacted] ${'x'.repeat(400)}`.slice(0, 300),
    })
    assert.equal(result.payload.error?.detail?.stderr.length, 300)
    assert.equal(JSON.stringify(result.payload.error?.detail).includes(typedText), false)
  })

  test('xdotool spawn failures identify the subcommand without stderr', (t) => {
    const harness = createHarness(t)
    const brokenBin = join(harness.directory, 'broken-bin')
    mkdirSync(brokenBin)
    writeFileSync(join(brokenBin, 'xdotool'), [
      '#!/bin/sh',
      'if [ "$1" = getdisplaygeometry ]; then',
      '  printf "2560 1440\\n"',
      '  rm "$0"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'), { mode: 0o700 })
    const result = harness.run('click', { x: 10, y: 10 }, {
      PATH: `${brokenBin}:${process.env.PATH ?? ''}`,
    })

    assert.equal(result.status, 1)
    assert.deepEqual(result.payload.error?.detail, {
      exit: 'spawn_failed',
      subcommand: 'mousemove',
      stderr: '',
    })
  })

  test('a held input lock reports desktop_busy', async (t) => {
    const harness = createHarness(t)
    const lockPath = join(harness.directory, 'computer', 'input.lock')
    mkdirSync(join(harness.directory, 'computer'), { recursive: true })
    const holder = spawn(pythonPath!, [
      '-u',
      '-c',
      `import fcntl,time; f=open(${JSON.stringify(lockPath)},'a'); fcntl.flock(f,fcntl.LOCK_EX); print('locked',flush=True); time.sleep(10)`,
    ], { stdio: ['ignore', 'pipe', 'inherit'] })
    t.after(() => { holder.kill() })
    await new Promise<void>((resolve, reject) => {
      holder.once('error', reject)
      holder.stdout.once('data', () => resolve())
    })

    const result = harness.run('click', { x: 10, y: 10 })
    assert.equal(result.status, 1)
    assert.equal(result.payload.error?.code, 'desktop_busy')
  })

  test('terminal sessions start, return output and exit status, and cancel process groups', async (t) => {
    if (spawnSync('sh', ['-c', 'command -v setsid'], { encoding: 'utf8' }).status !== 0) {
      t.skip('Terminal process-group tests require the Linux setsid utility.')
      return
    }
    const harness = createHarness(t)
    const completed = harness.run('terminal_start', { terminalCommand: "printf 'terminal output'" })
    assert.equal(completed.status, 0)
    const completedId = completed.payload.id
    assert.match(completedId ?? '', /^t-[0-9a-f]{12}$/)
    t.after(() => rmSync(join(harness.directory, 'computer', 'terminals', completedId!), { recursive: true, force: true }))

    let read = harness.run('terminal_read', { id: completedId })
    const deadline = Date.now() + 3000
    while (read.payload.exitCode === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      read = harness.run('terminal_read', { id: completedId })
    }
    assert.equal(read.status, 0)
    assert.equal(read.payload.running, false)
    assert.equal(read.payload.exitCode, 0)
    assert.equal(read.payload.output, 'terminal output')

    const running = harness.run('terminal_start', { terminalCommand: 'sleep 30' })
    assert.equal(running.status, 0)
    const runningId = running.payload.id
    assert.match(runningId ?? '', /^t-[0-9a-f]{12}$/)
    t.after(() => rmSync(join(harness.directory, 'computer', 'terminals', runningId!), { recursive: true, force: true }))

    const cancelled = harness.run('terminal_cancel', { id: runningId })
    assert.equal(cancelled.status, 0)
    assert.equal(cancelled.payload.running, false)
    assert.equal(typeof cancelled.payload.exitCode, 'number')
    assert.notEqual(cancelled.payload.exitCode, 0)
  })

  test('terminal sessions reject invalid ids before resolving paths', (t) => {
    const harness = createHarness(t)
    const result = harness.run('terminal_read', { id: '../x' })
    assert.equal(result.status, 1)
    assert.equal(result.payload.error?.code, 'invalid_input')
  })

  test('recording stop writes chapters at each note, removes the capture and is idempotent', async (t) => {
    const harness = createHarness(t)
    installFakeFfmpeg(harness.directory)
    const started = harness.run('recording_start', { title: 'QA run' })
    assert.equal(started.status, 0)
    const id = started.payload.id!
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(harness.run('recording_annotate', { id, label: 'Open settings', status: 'setup' }).status, 0)
    assert.equal(harness.run('recording_annotate', { id, label: 'Saved', status: 'pass' }).status, 0)

    const stopped = harness.run('recording_stop', { id })
    assert.equal(stopped.status, 0, stopped.stdout)
    const recordingDirectory = join(harness.directory, 'computer', 'recordings', id)
    const chapters = readFileSync(join(recordingDirectory, 'recording.mp4'), 'utf8')
    const starts = [...chapters.matchAll(/START=(\d+)/g)].map(match => Number(match[1]))
    const titles = [...chapters.matchAll(/^title=(.*)$/gm)].map(match => match[1])
    assert.deepEqual(titles, ['QA run', 'Start', '[setup] Open settings', '[pass] Saved'])
    assert.equal(starts[0], 0)
    assert.ok(starts[1]! > 0, 'the first note starts its chapter at the note, not at 0')
    assert.ok(starts[2]! >= starts[1]!)
    assert.equal(existsSync(join(recordingDirectory, 'capture.mkv')), false)

    const again = harness.run('recording_stop', { id })
    assert.equal(again.status, 0)
    assert.deepEqual(again.payload, stopped.payload)
    assert.deepEqual(harness.run('recording_status', {}).payload, { active: null })
    assert.equal(harness.run('recording_annotate', { id, label: 'late' }).payload.error?.code, 'recording_stopped')
  })

  test('recording annotate is rejected once the capture has ended', async (t) => {
    const harness = createHarness(t)
    installFakeFfmpeg(harness.directory)
    const started = harness.run('recording_start', {}, { OVERLAY_FAKE_FFMPEG_SECONDS: '1' })
    assert.equal(started.status, 0)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const late = harness.run('recording_annotate', { id: started.payload.id, label: 'after the limit' })
    assert.equal(late.status, 1)
    assert.equal(late.payload.error?.code, 'recording_ended')
  })

  test('recording start prunes stopped recordings beyond the newest five', (t) => {
    const harness = createHarness(t)
    installFakeFfmpeg(harness.directory)
    const root = join(harness.directory, 'computer', 'recordings')
    const ids = Array.from({ length: 7 }, (_, index) => `r-00000000000${index}`)
    ids.forEach((id, index) => {
      mkdirSync(join(root, id), { recursive: true })
      writeFileSync(join(root, id, 'stopped'), '0')
      utimesSync(join(root, id, 'stopped'), 1_000 + index, 1_000 + index)
    })
    const started = harness.run('recording_start', {})
    assert.equal(started.status, 0)
    const remaining = readdirSync(root).filter(entry => ids.includes(entry)).sort()
    assert.equal(harness.run('recording_stop', { id: started.payload.id }).status, 0)
    assert.deepEqual(remaining, ids.slice(2))
  })
}

/** ffmpeg captures until SIGINT (or OVERLAY_FAKE_FFMPEG_SECONDS); the finalize call copies the chapter metadata as the MP4. */
function installFakeFfmpeg(directory: string) {
  writeFileSync(join(directory, 'bin', 'ffmpeg'), [
    '#!/bin/sh',
    'for last do :; done',
    'case "$*" in',
    '  *x11grab*)',
    '    printf mkv > "$last"',
    '    trap "exit 0" INT TERM',
    '    if [ -n "$OVERLAY_FAKE_FFMPEG_SECONDS" ]; then sleep "$OVERLAY_FAKE_FFMPEG_SECONDS"; exit 0; fi',
    '    while :; do sleep 0.1; done ;;',
    '  *-map_chapters*)',
    '    count=0; previous=""',
    '    for argument do',
    '      if [ "$previous" = "-i" ]; then count=$((count + 1)); [ "$count" -eq 2 ] && metadata="$argument"; fi',
    '      previous="$argument"',
    '    done',
    '    cp "$metadata" "$last" ;;',
    'esac',
    '',
  ].join('\n'), { mode: 0o700 })
  writeFileSync(join(directory, 'bin', 'ffprobe'), '#!/bin/sh\nprintf "30\\n"\n', { mode: 0o700 })
}

function createHarness(t: { after(callback: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), 'overlay-computer-driver-'))
  const bin = join(directory, 'bin')
  const scriptPath = join(directory, 'driver.py')
  const xdotoolLog = join(directory, 'xdotool.log')
  const importLog = join(directory, 'import.log')
  mkdirSync(bin)
  writeFileSync(scriptPath, COMPUTER_DRIVER_SOURCE.replaceAll('/tmp/overlay-computer', join(directory, 'computer')), { mode: 0o700 })
  writeFileSync(join(bin, 'xdotool'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$OVERLAY_XDOTOOL_LOG"',
    'if [ "$1" = "$OVERLAY_XDOTOOL_FAIL_SUBCOMMAND" ]; then',
    '  printf "%s" "$OVERLAY_XDOTOOL_STDERR" >&2',
    '  exit "${OVERLAY_XDOTOOL_EXIT_CODE:-1}"',
    'fi',
    'if [ "$1" = getdisplaygeometry ]; then printf "2560 1440\\n"; fi',
    'if [ "$1" = getmouselocation ]; then printf "X=0\\nY=0\\n"; fi',
    '',
  ].join('\n'), { mode: 0o700 })
  writeFileSync(join(bin, 'import'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$OVERLAY_IMPORT_LOG"',
    'for output do :; done',
    'printf "\\211PNG\\r\\n\\032\\n\\000\\000\\000\\rIHDR\\000\\000\\005\\000\\000\\000\\002\\320" > "$output"',
    '',
  ].join('\n'), { mode: 0o700 })
  const environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    OVERLAY_XDOTOOL_LOG: xdotoolLog,
    OVERLAY_IMPORT_LOG: importLog,
  }
  t.after(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    directory,
    xdotoolLog,
    importLog,
    run(command: string, args: Record<string, unknown>, overrides: NodeJS.ProcessEnv = {}) {
      const result = spawnSync(
        pythonPath!,
        [scriptPath, JSON.stringify({ command, ...args })],
        { encoding: 'utf8', env: { ...environment, ...overrides }, timeout: 5000 },
      )
      return {
        ...result,
        payload: JSON.parse(result.stdout.trim()) as {
          error?: {
            code?: string
            message?: string
            missing?: string[]
            detail?: { exit?: number | string; subcommand?: string; stderr: string }
          }
          width?: number
          height?: number
          id?: string
          running?: boolean
          exitCode?: number | null
          output?: string
        },
      }
    },
  }
}
