import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import test from 'node:test'
import { COMPUTER_DRIVER_SOURCE } from './computer-driver/driver'

const pythonCheck = spawnSync('python3', ['--version'], { encoding: 'utf8' })
const pythonPath = pythonCheck.status === 0
  ? execFileSync('which', ['python3'], { encoding: 'utf8' }).trim()
  : undefined

function terminateManagedGroup(pid: number) {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

test('browser driver inspects risky click refs and requires confirmation', async (t) => {
  if (!pythonPath) {
    t.skip('Python 3 is unavailable; install python3 to run the browser driver tests.')
    return
  }

  const directory = mkdtempSync(join(tmpdir(), 'overlay-browser-driver-'))
  const bin = join(directory, 'bin')
  const scriptPath = join(directory, 'driver.py')
  const launchLog = join(directory, 'chromium-launch.log')
  const launchPidFile = join(directory, 'chromium-pids.log')
  const readySignal = join(directory, 'chromium-ready')
  const browserLog = join(directory, 'browser.log')
  const managedProcessGroups = new Set<number>()
  mkdirSync(bin)
  writeFileSync(readySignal, 'ready')
  writeFileSync(scriptPath, COMPUTER_DRIVER_SOURCE, { mode: 0o700 })
  writeFileSync(join(bin, 'google-chrome'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$OVERLAY_CHROMIUM_LAUNCH_LOG"',
    'printf "%s\\n" "$$" >> "$OVERLAY_CHROMIUM_PID_FILE"',
    'if [ "$OVERLAY_CHROMIUM_BEHAVIOR" = "early-exit" ]; then',
    '  printf "chromium early exit diagnostic\\n" >&2',
    '  exit 23',
    'fi',
    ': > "$OVERLAY_CHROMIUM_READY_PATH"',
    'exec sleep 60',
  ].join('\n'), { mode: 0o700 })

  const received: Array<{ id?: number; method?: string; params?: { expression?: string } }> = []
  let clicks = 0
  const sockets = new Set<Duplex>()
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/json/version') {
      if (!existsSync(readySignal)) {
        response.statusCode = 503
        response.end('{}')
        return
      }
      response.end(JSON.stringify({
        Browser: 'Chrome/123.0.0.0',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
      }))
      return
    }
    if (request.url === '/json') {
      response.end(JSON.stringify([{
        id: 'page-test',
        type: 'page',
        url: 'https://example.test/',
        title: 'Example',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/test',
      }]))
      return
    }
    response.statusCode = 404
    response.end('{}')
  })
  server.on('upgrade', (request, socket, head) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    const key = request.headers['sec-websocket-key']
    assert.equal(typeof key, 'string')
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'))

    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      while (buffered.length >= 2) {
        const first = buffered[0]!
        const second = buffered[1]!
        let length = second & 0x7f
        let offset = 2
        if (length === 126) {
          if (buffered.length < 4) return
          length = buffered.readUInt16BE(2)
          offset = 4
        } else if (length === 127) {
          if (buffered.length < 10) return
          const longLength = buffered.readBigUInt64BE(2)
          if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) return
          length = Number(longLength)
          offset = 10
        }
        const masked = Boolean(second & 0x80)
        const maskLength = masked ? 4 : 0
        if (buffered.length < offset + maskLength + length) return
        const mask = masked ? buffered.subarray(offset, offset + 4) : null
        offset += maskLength
        const payload = Buffer.from(buffered.subarray(offset, offset + length))
        buffered = buffered.subarray(offset + length)
        if (mask) {
          for (let index = 0; index < payload.length; index += 1) {
            payload[index] = payload[index]! ^ mask[index % 4]!
          }
        }
        if ((first & 0x0f) !== 0x1) continue

        const message = JSON.parse(payload.toString('utf8')) as {
          id?: number
          method?: string
          params?: { expression?: string }
        }
        received.push(message)
        const expression = message.params?.expression ?? ''
        const value = message.method === 'Runtime.evaluate' && expression.includes('querySelectorAll')
          ? {
              type: 'object',
              value: {
                url: 'https://example.test/',
                title: 'Example',
                text: 'Visible page text',
                elements: [
                  { ref: 'overlay-1', role: 'button', name: 'Post', bbox: { x: 10, y: 20, width: 80, height: 30 } },
                  { ref: 'overlay-2', role: 'link', name: 'Home', bbox: { x: 100, y: 20, width: 80, height: 30 } },
                ],
              },
            }
          : message.method === 'Runtime.evaluate' && expression.includes('isSubmit:')
            ? {
                type: 'object',
                value: {
                  role: expression.includes('overlay-1') ? 'button' : 'link',
                  tag: expression.includes('overlay-1') ? 'button' : 'a',
                  type: expression.includes('overlay-1') ? 'submit' : '',
                  name: expression.includes('overlay-1') ? 'Post' : 'Home',
                  isSubmit: expression.includes('overlay-1'),
                },
              }
            : { type: 'boolean', value: true }
        if (message.method === 'Runtime.evaluate' && expression.includes('element.click()')) clicks += 1
        const response = Buffer.from(JSON.stringify({
          id: message.id,
          result: { result: value },
        }))
        if (response.length < 126) {
          socket.write(Buffer.concat([Buffer.from([0x81, response.length]), response]))
        } else {
          const header = Buffer.alloc(4)
          header[0] = 0x81
          header[1] = 126
          header.writeUInt16BE(response.length, 2)
          socket.write(Buffer.concat([header, response]))
        }
      }
    })
    if (head.length > 0) socket.emit('data', head)
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(9222, '127.0.0.1', resolve)
    })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      t.skip('The browser driver test requires 127.0.0.1:9222 to be available.')
      return
    }
    throw error
  }

  t.after(async () => {
    for (const pid of managedProcessGroups) {
      terminateManagedGroup(pid)
    }
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  })

  const environment = {
    ...process.env,
    HOME: directory,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    OVERLAY_COMPUTER_INPUT_LOCK_PATH: join(directory, 'input.lock'),
    OVERLAY_CHROMIUM_LAUNCH_LOG: launchLog,
    OVERLAY_CHROMIUM_PID_FILE: launchPidFile,
    OVERLAY_CHROMIUM_READY_PATH: readySignal,
    OVERLAY_COMPUTER_BROWSER_LOG_PATH: browserLog,
  }
  const run = async (
    command: string,
    args: Record<string, unknown> = {},
    overrides: NodeJS.ProcessEnv = {},
  ) => {
    const result = await new Promise<{
      status: number | null
      stdout: string
      stderr: string
      error?: Error
    }>((resolve) => {
      const child = spawn(pythonPath!, [scriptPath, JSON.stringify({ command, ...args })], {
        env: { ...environment, ...overrides },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
      }, 5000)
      const finish = (result: {
        status: number | null
        stdout: string
        stderr: string
        error?: Error
      }) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(result)
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { stdout += chunk })
      child.stderr.on('data', (chunk: string) => { stderr += chunk })
      child.once('error', (error) => finish({ status: null, stdout, stderr, error }))
      child.once('close', (status) => finish({ status, stdout, stderr }))
    })
    assert.equal(result.error, undefined, result.error?.message)
    const payload = JSON.parse(result.stdout.trim()) as {
      error?: { code?: string; message?: string; missing?: string[] }
      label?: string
      message?: string
      url?: string
      title?: string
      text?: string
      elements?: Array<{ ref?: string }>
      success?: boolean
    }
    return { result, payload }
  }

  const ensured = await run('browser_ensure')
  assert.equal(ensured.result.status, 0)
  assert.deepEqual(ensured.payload, { success: true, browser: 'chromium' })
  assert.equal(existsSync(launchLog), false)

  const rejected = await run('browser', { action: 'navigate', url: 'file:///etc/passwd' })
  assert.equal(rejected.result.status, 1)
  assert.equal(rejected.payload.error?.code, 'invalid_input')

  const snapshot = await run('browser', { action: 'snapshot' })
  assert.equal(snapshot.result.status, 0)
  assert.equal(snapshot.payload.url, 'https://example.test/')
  assert.equal(snapshot.payload.elements?.[0]?.ref, 'overlay-1')

  const blockedClick = await run('browser', { action: 'click', ref: 'overlay-1' })
  assert.equal(blockedClick.result.status, 0)
  assert.deepEqual(blockedClick.payload, {
    success: false,
    error: 'approval_required',
    label: 'Post',
    message: 'This click may post, send, buy, or delete something. Call computer_browser click again with confirm: true to ask the user for approval.',
  })
  assert.equal(clicks, 0)

  const confirmedClick = await run('browser', { action: 'click', ref: 'overlay-1', confirm: true })
  assert.equal(confirmedClick.result.status, 0, confirmedClick.result.stdout + confirmedClick.result.stderr)
  assert.deepEqual(confirmedClick.payload, { success: true })
  assert.equal(clicks, 1)

  const homeClick = await run('browser', { action: 'click', ref: 'overlay-2' })
  assert.equal(homeClick.result.status, 0)
  assert.deepEqual(homeClick.payload, { success: true })
  assert.equal(clicks, 2)

  const evaluations = received.filter((message) => message.method === 'Runtime.evaluate')
  const refExpressions = evaluations
    .map((message) => message.params?.expression ?? '')
    .filter((expression) => expression.includes('document.querySelector('))
  assert.equal(refExpressions.length, 5)
  assert.equal(refExpressions.filter((expression) => expression.includes('element.click()')).length, 2)
  assert.ok(refExpressions.every((expression) => expression.includes('data-overlay-ref')))
  assert.ok(refExpressions.some((expression) => expression.includes('overlay-1') && expression.includes('element.click()')))
  assert.ok(refExpressions.some((expression) => expression.includes('overlay-2') && expression.includes('element.click()')))
  assert.equal(received.every((message) => message.method !== 'Target.createTarget'), true)

  const profile = join(directory, '.config', 'overlay-browser')
  mkdirSync(profile, { recursive: true })
  const singletonLock = join(profile, 'SingletonLock')
  const singletonSocket = join(profile, 'SingletonSocket')
  const singletonCookie = join(profile, 'SingletonCookie')
  const hasPath = (path: string) => {
    try {
      lstatSync(path)
      return true
    } catch {
      return false
    }
  }
  const writeSingletons = (pid: number) => {
    symlinkSync(`fake-host-${pid}`, singletonLock)
    writeFileSync(singletonSocket, 'socket')
    writeFileSync(singletonCookie, 'cookie')
  }
  const launchPids = () => {
    const lines = readFileSync(launchPidFile, 'utf8').trim().split(/\r?\n/)
    return lines.map((line) => Number(line))
  }
  const stopLatestBrowser = () => {
    const pid = launchPids().at(-1)
    assert.ok(pid && Number.isInteger(pid))
    managedProcessGroups.add(pid)
    terminateManagedGroup(pid)
    rmSync(readySignal, { force: true })
  }

  rmSync(readySignal, { force: true })
  writeSingletons(99999999)
  const staleLock = await run('browser_ensure')
  assert.equal(staleLock.result.status, 0, staleLock.result.stdout + staleLock.result.stderr)
  assert.deepEqual(staleLock.payload, { success: true, browser: 'chromium' })
  assert.equal(hasPath(singletonLock), false)
  assert.equal(existsSync(singletonSocket), false)
  assert.equal(existsSync(singletonCookie), false)
  stopLatestBrowser()

  const owner = spawn(
    pythonPath!,
    ['-c', 'import time; time.sleep(60)', `--user-data-dir=${profile}`],
    { detached: true, stdio: 'ignore' },
  )
  const ownerStarted = new Promise<void>((resolve, reject) => {
    owner.once('spawn', () => resolve())
    owner.once('error', reject)
  })
  await ownerStarted
  assert.ok(owner.pid)
  managedProcessGroups.add(owner.pid)
  const ownerClosed = new Promise<NodeJS.Signals | null>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Browser profile owner did not exit.')), 2000)
    owner.once('close', (_code, signal) => {
      clearTimeout(timeout)
      resolve(signal)
    })
  })
  writeSingletons(owner.pid)
  rmSync(readySignal, { force: true })
  const liveOwner = await run('browser_ensure')
  assert.equal(liveOwner.result.status, 0, liveOwner.result.stdout + liveOwner.result.stderr)
  assert.deepEqual(liveOwner.payload, { success: true, browser: 'chromium' })
  assert.equal(await ownerClosed, 'SIGTERM')
  assert.equal(hasPath(singletonLock), false)
  assert.equal(existsSync(singletonSocket), false)
  assert.equal(existsSync(singletonCookie), false)
  stopLatestBrowser()

  writeSingletons(process.pid)
  rmSync(readySignal, { force: true })
  const foreignProcess = await run('browser_ensure')
  assert.equal(foreignProcess.result.status, 0)
  assert.deepEqual(foreignProcess.payload, { success: true, browser: 'chromium' })
  assert.doesNotThrow(() => process.kill(process.pid, 0))
  assert.equal(hasPath(singletonLock), true)
  assert.equal(existsSync(singletonSocket), true)
  assert.equal(existsSync(singletonCookie), true)
  stopLatestBrowser()

  const earlyExit = await run('browser_ensure', {}, { OVERLAY_CHROMIUM_BEHAVIOR: 'early-exit' })
  assert.equal(earlyExit.result.status, 1)
  assert.equal(earlyExit.payload.error?.code, 'desktop_driver_failed')
  assert.match(
    earlyExit.payload.error?.message ?? '',
    /\(google-chrome; exit 23; .*chromium early exit diagnostic\)/,
  )
})
