import { expect, test } from 'vitest'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { advancePlanRepair, planRepairEvidence } from './plan-repair'

const empty = { plan: [], evidence: [] } as unknown as HarnessSnapshot

test('successful initial planning and ordinary updates do not consume repair attempts', () => {
  const initial = { attempts: 0, evidence: planRepairEvidence(empty) }
  expect(advancePlanRepair(initial, { ...empty, plan: [{}] } as HarnessSnapshot, ['harness_set_plan'], false).attempts).toBe(0)
  const retry = { attempts: 3, evidence: planRepairEvidence(empty) }
  expect(advancePlanRepair(retry, empty, ['harness_update_step'], true).attempts).toBe(3)
  expect(advancePlanRepair(retry, empty, ['harness_update_step'], true, true).attempts).toBe(4)
  expect(advancePlanRepair(retry, empty, ['harness_revise_step'], true).attempts).toBe(4)
})

test('new successful tool or child evidence resets repair attempts, but a plan revision does not', () => {
  const base = { attempts: 3, evidence: planRepairEvidence(empty) }
  const changedPlan = { ...empty, plan: [{}] } as HarnessSnapshot
  expect(advancePlanRepair(base, changedPlan, ['harness_revise_step'], true).attempts).toBe(4)
  const childEvidence = { ...empty, evidence: [{
    id: 'child-result:completed', kind: 'tool_result', source: 'harness_read_child:child',
    summary: 'Completed child evidence', verdict: 'observed', createdAt: 1,
  }] } as HarnessSnapshot
  expect(advancePlanRepair(base, childEvidence, ['harness_set_plan'], true).attempts).toBe(0)
})
