import assert from 'node:assert/strict'
import test from 'node:test'
import { extractTitle } from './extract-title'

test('strips a complete reasoning block before the title', () => {
  assert.equal(extractTitle('<think>user asks about tides</think>\nOcean Tides Explained'), 'Ocean Tides Explained')
})

test('strips case-insensitive multiline thinking blocks', () => {
  assert.equal(extractTitle('<THINKING>private\nreasoning</tHiNkInG>\nGarden Planning'), 'Garden Planning')
})

test('drops an unclosed reasoning block', () => {
  assert.equal(extractTitle('<think>still reasoning'), '')
})

test('keeps title text before an unclosed reasoning block', () => {
  assert.equal(extractTitle('Garden Planning\n<thinking>unfinished'), 'Garden Planning')
})

test('strips a title prefix and quotes', () => {
  assert.equal(extractTitle('Title: "Balcony Herb Garden"'), 'Balcony Herb Garden')
})

test('keeps the first non-empty line of plain text', () => {
  assert.equal(extractTitle('Desk Organization Tips\n'), 'Desk Organization Tips')
})
