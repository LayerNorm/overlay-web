import assert from 'node:assert/strict'
import test from 'node:test'
import { roomMessageTime } from './room-message-time'

test('room timestamps preserve the existing locale, precision and local timezone', () => {
  for (const timestamp of [0, -1, Date.parse('2026-11-10T08:00:00Z'), Date.parse('2026-06-10T23:59:00Z')]) {
    assert.equal(roomMessageTime(timestamp), new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit',
    }))
  }
})

test('invalid room timestamps retain the existing non-throwing fallback', () => {
  for (const timestamp of [NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
    assert.equal(roomMessageTime(timestamp), new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit',
    }))
  }
})
