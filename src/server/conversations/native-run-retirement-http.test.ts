import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  isNativeRunRetiredError, nativeRunRetiredError, nativeThreadUnavailableError,
  NATIVE_THREAD_UNAVAILABLE_CODE, NATIVE_THREAD_UNAVAILABLE_MESSAGE,
} from '@/shared/agents/native-run-retirement'
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

test('deployment overlap is a temporary 503, not permanent retirement or a network diagnosis', async () => {
  const error = nativeThreadUnavailableError()
  assert.equal(isNativeRunRetiredError(error), false)
  const response = nativeRunRetirementErrorResponse(error)
  assert.ok(response)
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('Retry-After'), '10')
  assert.deepEqual(await response.json(), {
    code: NATIVE_THREAD_UNAVAILABLE_CODE,
    error: NATIVE_THREAD_UNAVAILABLE_MESSAGE,
  })
})
