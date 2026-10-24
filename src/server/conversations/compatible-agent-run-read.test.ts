import assert from 'node:assert/strict'
import test from 'node:test'
import {readCompatibleAgentRun} from './compatible-agent-run-read'
const legacyError = new Error('ArgumentValidationError: Object contains extra field `remoteRunId` that is not in the validator.')

test('strict previous backends receive an unchanged authorized conversation lookup and cannot substitute another run', async () => {
  for (const externalRunId of ['requested', 'another-run']) {
    const calls: (string | undefined)[] = []
    const result = await readCompatibleAgentRun('requested', async id => {
      calls.push(id)
      if (id) throw legacyError
      return {externalRunId}
    })
    assert.deepEqual(calls, ['requested', undefined])
    assert.deepEqual(result, externalRunId === 'requested' ? {externalRunId} : null)
  }
})

test('current backends use the exact selector; authorization and unrelated failures never trigger fallback', async () => {
  assert.deepEqual(await readCompatibleAgentRun('requested', async id => ({externalRunId: id})), {externalRunId: 'requested'})
  for (const error of [new Error('Unauthorized'), new Error('Backend unavailable'),
    new Error('ArgumentValidationError: Object contains extra field `userId`')]) {
    let calls = 0
    await assert.rejects(readCompatibleAgentRun('requested', async () => {calls++; throw error}), value => value === error)
    assert.equal(calls, 1)
  }
})
