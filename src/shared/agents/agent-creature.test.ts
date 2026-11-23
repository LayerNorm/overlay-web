import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hexToRgb,
  normalizeCreatureShape,
  themeCreatureFills,
} from './agent-creature'

test('parses six- and three-digit hex colors', () => {
  assert.deepEqual(hexToRgb('#2563eb'), { r: 37, g: 99, b: 235 })
  assert.deepEqual(hexToRgb('#fff'), { r: 255, g: 255, b: 255 })
  assert.equal(hexToRgb('not-a-color'), null)
  assert.equal(hexToRgb('#12345'), null)
})

test('normalizes unknown shapes to the circle body', () => {
  assert.equal(normalizeCreatureShape('droplet'), 'droplet')
  assert.equal(normalizeCreatureShape('cloud'), 'cloud')
  assert.equal(normalizeCreatureShape('dragon'), 'circle')
  assert.equal(normalizeCreatureShape(undefined), 'circle')
  assert.equal(normalizeCreatureShape(''), 'circle')
})

test('adapts extreme bodies per theme and leaves mid-tones alone', () => {
  assert.deepEqual(themeCreatureFills('#2563eb'), { light: '#2563eb', dark: '#2563eb' })
  const dark = themeCreatureFills('#18181b')
  assert.equal(dark.light, '#18181b')
  assert.notEqual(dark.dark, '#18181b')
  const light = themeCreatureFills('#e4e4e7')
  assert.equal(light.dark, '#e4e4e7')
  assert.notEqual(light.light, '#e4e4e7')
  assert.deepEqual(themeCreatureFills('bogus'), { light: 'bogus', dark: 'bogus' })
})
