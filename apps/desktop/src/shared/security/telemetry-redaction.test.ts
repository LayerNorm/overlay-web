import { describe, expect, it } from 'vitest'
import { redactSentryEvent, redactTelemetryValue } from './telemetry-redaction'

describe('telemetry redaction', () => {
  it('removes secrets, identity, paths, and URL queries recursively', () => {
    const redacted = redactTelemetryValue({
      authorization: 'Bearer raw-token',
      nested: {
        email: 'person@example.com',
        userId: 'user-123',
        message:
          'failed at /Users/alice/private/file.txt for person@example.com https://example.com/a?q=secret'
      }
    })

    expect(redacted).toEqual({
      authorization: '[Redacted]',
      nested: {
        email: '[Redacted]',
        userId: '[Redacted]',
        message: 'failed at /Users/[Redacted] for [Redacted] https://example.com/a?[Redacted]'
      }
    })
  })

  it('drops Sentry user and request payload fields', () => {
    const redacted = redactSentryEvent({
      user: { id: 'user-1' },
      request: {
        url: 'https://overlay.ai/api?token=secret',
        headers: { authorization: 'Bearer secret' },
        data: 'private prompt'
      },
      extra: { safe: true }
    })

    expect(redacted.user).toBeUndefined()
    expect(redacted.request).toEqual({ url: 'https://overlay.ai/api?[Redacted]' })
    expect(redacted.extra).toEqual({ safe: true })
  })
})
