import assert from 'node:assert/strict'
import test from 'node:test'
import type { DriveSavedEntry } from '@layernorm/overlay-agent-bridge-protocol'
import type { NormalizedAgentEvent } from './adapter.js'
import { RuntimeDriveController } from './runtime-drive-controller.js'

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw Error('not initialized') }
  let reject: (error: Error) => void = () => { throw Error('not initialized') }
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse })
  return { promise, resolve, reject }
}
const entries: DriveSavedEntry[] = [
  { fileId: 'file', path: 'notes/report.md', kind: 'file' },
  { fileId: 'folder', path: 'notes', kind: 'folder' },
]
const completed = { type: 'completed', payload: { usage: {} } } satisfies NormalizedAgentEvent
const action = { type: 'action', payload: { actionId: 'write', title: 'Write report', status: 'completed' } } satisfies NormalizedAgentEvent

test('background writes never hold provider output and final completion waits for acknowledged files', async () => {
  const background = deferred<DriveSavedEntry[]>(), final = deferred<DriveSavedEntry[]>()
  const events: NormalizedAgentEvent[] = [], calls: (boolean | undefined)[] = []
  let closes = 0
  const controller = new RuntimeDriveController({ workingDirectory: '/drive', additionalDirectories: [],
    sync: async finishing => { calls.push(finishing); return finishing ? final.promise : background.promise },
    close: async () => { closes++ },
  }, async event => { events.push(event) }, async () => {})
  try {
    await controller.emit(action)
    await controller.emit(action)
    await controller.emit({ type: 'text_checkpoint', payload: { text: 'Still working' } })
    assert.equal(calls.length, 1)
    assert.equal(events.at(-1)?.type, 'text_checkpoint')
    const finishing = controller.emit(completed)
    assert.equal(events.some(event => event.type === 'completed'), false)
    background.resolve(entries)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls, [undefined, true])
    assert.equal(events.at(-1)?.type, 'drive_sync')
    assert.equal(events.some(event => event.type === 'completed'), false)
    final.resolve(entries)
    await finishing
    assert.deepEqual(events.slice(-2), [
      { type: 'drive_sync', payload: { state: 'saved', fileCount: 1, folderCount: 1, entries } }, completed,
    ])
    await controller.emit(completed)
    assert.equal(events.filter(event => event.type === 'completed').length, 1)
    assert.equal(closes, 1)
  } finally { background.resolve([]); final.resolve([]); await controller.closeAfterStopped() }
})

test('a rejected final write leaves an unsaved failure and never reports completion', async () => {
  const events: NormalizedAgentEvent[] = []
  let closes = 0
  const controller = new RuntimeDriveController({ workingDirectory: '/drive', additionalDirectories: [],
    sync: async () => { throw Error('private provider response must not enter transcript') },
    close: async () => { closes++ },
  }, async event => { events.push(event) }, async () => {})
  await controller.emit(completed)
  assert.deepEqual(events.map(event => event.type), ['drive_sync', 'drive_sync', 'failed'])
  assert.equal(events.some(event => event.type === 'completed'), false)
  assert.equal(JSON.stringify(events).includes('private provider response'), false)
  assert.equal(closes, 1)
})

test('Stop forwards cancellation immediately while draining the existing write before releasing ownership', async () => {
  const pending = deferred<DriveSavedEntry[]>(), events: NormalizedAgentEvent[] = []
  let closes = 0, writes = 0
  const controller = new RuntimeDriveController({ workingDirectory: '/drive', additionalDirectories: [],
    sync: async () => { writes++; return pending.promise }, close: async () => { closes++ },
  }, async event => { events.push(event) }, async () => {})
  try {
    await controller.emit(action)
    const stopped = controller.emit({ type: 'cancelled', payload: {} })
    assert.equal(events.at(-1)?.type, 'cancelled')
    assert.equal(closes, 0)
    pending.resolve(entries)
    await stopped
    assert.equal(events.at(-1)?.type, 'cancelled')
    assert.equal(writes, 1)
    assert.equal(closes, 1)
    await Promise.all([controller.closeAfterStopped(), controller.closeAfterStopped()])
    assert.equal(closes, 1)
  } finally { pending.resolve([]); await controller.closeAfterStopped() }
})

test('provider failures remain failures even if the final drive sync fails too', async () => {
  const events: NormalizedAgentEvent[] = []
  const failure = { type: 'failed', payload: { code: 'provider_error', message: 'Provider failed', retryable: true } } satisfies NormalizedAgentEvent
  const controller = new RuntimeDriveController({ workingDirectory: '/drive', additionalDirectories: [],
    sync: async () => { throw Error('write failed') }, close: async () => {},
  }, async event => { events.push(event) }, async () => {})
  await controller.emit(failure)
  assert.deepEqual(events.at(-1), failure)
})

test('the periodic save catches writes without action events and coalesces slow passes', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] })
  const pending = deferred<DriveSavedEntry[]>()
  let writes = 0
  const controller = new RuntimeDriveController({ workingDirectory: '/drive', additionalDirectories: [],
    sync: async () => { writes++; return pending.promise }, close: async () => {},
  }, async () => {}, async () => {})
  try {
    context.mock.timers.tick(15000)
    assert.equal(writes, 1)
    context.mock.timers.tick(45000)
    assert.equal(writes, 1)
    pending.resolve([])
    await new Promise(resolve => setImmediate(resolve))
    context.mock.timers.tick(15000)
    assert.equal(writes, 2)
    await new Promise(resolve => setImmediate(resolve))
    await controller.closeAfterStopped()
    context.mock.timers.tick(60000)
    assert.equal(writes, 2)
  } finally { pending.resolve([]); await controller.closeAfterStopped() }
})

test('a failed writer stays fenced until native termination is confirmed', async () => {
  const events: NormalizedAgentEvent[] = []
  let stopped = false, closes = 0, writes = 0
  const controller = new RuntimeDriveController({workingDirectory: '/drive', additionalDirectories: [],
    sync: async () => {writes++; return []}, close: async () => {closes++},
  }, async event => {events.push(event)}, async () => {if (!stopped) throw Error('Uncertain writer')})
  await controller.emit({type: 'failed', payload: {code: 'adapter_prompt_failed', message: 'Failed', retryable: true}})
  assert.equal(writes, 0)
  assert.equal(closes, 0)
  assert.deepEqual(events.map(event => event.type), ['drive_sync', 'process_observation'])
  stopped = true
  await controller.closeAfterStopped()
  assert.equal(closes, 1)
})

test('confirmed failure stops the native writer before final saving and unlocking', async () => {
  const order: string[] = []
  const controller = new RuntimeDriveController({workingDirectory: '/drive', additionalDirectories: [],
    sync: async () => {order.push('save'); return []}, close: async () => {order.push('unlock')},
  }, async event => {order.push(event.type)}, async () => {order.push('stop')})
  await controller.emit({type: 'failed', payload: {code: 'adapter_prompt_failed', message: 'Failed', retryable: true}})
  assert.ok(order.indexOf('stop') < order.indexOf('save'))
  assert.ok(order.indexOf('save') < order.indexOf('unlock'))
  assert.ok(order.includes('failed'))
})
