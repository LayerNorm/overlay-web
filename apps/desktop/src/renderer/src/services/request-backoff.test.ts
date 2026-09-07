import { describe, it, expect } from 'vitest'
import {
  friendlyErrorMessage,
  isRetryableError,
  retryAfterMsFromError,
  retryAfterSecondsFromError
} from './request-backoff'
import { DesktopApiError } from './app-api-client'
describe('request-backoff', () => {
  it('reads the server hint from DesktopApiError', () => {
    const error = new DesktopApiError('Too many requests', 'server', 429, 113)
    expect(retryAfterSecondsFromError(error)).toBe(113)
    expect(retryAfterMsFromError(error, 1_500)).toBe(113_000)
  })

  it('parses raw JSON 429 bodies', () => {
    const error = new Error('{"error":"Too many requests","retryAfterSeconds":113}')
    expect(retryAfterSecondsFromError(error)).toBe(113)
    expect(retryAfterMsFromError(error, 1_500)).toBe(113_000)
    expect(friendlyErrorMessage(error)).toBe('Too many requests. Try again in 1 minute 53 seconds.')
  })

  it('parses the vendored friendly retry text', () => {
    expect(
      retryAfterSecondsFromError(
        new Error('Too many requests. This account has reached its temporary request limit. Try again in 2 minutes.')
      )
    ).toBe(120)
    expect(
      retryAfterSecondsFromError(new Error('Too many requests. Try again in 45 seconds.'))
    ).toBe(45)
  })

  it('falls back for ordinary errors and caps the delay', () => {
    expect(retryAfterSecondsFromError(new Error('boom'))).toBeNull()
    expect(retryAfterMsFromError(new Error('boom'), 1_500)).toBe(1_500)
    expect(retryAfterMsFromError(new DesktopApiError('x', 'server', 429, 9999), 1_500)).toBe(
      120_000
    )
    expect(friendlyErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('retries transient failures but parks persistent ones', () => {
    expect(isRetryableError(new DesktopApiError('Too many requests', 'server', 429, 60))).toBe(true)
    expect(isRetryableError(new DesktopApiError('Server error', 'server', 500))).toBe(true)
    expect(isRetryableError(new DesktopApiError('Network request failed', 'network'))).toBe(true)
    expect(
      isRetryableError(new Error('Request failed (503)'))
    ).toBe(true)
    expect(
      isRetryableError(
        new Error('Too many requests. This account has reached its temporary request limit. Try again in 2 minutes.')
      )
    ).toBe(true)
    expect(
      isRetryableError(new DesktopApiError('Connected agent control plane is disabled', 'server', 404))
    ).toBe(false)
    expect(isRetryableError(new DesktopApiError('Not found', 'not_found', 404))).toBe(false)
    expect(isRetryableError(new DesktopApiError('Not authenticated', 'unauthenticated', 401))).toBe(false)
    expect(isRetryableError(new Error('ipc_concurrency_limit'))).toBe(true)
  })
})
