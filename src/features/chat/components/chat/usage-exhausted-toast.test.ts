import assert from 'node:assert/strict'
import test from 'node:test'
import { usageExhaustionVariantForError } from './usage-exhausted-toast'

test('usage errors resolve to paid or free billing notices', () => {
  assert.equal(usageExhaustionVariantForError('weekly_limit'), 'free')
  assert.equal(usageExhaustionVariantForError("You've used this week's free chats."), 'free')
  assert.equal(usageExhaustionVariantForError('insufficient_credits'), 'paid')
  assert.equal(usageExhaustionVariantForError('No budget remaining'), 'paid')
  assert.equal(usageExhaustionVariantForError('Connection failed'), null)
})
