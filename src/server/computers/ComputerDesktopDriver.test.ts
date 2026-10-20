import assert from 'node:assert/strict'
import test from 'node:test'
import type { SandboxCommandRequest, SandboxInstance } from '@overlay/sandbox-runtime'
import {
  ComputerDesktopDriverError,
  openUrl,
  run,
  runBrowserAction,
} from './ComputerDesktopDriver'

const PNG = new Uint8Array([137, 80, 78, 71])

test('driver script is written only after its marker check fails', async () => {
  const computer = fakeComputer()
  await run(computer.instance, 'wait', { ms: 1 })
  await run(computer.instance, 'wait', { ms: 1 })
  assert.equal(computer.writes.length, 1)
  assert.match(computer.writes[0]!.path, /driver-2\.py$/)
})

test('screenshot reads image bytes from the sandbox file', async () => {
  const computer = fakeComputer()
  const screenshot = await run(computer.instance, 'screenshot')
  assert.deepEqual(screenshot.image, PNG)
  assert.deepEqual(computer.readPaths, ['/tmp/overlay-computer/shot.png'])
})

test('non-desktop instances return desktop_unsupported', async () => {
  const computer = fakeComputer(false)
  await assert.rejects(
    run(computer.instance, 'screenshot'),
    (error: unknown) => error instanceof ComputerDesktopDriverError
      && error.code === 'desktop_unsupported',
  )
  assert.equal(computer.commands.length, 0)
})

test('computer_open_url ensures and navigates the persistent browser', async () => {
  const computer = fakeComputer()
  const result = await openUrl(computer.instance, 'https://example.test/')
  assert.deepEqual(result, { openedWith: 'browser' })
  const browserRequests = computer.requests.filter((request) =>
    request.command === 'browser_ensure' || request.command === 'browser',
  )
  assert.deepEqual(browserRequests.map((request) => request.command), ['browser_ensure', 'browser'])
  assert.equal(browserRequests[1]?.action, 'navigate')
  assert.equal(browserRequests[1]?.url, 'https://example.test/')
})

test('computer_open_url falls back to xdg-open only for desktop_unsupported', async () => {
  const computer = fakeComputer(true, true)
  const result = await openUrl(computer.instance, 'https://example.test/')
  assert.deepEqual(result, { openedWith: 'xdg-open' })
  assert.equal(computer.commands.some((request) => request.command === 'xdg-open'), true)
  assert.equal(computer.requests.some((request) => request.command === 'browser'), false)
})

test('browser snapshot is formatted as text with refs and bounds', async () => {
  const computer = fakeComputer()
  const snapshot = await runBrowserAction(computer.instance, 'snapshot')
  assert.match(snapshot.text, /URL: https:\/\/example\.test\//)
  assert.match(snapshot.text, /Visible page text/)
  assert.match(snapshot.text, /overlay-1 button: Continue/)
  assert.deepEqual(snapshot.result.elements, [{
    ref: 'overlay-1',
    role: 'button',
    name: 'Continue',
    bbox: { x: 10, y: 20, width: 80, height: 30 },
  }])
})

function fakeComputer(desktop = true, browserUnsupported = false) {
  const writes: Array<{ path: string; contents: Uint8Array; mode?: number }> = []
  const commands: SandboxCommandRequest[] = []
  const requests: Array<Record<string, unknown>> = []
  const readPaths: string[] = []
  const instance = {
    provider: 'box',
    reference: 'desktop-test',
    name: 'desktop-test',
    capabilities: { desktop },
    writeFiles: async (files: typeof writes) => { writes.push(...files) },
    readFile: async (path: string) => {
      readPaths.push(path)
      return path === '/tmp/overlay-computer/shot.png' ? PNG : null
    },
    runCommand: async (request: SandboxCommandRequest) => {
      commands.push(request)
      const payload = request.args?.[4]
        ? JSON.parse(request.args[4]) as Record<string, unknown>
        : {}
      if (typeof payload.command === 'string') requests.push(payload)
      const installed = writes.some((file) => file.path.endsWith('/driver-2.py'))
      const isPrepare = request.command === 'sh' && request.args?.[0] === '-c'
      const unsupportedBrowser = browserUnsupported && payload.command === 'browser_ensure'
      const stdout = !installed
        ? ''
        : unsupportedBrowser
          ? JSON.stringify({
              error: {
                code: 'desktop_unsupported',
                message: 'Chromium is not installed.',
                missing: ['chromium'],
              },
            })
          : JSON.stringify(payload.command === 'capabilities'
            ? {
                version: '2',
                display: ':0',
                screen: { width: 1280, height: 720 },
                input: true,
                screenshot: true,
                missing: [],
              }
            : payload.command === 'screenshot'
              ? { width: 1280, height: 720 }
              : payload.command === 'browser_ensure'
                ? { success: true, browser: 'chromium' }
                : payload.command === 'browser' && payload.action === 'snapshot'
                  ? {
                      url: 'https://example.test/',
                      title: 'Example',
                      text: 'Visible page text',
                      elements: [{
                        ref: 'overlay-1',
                        role: 'button',
                        name: 'Continue',
                        bbox: { x: 10, y: 20, width: 80, height: 30 },
                      }],
                    }
                  : { success: true })
      return {
        id: 'desktop-command',
        events: async function* () {},
        wait: async () => ({
          commandId: 'desktop-command',
          exitCode: installed || isPrepare || request.command === 'xdg-open' ? 0 : 1,
          stdout,
          stderr: '',
          startedAt: 0,
          endedAt: 1,
        }),
        cancel: async () => {},
      }
    },
  } as unknown as SandboxInstance
  return { instance, writes, commands, requests, readPaths }
}
