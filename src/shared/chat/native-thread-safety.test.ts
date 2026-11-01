import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NATIVE_RUN_RETIRED_CODE,
  NATIVE_RUN_RETIRED_MESSAGE,
  NATIVE_THREAD_UNAVAILABLE_CODE,
  NATIVE_THREAD_UNAVAILABLE_MESSAGE,
} from '../agents/native-run-retirement'
import {
  NATIVE_THREAD_SAFETY_CHANGED,
  nativeThreadSafetyNotice,
  nativeThreadSafetyStatus,
  observeNativeThreadSafetyResponse,
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

test('compatibility failures invalidate visible scopes without consuming their response body or inventing retirement', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const target = new EventTarget()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  let invalidations = 0
  target.addEventListener(NATIVE_THREAD_SAFETY_CHANGED, () => { invalidations += 1 })
  for (const [status, code] of [[410, NATIVE_RUN_RETIRED_CODE], [503, NATIVE_THREAD_UNAVAILABLE_CODE]] as const) {
    const response = Response.json({ code, error: 'server detail' }, { status })
    await observeNativeThreadSafetyResponse(response)
    assert.equal(response.bodyUsed, false)
    assert.deepEqual(await response.json(), { code, error: 'server detail' })
  }
  assert.equal(invalidations, 2)
  for (const response of [
    Response.json({ error: NATIVE_RUN_RETIRED_MESSAGE }, { status: 410 }),
    Response.json({ code: 'maintenance' }, { status: 503 }),
    Response.json({ code: NATIVE_RUN_RETIRED_CODE }),
    new Response('upstream unavailable', { status: 503 }),
  ]) {
    await observeNativeThreadSafetyResponse(response)
    assert.equal(response.bodyUsed, false)
  }
  assert.equal(invalidations, 2)
})
