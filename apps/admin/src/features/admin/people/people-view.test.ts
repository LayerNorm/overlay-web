import assert from 'node:assert/strict'
import test from 'node:test'

import { initials, relativeDay, shortDate } from './people-view'

const NOW = Date.UTC(2026, 9, 31, 15)

test('initials prefer the name and fall back to the email', () => {
  assert.equal(initials('Riley Chen', 'riley@example.com'), 'RC')
  assert.equal(initials('Priya Ana Natarajan', undefined), 'PA')
  assert.equal(initials(undefined, 'sam@example.com'), 'S')
  assert.equal(initials('  ', undefined), '?')
})

test('dates read relative to today in UTC', () => {
  assert.equal(relativeDay('2026-10-31', NOW), 'Today')
  assert.equal(relativeDay('2026-10-30', NOW), 'Yesterday')
  assert.equal(relativeDay('2026-10-27', NOW), '4 days ago')
  assert.equal(relativeDay('2026-10-12', NOW), 'Oct 12')
  assert.equal(shortDate(Date.UTC(2025, 11, 2), NOW), 'Dec 2, 2025')
})
