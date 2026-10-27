import { expect, test } from 'vitest'
import { personalHarnessPolicy } from './personal-admission-policy'

const input = { actorUserId: 'user', workspaceId: 'workspace', allowedToolIds: ['write', 'read', 'read'],
  modelId: 'fixture/model', paid: true, createdAt: 1_000 }

test('the default budget is shared by the root and children, not a tool-call allowance', () => {
  expect(personalHarnessPolicy(input)).toEqual({ actorUserId: 'user', workspaceId: 'workspace',
    allowedToolIds: ['read', 'write'], requiresPlan: false, deadlineAt: 86_401_000,
    maxCostMicros: 1_000_000, maxParallelChildren: 3, maxDepth: 2 })
  expect(personalHarnessPolicy({ ...input, budget: { maxProviderCostUsd: 0.125, durationMs: 60_000 } }))
    .toMatchObject({ maxCostMicros: 125_000, deadlineAt: 61_000 })
})

test('free accounts and BYOK cannot authorize Overlay-funded model spend', () => {
  expect(personalHarnessPolicy({ ...input, paid: false }).maxCostMicros).toBe(0)
  expect(personalHarnessPolicy({ ...input, modelId: 'byok/key/model' }).maxCostMicros).toBe(0)
})

test('invalid budgets fail closed', () => {
  for (const maxProviderCostUsd of [-1, NaN, Infinity, 101]) {
    expect(() => personalHarnessPolicy({ ...input, budget: { maxProviderCostUsd } })).toThrow('budget')
  }
  for (const durationMs of [0, 30_000.5, Infinity, 8 * 86_400_000]) {
    expect(() => personalHarnessPolicy({ ...input, budget: { durationMs } })).toThrow('budget')
  }
})
