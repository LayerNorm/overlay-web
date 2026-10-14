import assert from 'node:assert/strict'
import test from 'node:test'
import { hexToHsv, hsvToHex, normalizeHex } from './color-utils'

test('typed colors are tidied into six-digit lowercase hex, and junk is refused', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc')
  assert.equal(normalizeHex(' 14B8A6 '), '#14b8a6')
  assert.equal(normalizeHex('#14b8a6'), '#14b8a6')
  for (const bad of ['', '#12', '#12345', '#1234567', 'red', '#gggggg']) assert.equal(normalizeHex(bad), null, bad)
})

test('hex survives a round trip through HSV for the avatar palette and for arbitrary colors', () => {
  for (const hex of ['#f5f5f4', '#8a6240', '#dc2626', '#ea580c', '#f59e0b', '#16a34a', '#14b8a6', '#2563eb', '#7c3aed', '#db2777', '#64748b', '#000000', '#ffffff', '#123456']) {
    assert.equal(hsvToHex(hexToHsv(hex)), hex, hex)
  }
})

test('the corners of the picker are what they should be', () => {
  assert.equal(hsvToHex({ h: 0, s: 1, v: 1 }), '#ff0000')
  assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), '#00ff00')
  assert.equal(hsvToHex({ h: 240, s: 1, v: 1 }), '#0000ff')
  assert.equal(hsvToHex({ h: 200, s: 0, v: 1 }), '#ffffff')
  assert.equal(hsvToHex({ h: 200, s: 1, v: 0 }), '#000000')
  assert.deepEqual(hexToHsv('#ff0000'), { h: 0, s: 1, v: 1 })
  // Out-of-range input is held inside the picker.
  assert.equal(hsvToHex({ h: 360, s: 2, v: 2 }), '#ff0000')
})
