import { describe, expect, it } from 'vitest'
import {
  appendUserIdParam,
  assertTrustedOverlayBaseUrl,
  normalizeTrustedOverlayBaseUrl,
} from '../src/background/trusted-origins'

describe('trusted Overlay origins', () => {
  it('allows production and local development origins only', () => {
    expect(assertTrustedOverlayBaseUrl('https://getoverlay.io')).toBe('https://getoverlay.io')
    expect(assertTrustedOverlayBaseUrl('https://www.getoverlay.io/account')).toBe('https://www.getoverlay.io')
    expect(assertTrustedOverlayBaseUrl('http://localhost:3000')).toBe('http://localhost:3000')
    expect(assertTrustedOverlayBaseUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
  })

  it('rejects lookalike, downgraded, and arbitrary origins before credentials are sent', () => {
    expect(() => assertTrustedOverlayBaseUrl('https://getoverlay.io.evil.test')).toThrow(/untrusted host/)
    expect(() => assertTrustedOverlayBaseUrl('http://getoverlay.io')).toThrow(/untrusted host/)
    expect(() => assertTrustedOverlayBaseUrl('https://localhost:3000')).toThrow(/untrusted host/)
    expect(() => assertTrustedOverlayBaseUrl('not a url')).toThrow(/untrusted host/)
  })

  it('normalizes untrusted stored preferences to production fallback', () => {
    expect(normalizeTrustedOverlayBaseUrl('https://attacker.example')).toBe('https://getoverlay.io')
    expect(normalizeTrustedOverlayBaseUrl('')).toBe('https://getoverlay.io')
  })
})

describe('authenticated GET query shaping', () => {
  it('adds userId without replacing existing query parameters', () => {
    expect(appendUserIdParam('/api/v1/conversations?messages=true', 'user_123')).toBe(
      '/api/v1/conversations?messages=true&userId=user_123',
    )
  })

  it('does not overwrite an existing userId parameter', () => {
    expect(appendUserIdParam('/api/v1/conversations?userId=user_existing', 'user_123')).toBe(
      '/api/v1/conversations?userId=user_existing',
    )
  })
})
