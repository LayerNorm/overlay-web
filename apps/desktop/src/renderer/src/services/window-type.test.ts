import { describe, it, expect, vi, afterEach } from 'vitest'
import { getWindowType, isMainAppWindow } from './window-type'

function stubSearch(search: string): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { search } }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('window-type', () => {
  it('reads the window type from the query string', () => {
    stubSearch('?window=chat')
    expect(getWindowType()).toBe('chat')
    expect(isMainAppWindow()).toBe(false)
  })

  it('identifies the main window', () => {
    stubSearch('?window=main')
    expect(getWindowType()).toBe('main')
    expect(isMainAppWindow()).toBe(true)
  })

  it('defaults to overlay when the parameter is absent', () => {
    stubSearch('')
    expect(getWindowType()).toBe('overlay')
    expect(isMainAppWindow()).toBe(false)
  })
})
