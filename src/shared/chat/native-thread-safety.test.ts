import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NATIVE_RUN_RETIRED_CODE,
  NATIVE_RUN_RETIRED_MESSAGE,
  NATIVE_THREAD_UNAVAILABLE_CODE,
  NATIVE_THREAD_UNAVAILABLE_MESSAGE,
} from '../agents/native-run-retirement'
import {
  nativeThreadSafetyNotice,
  nativeThreadSafetyStatus,
} from './native-thread-safety'

test('only authoritative compatibility codes identify retired and temporarily unavailable threads', () => {
  assert.equal(nativeThreadSafetyStatus({ readOnly: false }), 'writable')
  assert.equal(nativeThreadSafetyStatus({ readOnly: true, code: NATIVE_RUN_RETIRED_CODE }), 'retired')
  assert.equal(nativeThreadSafetyStatus({ readOnly: true, code: NATIVE_THREAD_UNAVAILABLE_CODE }), 'unavailable')
  for (const value of [null, undefined, {}, { readOnly: true }, { status: 410 }, { message: NATIVE_RUN_RETIRED_MESSAGE }, { readOnly: true, code: 'unknown' }]) {
    assert.equal(nativeThreadSafetyStatus(value), 'error')
  }
  assert.equal(nativeThreadSafetyNotice('writable'), null)
  assert.equal(nativeThreadSafetyNotice('retired'), NATIVE_RUN_RETIRED_MESSAGE)
  assert.equal(nativeThreadSafetyNotice('unavailable'), NATIVE_THREAD_UNAVAILABLE_MESSAGE)
  assert.equal(nativeThreadSafetyNotice('error'), 'Could not check this thread. Please try again.')
})
