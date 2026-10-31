import { expect, test, vi } from 'vitest'
import { isHarnessBackendReady } from './backend-readiness'
import { DEFAULT_APP_SETTINGS } from '@overlay/app-core'

vi.mock('server-only', () => ({}))

test('a successful old backend response retains legacy admission', () => {
  expect(isHarnessBackendReady(DEFAULT_APP_SETTINGS)).toBe(false)
})

test('a backend with only the original Harness marker remains unavailable to new web admission', () => {
  const settings = { ...DEFAULT_APP_SETTINGS, harnessRevision: 'overlay-harness-v1' }
  expect(isHarnessBackendReady(settings)).toBe(false)
})

test('both server-owned markers admit Harness', () => {
  const settings = { ...DEFAULT_APP_SETTINGS, harnessRevision: 'overlay-harness-v1',
    harnessModelRecoveryRevision: 'settled-retry-v1' }
  expect(isHarnessBackendReady(settings)).toBe(true)
})

test('an unreadable settings response cannot select another engine', () => {
  expect(isHarnessBackendReady(null)).toBe(false)
})

test.each([undefined, null, false, 'future-revision'])('rejects unsupported readiness %s', harnessRevision => {
  const settings = { ...DEFAULT_APP_SETTINGS, harnessRevision }
  expect(isHarnessBackendReady(settings)).toBe(false)
})

test.each([undefined, null, false, 'future-revision'])('rejects missing or unsupported recovery readiness %s', harnessModelRecoveryRevision => {
  const settings = { ...DEFAULT_APP_SETTINGS, harnessRevision: 'overlay-harness-v1', harnessModelRecoveryRevision }
  expect(isHarnessBackendReady(settings)).toBe(false)
})
