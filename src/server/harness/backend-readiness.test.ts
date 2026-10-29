import { expect, test, vi } from 'vitest'
import { isHarnessBackendReady } from './backend-readiness'
import { DEFAULT_APP_SETTINGS } from '@overlay/app-core'

vi.mock('server-only', () => ({}))

test('a successful old backend response retains legacy admission', () => {
  expect(isHarnessBackendReady(DEFAULT_APP_SETTINGS)).toBe(false)
})

test('the additive server-owned marker admits Harness', () => {
  const settings = { ...DEFAULT_APP_SETTINGS, harnessRevision: 'overlay-harness-v1' }
  expect(isHarnessBackendReady(settings)).toBe(true)
})

test('an unreadable settings response cannot select another engine', () => {
  expect(() => isHarnessBackendReady(null)).toThrow('readiness could not be determined')
})

test.each([undefined, null, false, 'future-revision'])('rejects unsupported readiness %s', harnessRevision => {
  const settings = { ...DEFAULT_APP_SETTINGS, harnessRevision }
  expect(() => isHarnessBackendReady(settings)).toThrow('Unsupported Harness backend revision')
})
