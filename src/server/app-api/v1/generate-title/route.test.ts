import { describe, expect, it } from 'vitest'
import { extractTitle } from './extract-title'

describe('extractTitle', () => {
  it('strips a complete reasoning block before the title', () => {
    expect(extractTitle('<think>user asks about tides</think>\nOcean Tides Explained')).toBe(
      'Ocean Tides Explained',
    )
  })

  it('strips case-insensitive multiline thinking blocks', () => {
    expect(extractTitle('<THINKING>private\nreasoning</tHiNkInG>\nGarden Planning')).toBe(
      'Garden Planning',
    )
  })

  it('drops an unclosed reasoning block', () => {
    expect(extractTitle('<think>still reasoning')).toBe('')
  })

  it('keeps title text before an unclosed reasoning block', () => {
    expect(extractTitle('Garden Planning\n<thinking>unfinished')).toBe('Garden Planning')
  })

  it('strips a title prefix and quotes', () => {
    expect(extractTitle('Title: "Balcony Herb Garden"')).toBe('Balcony Herb Garden')
  })

  it('keeps the first non-empty line of plain text', () => {
    expect(extractTitle('Desk Organization Tips\n')).toBe('Desk Organization Tips')
  })
})
