import { expect, test, vi } from 'vitest'
import { surfaceStartFailure } from './surface-start-failure'

vi.mock('server-only', () => ({}))
const log = vi.hoisted(() => vi.fn())
vi.mock('@/server/observability/logger', () => ({ logger: { error: log } }))

test('known failures retain their exact safe cause', () => {
  expect(surfaceStartFailure(new Error('Surface workspace authority changed.'), 'run')).toEqual({
    code: 'SURFACE_AUTHORIZATION_CHANGED', message: 'Surface workspace authority changed.', retryable: false,
  })
})

test('unknown provider text is not exposed and a diagnostic reference connects the failure to safe logs', () => {
  const failure = surfaceStartFailure(new Error('private credential and user data'), 'run')
  expect(failure.message).toContain('Reference: surface-start:run.')
  expect(failure.message).not.toContain('private credential')
  expect(log).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
    diagnosticId: 'surface-start:run', failureClass: 'unknown',
  }))
  expect(JSON.stringify(log.mock.calls.at(-1))).not.toContain('private credential')
})
