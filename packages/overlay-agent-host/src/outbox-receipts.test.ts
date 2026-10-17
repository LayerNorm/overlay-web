import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {OutboxReceipts} from './outbox-receipts'
import {SqliteHostStateStore} from './state'

test('a source watermark completes while an unrelated upload pass remains pending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'outbox-receipt-'))
  const state = new SqliteHostStateStore(join(directory, 'host.sqlite')), receipts = new OutboxReceipts()
  let release: () => void = () => undefined
  const unrelated = new Promise<void>(resolve => {release = resolve})
  try {
    state.appendEvent({protocolVersion: 1, eventId: 'source-output', environmentId: 'environment', runId: 'run', occurredAt: 1,
      execution: {attemptId: 'source', generation: 1}, type: 'text_checkpoint', payload: {text: 'Retain this'}})
    let entered: () => void = () => undefined
    const flushing = new Promise<void>(resolve => {entered = resolve})
    const drained = receipts.drainThrough({state, runId: 'run', attemptId: 'source', throughSequence: 1,
      flush: () => {entered(); return unrelated}})
    await flushing
    state.acknowledgeEvents('run', 1, 'source')
    receipts.record({protocolVersion: 1, accepted: true, acknowledgedSequence: 1})
    await drained
    assert.equal(state.lastEventSequence('run', 'source'), 1)
    const admitted = {commandId: 'command', attemptId: 'next', generation: 2, hostBootId: 'boot', sourceEventCursor: 1,
      canonicalTextOffset: 19, hardDeadlineAt: Date.now() + 60000}
    receipts.record({protocolVersion: 1, accepted: true, acknowledgedSequence: 2, nativeStartAdmission: admitted})
    assert.deepEqual(receipts.takeNativeAdmission('command'), admitted)
    assert.equal(receipts.takeNativeAdmission('command'), undefined)
  } finally {release(); await unrelated; state.close(); await rm(directory, {recursive: true, force: true})}
})
