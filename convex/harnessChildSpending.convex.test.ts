import { expect, test } from 'vitest'
import { childAdmission } from './harness/runs'

const parent = (spendingMode: 'workspace' | 'external' | 'none') => ({
  runId: 'workspace:parent', rootRunId: 'workspace:parent', depth: 0, constraints: [],
  policy: { actorUserId: 'alice', workspaceId: 'workspace', allowedToolIds: [], requiresPlan: false,
    deadlineAt: 10, executionPolicyVersion: 2, spendingMode, maxCostMicros: 0 },
}) as never
const child = { id: 'workspace:child', stepId: 'ask:call:target', allowedToolIds: [], maxCostMicros: 0, costMicros: 0,
  status: 'running' as const, evidenceRefs: [] }
const named = { type: 'admit_named_child' as const, child, step: { title: 'Ask', acceptanceCriteria: ['Answers.'] },
  goal: 'Ask', constraints: [], target: { deliveryAgentRunId: 'child', conversationId: 'room' } }

test('an asked agent pays for its own model: a subscription agent can ask a gateway agent and the reverse', () => {
  expect(childAdmission(parent('external'), { ...named, spendingMode: 'workspace' }).policy.spendingMode).toBe('workspace')
  expect(childAdmission(parent('workspace'), { ...named, spendingMode: 'external' }).policy.spendingMode).toBe('external')
})

test('a caller that states no mode, and a same-model sub-agent, inherit the parent run', () => {
  expect(childAdmission(parent('external'), named).policy.spendingMode).toBe('external')
  expect(childAdmission(parent('workspace'), { type: 'admit_child', child, goal: 'Sub', constraints: [] }).policy.spendingMode).toBe('workspace')
})
