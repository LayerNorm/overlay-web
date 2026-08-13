import assert from 'node:assert/strict'
import test from 'node:test'
import { isStripeMissingResourceError } from './stripe-billing'

test('isStripeMissingResourceError matches Stripe resource_missing shapes', () => {
  assert.equal(isStripeMissingResourceError({ code: 'resource_missing', message: 'No such customer' }), true)
  assert.equal(
    isStripeMissingResourceError(new Error("No such subscription: 'sub_1TKxeqPH7ssnO0LIvQigJkN7'")),
    true,
  )
  assert.equal(isStripeMissingResourceError(new Error('card_declined')), false)
})
