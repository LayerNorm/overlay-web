import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { isUnifiedStreamingEnabled, personalHarnessPolicy } from './personal-admission-policy'

beforeEach(() => vi.stubEnv('OVERLAY_UNIFIED_STREAMING', ''))
afterEach(() => vi.unstubAllEnvs())

const input = { actorUserId: 'user', workspaceId: 'workspace', allowedToolIds: ['write', 'read', 'read'],
  modelId: 'fixture/model', paid: true, createdAt: 1_000 }

test('every admission uses v2 with no per-task spending limit; only Overlay-funded paid runs use the workspace budget', () => {
  expect(personalHarnessPolicy(input)).toEqual({ actorUserId: 'user', workspaceId: 'workspace',
    publicProgressVersion: 1, publicStreamVersion: 1, executionPolicyVersion: 2, spendingMode: 'workspace', allowedToolIds: ['read', 'write'], requiresPlan: false,
    deadlineAt: 86_401_000, maxCostMicros: 0 })
  expect(personalHarnessPolicy({ ...input, paid: false }))
    .toMatchObject({ publicProgressVersion: 1, executionPolicyVersion: 2, spendingMode: 'none', maxCostMicros: 0 })
  expect(personalHarnessPolicy({ ...input, modelId: 'byok/key/model' }))
    .toMatchObject({ publicProgressVersion: 1, executionPolicyVersion: 2, spendingMode: 'external', maxCostMicros: 0 })
  expect(personalHarnessPolicy({ ...input, budget: { durationMs: 60_000 } }))
    .toMatchObject({ executionPolicyVersion: 2, deadlineAt: 86_401_000, taskDeadlineAt: 61_000 })
})

test('free accounts and BYOK cannot authorize Overlay-funded model spend', () => {
  expect(personalHarnessPolicy({ ...input, paid: false }).spendingMode).toBe('none')
  expect(personalHarnessPolicy({ ...input, modelId: 'byok/key/model' }).spendingMode).toBe('external')
})

test('unified streaming is on by default and only an explicit setting turns it off', () => {
  for (const setting of [undefined, '', '  ', 'on', ' ON ']) expect(isUnifiedStreamingEnabled(setting)).toBe(true)
  for (const setting of ['off', ' OFF ', 'false', '0', 'of']) expect(isUnifiedStreamingEnabled(setting)).toBe(false)
})

test('every new root is enrolled, including workspaces the retired allowlist never named', () => {
  vi.stubEnv('OVERLAY_UNIFIED_STREAMING_WORKSPACE_IDS', 'another-workspace')
  expect(personalHarnessPolicy(input).publicStreamVersion).toBe(1)
  expect(personalHarnessPolicy({ ...input, workspaceId: 'created-later' }).publicStreamVersion).toBe(1)
})

test('the kill switch stops new enrollment without switching an admitted root', () => {
  const enrolled = personalHarnessPolicy(input)
  vi.stubEnv('OVERLAY_UNIFIED_STREAMING', 'off')
  const legacy = personalHarnessPolicy(input)
  expect(legacy.publicStreamVersion).toBeUndefined()
  expect(personalHarnessPolicy({ ...input, existingPolicy: enrolled }).publicStreamVersion).toBe(1)

  vi.stubEnv('OVERLAY_UNIFIED_STREAMING', '')
  expect(personalHarnessPolicy({ ...input, existingPolicy: legacy }).publicStreamVersion).toBeUndefined()
})

test('invalid budgets fail closed', () => {
  for (const durationMs of [0, 29_999, 30_000.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => personalHarnessPolicy({ ...input, budget: { durationMs } })).toThrow('budget')
  }
})

test('a deadline the person sets has no upper bound', () => {
  const tenDays = 10 * 86_400_000
  expect(personalHarnessPolicy({ ...input, budget: { durationMs: tenDays } }))
    .toMatchObject({ taskDeadlineAt: 1_000 + tenDays })
})
