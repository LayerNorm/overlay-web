import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentAutosaveScheduler } from './agent-autosave-scheduler'

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

test('debounces changes and coalesces updates behind an in-flight save', async () => {
  const scheduler = createAgentAutosaveScheduler(10)
  const saves: string[] = []
  let persisted = ''
  let releaseFirst: (() => void) | undefined
  scheduler.schedule(async () => {
    saves.push('old')
    await new Promise<void>((resolve) => { releaseFirst = resolve })
    persisted = 'old'
  }, true)
  await wait(15)
  scheduler.schedule(async () => { saves.push('newer') }, true)
  await wait(5)
  scheduler.schedule(async () => {
    saves.push('newest')
    persisted = 'newest'
  }, true)
  await wait(15)
  assert.deepEqual(saves, ['old'])
  releaseFirst?.()
  await wait(10)
  assert.deepEqual(saves, ['old', 'newest'])
  assert.equal(persisted, 'newest')
  scheduler.cancel()
})

test('flushes immediately and never saves invalid state', async () => {
  const scheduler = createAgentAutosaveScheduler(100)
  const saves: string[] = []
  scheduler.schedule(async () => { saves.push('invalid') }, false)
  scheduler.flush(async () => { saves.push('valid') }, true)
  await wait(0)
  assert.deepEqual(saves, ['valid'])
  scheduler.cancel()
})
