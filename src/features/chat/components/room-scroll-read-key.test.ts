import assert from 'node:assert/strict'
import { test } from 'node:test'
import { roomScrollReadKey } from './room-scroll-read-key'

test('scrolling the same transcript keeps the read key', () => {
  const messages = [{ id: 'a' }, { id: 'b' }]
  assert.equal(roomScrollReadKey('c1', messages), roomScrollReadKey('c1', [...messages]))
})

test('new messages, a replaced latest message or another room change the read key', () => {
  const base = roomScrollReadKey('c1', [{ id: 'a' }, { id: 'b' }])
  assert.notEqual(roomScrollReadKey('c1', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]), base)
  assert.notEqual(roomScrollReadKey('c1', [{ id: 'a' }, { id: 'x' }]), base)
  assert.notEqual(roomScrollReadKey('c2', [{ id: 'a' }, { id: 'b' }]), base)
})
