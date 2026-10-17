import assert from 'node:assert/strict'
import {setImmediate} from 'node:timers/promises'
import test from 'node:test'
import {withRunPreparation} from './run-preparation.js'

function deferred<T>() {
  let resolve: (value: T) => void = () => {throw Error('not initialized')}
  const promise = new Promise<T>(accept => {resolve = accept})
  return {promise, resolve}
}

test('preparation reports receipt, serializes heartbeats and drains one in flight before returning', async t => {
  t.mock.timers.enable({apis: ['setInterval']})
  const work = deferred<number>(), heartbeat = deferred<void>(), began = deferred<void>()
  let emitted = 0, returned = false
  const pending = withRunPreparation({enabled: true, active: () => true,
    async emit() {if (++emitted > 1) await heartbeat.promise}, onError(error) {throw error},
  }, () => {began.resolve(); return work.promise}).then(value => {returned = true; return value})
  await began.promise
  assert.equal(emitted, 1)
  t.mock.timers.tick(10_000)
  assert.equal(emitted, 2)
  t.mock.timers.tick(20_000)
  assert.equal(emitted, 2, 'a blocked heartbeat must not create overlapping emissions')
  work.resolve(42)
  await setImmediate()
  assert.equal(returned, false)
  heartbeat.resolve()
  assert.equal(await pending, 42)
  t.mock.timers.tick(60_000)
  assert.equal(emitted, 2, 'no preparation timer survives provider initialization')
})

test('legacy commands send no preparation extension and preparation errors retain the actual failure', async t => {
  t.mock.timers.enable({apis: ['setInterval']})
  let emitted = 0
  const options = {enabled: false, active: () => true, async emit() {emitted++}, onError() {}}
  assert.equal(await withRunPreparation(options, async () => 'legacy'), 'legacy')
  assert.equal(emitted, 0)
  const error = Error('drive authorization rejected')
  await assert.rejects(withRunPreparation({...options, enabled: true}, async () => {throw error}), value => value === error)
  t.mock.timers.tick(60_000)
  assert.equal(emitted, 1)
})
