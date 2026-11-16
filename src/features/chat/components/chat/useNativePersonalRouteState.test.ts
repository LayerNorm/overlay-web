import assert from 'node:assert/strict'
import test from 'node:test'
import { chatViewerUserId } from './useNativePersonalRouteState'

test('a recovered browser session replaces an initially missing server identity', () => {
  assert.equal(chatViewerUserId(null, null, true), null)
  assert.equal(chatViewerUserId(null, 'viewer', false), 'viewer')
})

test('the server identity is only a fallback while browser authentication loads', () => {
  assert.equal(chatViewerUserId('initial', null, true), 'initial')
  assert.equal(chatViewerUserId('initial', 'current', false), 'current')
  assert.equal(chatViewerUserId('initial', null, false), null)
})
