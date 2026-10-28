import { expect, test } from 'vitest'
import { createHarnessSnapshot, recordHarnessEvidence, recordHarnessReceipt, replaceHarnessPlan, transitionHarnessStep } from '@overlay/agent-runtime/harness-state'
import { buildHarnessInstructions, buildHarnessStepInstructions, buildHarnessWorkingContext, harnessProgressFingerprint } from './context'

const make = () => createHarnessSnapshot({
  runId: 'fixture-run', goal: 'Check the requested document', constraints: ['Do not publish it'],
  policy: {
    actorUserId: 'fixture-user', allowedToolIds: ['read'], requiresPlan: true,
    deadlineAt: 10_000, maxCostMicros: 100, maxParallelChildren: 2, maxDepth: 2,
  },
}, 1_000)

test('completed plans request the final deliverable instead of more bookkeeping', () => {
  let state = replaceHarnessPlan(make(), [{ id: 'work', title: 'Read document', dependsOn: [],
    acceptanceCriteria: ['Document read'], requiresVerification: false }], 1_000)
  const context = { instructions: 'Surface instructions', continuation: true, truncatedResponse: false }
  expect(buildHarnessStepInstructions(state, context)).toContain('complete the remaining milestones')
  state = recordHarnessEvidence(state, { id: 'read', kind: 'tool_result', source: 'read',
    summary: 'Document read', verdict: 'observed', createdAt: 1_000 }, 1_000)
  state = transitionHarnessStep(state, { id: 'work', status: 'done', evidenceRefs: ['read'] }, 1_000)
  const instructions = buildHarnessStepInstructions(state, context)
  expect(instructions).toContain('All plan milestones and required evidence are complete')
  expect(instructions).toContain('respecting its requested output format')
  expect(instructions).not.toContain('complete the remaining milestones')
})

test('write-capable runs receive evidence-backed planning instructions', () => {
  const instructions = buildHarnessStepInstructions(make(), {
    instructions: 'Surface instructions', continuation: false, truncatedResponse: false,
  })
  expect(instructions).toContain('call harness_set_plan before anything else')
  expect(instructions).toContain('tool:<id> evidence IDs from observations')
  expect(instructions).toContain('one answerOnly milestone')
  expect(instructions).toContain('Mark a final milestone that only reports results as answerOnly.')
  expect(instructions).toContain(
    'Before marking an action milestone done, compare the saved fields in its cited tool results with its acceptance criteria; if any differ, correct them with another tool call first.',
  )
  expect(instructions).toContain('Never describe actions that were not executed')
  expect(instructions).not.toContain('\u2013')
  expect(instructions).not.toContain('\u2014')
})

test('planning gate lists deferred tools and removes the gate after plan creation', () => {
  const context = {
    instructions: 'Surface instructions',
    continuation: false,
    truncatedResponse: false,
    deferredToolNames: ['create_note', 'harness_set_plan', 'ask_agent', 'create_note', 'harness_report_blocker'],
  }
  const gateInstructions = buildHarnessStepInstructions(make(), context)
  expect(gateInstructions).toContain(
    'Until a plan exists, only harness_set_plan and harness_report_blocker are callable. These tools become available immediately after the plan is saved: ask_agent, create_note. Never report a blocker because one of them is not yet callable.',
  )

  const planned = replaceHarnessPlan(make(), [{
    id: 'work', title: 'Create a note', dependsOn: [], acceptanceCriteria: ['Note created'], requiresVerification: false,
  }], 1_000)
  expect(buildHarnessStepInstructions(planned, context)).not.toContain('Until a plan exists')
})

test('requests a plain-text final answer after a protocol-only response', () => {
  const state = make()
  const context = { instructions: 'Surface instructions', continuation: true, truncatedResponse: false }
  const required = buildHarnessStepInstructions(state, { ...context, finalAnswerRequired: true })
  expect(required).toContain('All milestones are complete. Reply to the user now in plain text with the results; do not write tool calls as text.')
  expect(buildHarnessStepInstructions(state, context)).not.toContain('Reply to the user now in plain text')
})

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
