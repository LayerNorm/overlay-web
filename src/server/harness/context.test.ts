import { expect, test } from 'vitest'
import { createHarnessSnapshot, recordHarnessEvidence, recordHarnessReceipt } from '@overlay/agent-runtime/harness-state'
import { buildHarnessInstructions, buildHarnessWorkingContext, harnessProgressFingerprint } from './context'

const make = () => createHarnessSnapshot({
  runId: 'fixture-run', goal: 'Check the requested document', constraints: ['Do not publish it'],
  policy: {
    actorUserId: 'fixture-user', allowedToolIds: ['read'], requiresPlan: true,
    deadlineAt: 10_000, maxCostMicros: 100, maxParallelChildren: 2, maxDepth: 2,
  },
}, 1_000)

test('keeps the cacheable instruction prefix separate from changing working state', () => {
  const state = make()
  const prefix = buildHarnessInstructions('Surface persona')
  const context = JSON.parse(buildHarnessWorkingContext(state))
  expect(prefix.startsWith('Surface persona\n\n')).toBe(true)
  expect(prefix).not.toContain(state.goal)
  expect(context.goal).toBe(state.goal)
  expect(context.constraints).toEqual(state.constraints)
  expect(context.budget.remainingCostMicros).toBe(100)
  expect(context).not.toHaveProperty('policy')
  expect(context).not.toHaveProperty('usage')
})

test('accounting and repeated identical observations do not masquerade as progress', () => {
  const state = recordHarnessEvidence(make(), {
    id: 'first', kind: 'tool_result', source: 'document:revision-1',
    summary: 'Read the document', verdict: 'observed', createdAt: 1_000,
  }, 1_000)
  const fingerprint = harnessProgressFingerprint(state)
  const accounted = recordHarnessReceipt(state, {
    id: 'call', modelId: 'fixture/model', provider: 'fixture', inputTokens: 100, outputTokens: 10,
    reasoningTokens: 2, cacheReadTokens: 80, cacheWriteTokens: 0, contextWindow: 1_000, costMicros: 5,
  }, 2_000)
  expect(harnessProgressFingerprint(accounted)).toBe(fingerprint)
  const repeated = recordHarnessEvidence(accounted, { ...state.evidence[0]!, id: 'second', createdAt: 2_000 }, 2_000)
  expect(harnessProgressFingerprint(repeated)).toBe(fingerprint)
  const changed = recordHarnessEvidence(repeated, {
    ...state.evidence[0]!, id: 'third', source: 'document:revision-2', summary: 'Corrected the figures',
  }, 3_000)
  expect(harnessProgressFingerprint(changed)).not.toBe(fingerprint)
})
