import { expect, test } from 'vitest'
import { createHarnessToolScheduler, harnessFileLockKey, harnessRunModesConflict, harnessToolRunMode } from './tool-run-modes'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('read-only tools run in parallel; control, approval-gated and unknown tools run alone', () => {
  expect(harnessToolRunMode('web_search', {})).toEqual({ kind: 'parallel' })
  expect(harnessToolRunMode('harness_set_plan', {}, { control: true })).toEqual({ kind: 'exclusive' })
  expect(harnessToolRunMode('computer_exec', { command: 'ls' }, { needsApproval: true })).toEqual({ kind: 'exclusive' })
  expect(harnessToolRunMode('create_note', { title: 'x' })).toEqual({ kind: 'exclusive' })
  expect(harnessToolRunMode('some_mcp_tool', {})).toEqual({ kind: 'exclusive' })
})

test('file locks let reads overlap and keep writes to one path in order', () => {
  const readA = harnessToolRunMode('computer_read_file', { path: '/repo/a.ts' })
  const readA2 = harnessToolRunMode('computer_read_file', { path: '/repo//a.ts' })
  const writeA = harnessToolRunMode('computer_write_file', { path: '/repo/./a.ts' })
  const writeB = harnessToolRunMode('computer_write_file', { path: '/repo/b.ts' })
  const exec = harnessToolRunMode('computer_exec', { command: 'npm test' })
  expect(harnessRunModesConflict(readA, readA2)).toBe(false)
  expect(harnessRunModesConflict(readA, writeA)).toBe(true)
  expect(harnessRunModesConflict(writeA, writeB)).toBe(false)
  expect(harnessRunModesConflict(exec, readA)).toBe(true)
  expect(harnessRunModesConflict(exec, harnessToolRunMode('web_fetch', {}))).toBe(false)
})

test('path aliases share a file lock; unknown file identities lock the computer for writes', () => {
  expect(harnessFileLockKey('/repo/sub/../a.txt')).toBe('file:/repo/a.txt')
  expect(harnessFileLockKey('/repo//./a.txt/')).toBe('file:/repo/a.txt')
  expect(harnessFileLockKey('src/a.txt')).toBeUndefined()
  expect(harnessFileLockKey('~/a.txt')).toBeUndefined()
  const write = harnessToolRunMode('computer_write_file', { path: '/tmp/output.txt' })
  expect(harnessRunModesConflict(write, harnessToolRunMode('computer_write_file', { path: '/tmp/sub/../output.txt' }))).toBe(true)
  const relativeWrite = harnessToolRunMode('computer_write_file', { path: 'output.txt' })
  expect(harnessRunModesConflict(relativeWrite, harnessToolRunMode('computer_read_file', { path: '/tmp/other.txt' }))).toBe(true)
  expect(harnessRunModesConflict(relativeWrite, harnessToolRunMode('web_search', {}))).toBe(false)
})

test('publishing a file waits for writes to that file but not for other files or reads', () => {
  const publish = harnessToolRunMode('computer_publish_file', { sourcePath: '/tmp/video.mp4' })
  expect(harnessRunModesConflict(publish, harnessToolRunMode('computer_write_file', { path: '/tmp/./video.mp4' }))).toBe(true)
  expect(harnessRunModesConflict(publish, harnessToolRunMode('computer_write_file', { path: '/tmp/other.mp4' }))).toBe(false)
  expect(harnessRunModesConflict(publish, harnessToolRunMode('computer_read_file', { path: '/tmp/video.mp4' }))).toBe(false)
  expect(harnessRunModesConflict(
    harnessToolRunMode('computer_publish_file', { sourcePath: 'video.mp4' }),
    harnessToolRunMode('computer_write_file', { path: '/tmp/video.mp4' }),
  )).toBe(true)
})

test('terminal reads share the computer while starts lock it; desktop actions serialize', () => {
  const read = harnessToolRunMode('computer_terminal', { action: 'read', id: 't-000000000000' })
  const start = harnessToolRunMode('computer_terminal', { action: 'start', command: 'npm run dev' })
  expect(harnessRunModesConflict(read, read)).toBe(false)
  expect(harnessRunModesConflict(read, start)).toBe(true)
  expect(harnessRunModesConflict(
    harnessToolRunMode('computer_browser', { action: 'click' }),
    harnessToolRunMode('computer_screenshot', {}),
  )).toBe(true)
  expect(harnessRunModesConflict(
    harnessToolRunMode('computer_browser', { action: 'snapshot' }),
    harnessToolRunMode('computer_read_file', { path: '/a' }),
  )).toBe(false)
})

test('note and task writes lock per id', () => {
  const a = harnessToolRunMode('edit_note', { noteId: 'a' })
  expect(harnessRunModesConflict(a, harnessToolRunMode('append_to_note', { noteId: 'a' }))).toBe(true)
  expect(harnessRunModesConflict(a, harnessToolRunMode('append_to_note', { noteId: 'b' }))).toBe(false)
  expect(harnessRunModesConflict(
    harnessToolRunMode('update_task', { taskId: 't' }),
    harnessToolRunMode('comment_on_task', { taskId: 't' }),
  )).toBe(true)
})

test('scheduler overlaps independent work and orders conflicting work by call order', async () => {
  const scheduler = createHarnessToolScheduler()
  const events: string[] = []
  const gate = deferred()
  const parallel = { kind: 'parallel' } as const
  const write = harnessToolRunMode('computer_write_file', { path: '/a' })

  const first = scheduler.run(parallel, async () => { events.push('read1:start'); await gate.promise; events.push('read1:end') })
  const second = scheduler.run(parallel, async () => { events.push('read2:start') })
  const writeOne = scheduler.run(write, async () => { events.push('write1'); await gate.promise })
  const writeTwo = scheduler.run(write, async () => { events.push('write2') })
  const control = scheduler.run({ kind: 'exclusive' }, async () => { events.push('control') })
  const after = scheduler.run(parallel, async () => { events.push('read3') })

  await new Promise(resolve => setTimeout(resolve, 5))
  expect(events).toEqual(['read1:start', 'read2:start', 'write1'])
  gate.resolve()
  await Promise.all([first, second, writeOne, writeTwo, control, after])
  expect(events.indexOf('write2')).toBeGreaterThan(events.indexOf('write1'))
  expect(events.indexOf('control')).toBeGreaterThan(events.indexOf('write2'))
  expect(events.indexOf('control')).toBeGreaterThan(events.indexOf('read1:end'))
  expect(events.at(-1)).toBe('read3')
  expect(scheduler.pending).toBe(0)
})

test('a failed task does not block later conflicting tasks', async () => {
  const scheduler = createHarnessToolScheduler()
  const failed = scheduler.run({ kind: 'exclusive' }, async () => { throw new Error('boom') })
  const next = scheduler.run({ kind: 'exclusive' }, async () => 'ran')
  await expect(failed).rejects.toThrow('boom')
  await expect(next).resolves.toBe('ran')
})
