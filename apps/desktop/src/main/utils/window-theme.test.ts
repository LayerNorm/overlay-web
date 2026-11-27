import { describe, expect, it } from 'vitest'
import { themeSourceForColor } from './window-theme'

describe('themeSourceForColor', () => {
  it('maps light and dark page colours to a window appearance', () => {
    expect(themeSourceForColor('#fafafa')).toBe('light')
    expect(themeSourceForColor('rgb(250, 250, 250)')).toBe('light')
    expect(themeSourceForColor('#202020')).toBe('dark')
    expect(themeSourceForColor('#000')).toBe('dark')
    expect(themeSourceForColor('rgba(24, 24, 27, 1)')).toBe('dark')
  })

  it('falls back to the system appearance without a usable colour', () => {
    expect(themeSourceForColor(null)).toBe('system')
    expect(themeSourceForColor('oklch(0.98 0 0)')).toBe('system')
  })
})
