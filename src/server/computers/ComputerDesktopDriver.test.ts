import assert from 'node:assert/strict'
import test from 'node:test'
import type { SandboxCommandRequest, SandboxInstance } from '@overlay/sandbox-runtime'
import { ComputerDesktopDriverError, run } from './ComputerDesktopDriver'

const PNG = new Uint8Array([137, 80, 78, 71])

test('driver script is written only after its marker check fails', async () => {
  const computer = fakeComputer()
  await run(computer.instance, 'wait', { ms: 1 })
  await run(computer.instance, 'wait', { ms: 1 })
  assert.equal(computer.writes.length, 1)
  assert.match(computer.writes[0]!.path, /driver-1\.py$/)
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

function fakeComputer(desktop = true) {
  const writes: Array<{ path: string; contents: Uint8Array; mode?: number }> = []
  const commands: SandboxCommandRequest[] = []
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
      const payload = JSON.parse(request.args?.[4] ?? '{}') as { command?: string }
      const installed = writes.some((file) => file.path.endsWith('/driver-1.py'))
      const stdout = !installed
        ? ''
        : JSON.stringify(payload.command === 'capabilities'
          ? {
              version: '1',
              display: ':0',
              screen: { width: 1280, height: 720 },
              input: true,
              screenshot: true,
              missing: [],
            }
          : payload.command === 'screenshot'
            ? { width: 1280, height: 720 }
            : { success: true })
      return {
        id: 'desktop-command',
        events: async function* () {},
        wait: async () => ({
          commandId: 'desktop-command',
          exitCode: installed ? 0 : 1,
          stdout,
          stderr: '',
          startedAt: 0,
          endedAt: 1,
        }),
        cancel: async () => {},
      }
    },
  } as unknown as SandboxInstance
  return { instance, writes, commands, readPaths }
}
