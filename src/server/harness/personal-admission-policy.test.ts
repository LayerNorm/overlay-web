import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { isUnifiedStreamingWorkspaceEnabled, personalHarnessPolicy } from './personal-admission-policy'

const input = { actorUserId: 'user', workspaceId: 'workspace', allowedToolIds: ['write', 'read', 'read'],
  modelId: 'fixture/model', paid: true, createdAt: 1_000 }

beforeEach(() => vi.stubEnv('OVERLAY_UNIFIED_STREAMING_WORKSPACE_IDS', ''))
afterEach(() => vi.unstubAllEnvs())

test('every admission uses v2 with no per-task spending limit; only Overlay-funded paid runs use the workspace budget', () => {
  expect(personalHarnessPolicy(input)).toEqual({ actorUserId: 'user', workspaceId: 'workspace',
    publicProgressVersion: 1, executionPolicyVersion: 2, spendingMode: 'workspace', allowedToolIds: ['read', 'write'], requiresPlan: false,
    deadlineAt: 86_401_000, maxCostMicros: 0, maxParallelChildren: 16, maxDepth: 5 })
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

test('render_ui roots enroll without the workspace allowlist; other roots require it', () => {
  expect(personalHarnessPolicy({ ...input, allowedToolIds: ['render_ui'] }).publicStreamVersion).toBe(1)
  expect(personalHarnessPolicy({ ...input, allowedToolIds: ['read'] }).publicStreamVersion).toBeUndefined()

  vi.stubEnv('OVERLAY_UNIFIED_STREAMING_WORKSPACE_IDS', 'workspace-2, workspace')
  expect(personalHarnessPolicy({ ...input, allowedToolIds: ['read'] }).publicStreamVersion).toBe(1)
  expect(isUnifiedStreamingWorkspaceEnabled('work', 'workspace')).toBe(false)
  expect(isUnifiedStreamingWorkspaceEnabled('workspace', '*')).toBe(false)
})

test('existing root policy is immutable across tool and allowlist changes', () => {
  const enrolled = personalHarnessPolicy({ ...input, allowedToolIds: ['render_ui'] })
  expect(personalHarnessPolicy({ ...input, allowedToolIds: ['read'], existingPolicy: enrolled }).publicStreamVersion).toBe(1)

  const unversioned = { ...personalHarnessPolicy({ ...input, allowedToolIds: ['read'] }), publicStreamVersion: undefined }
  expect(personalHarnessPolicy({ ...input, allowedToolIds: ['render_ui'], existingPolicy: unversioned }).publicStreamVersion).toBeUndefined()
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
