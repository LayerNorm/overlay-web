import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldSyncSlashInput } from './useComposerTextState'

test('slash token typing refreshes composer state (menu opens and filters)', () => {
  assert.equal(shouldSyncSlashInput('/', ''), true)
  assert.equal(shouldSyncSlashInput('/ver', '/'), true)
  assert.equal(shouldSyncSlashInput('/version', '/ver'), true)
})

test('the whitespace transition after a slash token refreshes state (menu closes)', () => {
  assert.equal(shouldSyncSlashInput('/version ', '/version'), true)
  // The menu is already closed after the first whitespace keystroke, so
  // continued prose typing does not need further state refreshes.
  assert.equal(shouldSyncSlashInput('/version trailing', '/version '), false)
})

test('normal typing never refreshes composer state', () => {
  assert.equal(shouldSyncSlashInput('hello', ''), false)
  assert.equal(shouldSyncSlashInput('hello world', 'hello'), false)
  assert.equal(shouldSyncSlashInput('', 'plain'), false)
})

test('state refresh stops once the text is no longer slash-prefixed', () => {
  assert.equal(shouldSyncSlashInput('plain', '/'), true)
  assert.equal(shouldSyncSlashInput('plain', 'plain'), false)
  assert.equal(shouldSyncSlashInput('', '/'), true)
})
