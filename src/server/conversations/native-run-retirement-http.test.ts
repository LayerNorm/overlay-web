import { strict as assert } from 'node:assert'
import test from 'node:test'
import { isNativeRunRetiredError, nativeRunRetiredError } from '@/shared/agents/native-run-retirement'
import { nativeRunRetirementErrorResponse } from './native-run-retirement-http'

test('retirement errors become the exact 410 response, including wrapped errors', async () => {
  const response = nativeRunRetirementErrorResponse(
    new Error(`ConvexError: ${nativeRunRetiredError().message}`),
  )
  assert.ok(response)
  assert.equal(response.status, 410)
  assert.deepEqual(await response.json(), {
    code: 'native_runner_retired',
    error: 'The harness has changed. Start a new thread to continue.',
  })
})

test('non-retirement errors remain unclassified', () => {
  assert.equal(nativeRunRetirementErrorResponse(new Error('provider unavailable')), null)
  assert.equal(isNativeRunRetiredError(new Error('provider unavailable')), false)
})
