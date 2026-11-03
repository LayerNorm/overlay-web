import { expect, test } from 'vitest'
import { createHarnessSnapshot, recordHarnessEvidence, recordHarnessReceipt, replaceHarnessPlan, transitionHarnessStep } from '@overlay/agent-runtime/harness-state'
import { buildHarnessInstructions, buildHarnessStepInstructions, buildHarnessWorkingContext, harnessProgressFingerprint } from './context'
import { buildHarnessCheckpoint, parseHarnessVerificationResponse } from './continuity'
import { HARNESS_ANSWER_CORRECTION_INSTRUCTIONS, HARNESS_EVIDENCE_POLICY } from './continuity-policy'

const make = (requiresPlan = true) => createHarnessSnapshot({
  runId: 'fixture-run', goal: 'Check the requested document', constraints: ['Do not publish it'],
  policy: {
    actorUserId: 'fixture-user', allowedToolIds: ['read'], requiresPlan,
    deadlineAt: 10_000, maxCostMicros: 100, maxParallelChildren: 2, maxDepth: 2,
  },
}, 1_000)

test('completed plans request the final deliverable instead of more bookkeeping', () => {
  let state = replaceHarnessPlan(make(), [{ id: 'work', title: 'Read document', dependsOn: [],
    acceptanceCriteria: ['Document read'], requiresVerification: false, evidenceTools: ['read'] }], 1_000)
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
  expect(instructions).toContain('Give each action milestone evidenceTools listing the tools whose results prove it; cite only results from those tools.')
  expect(instructions).toContain('one answerOnly milestone')
  expect(instructions).toContain('Mark a final milestone that only reports results as answerOnly.')
  expect(instructions).toContain(
    'Before marking an action milestone done, compare the saved fields in its cited tool results with its acceptance criteria; if any differ, correct them with another tool call first.',
  )
  expect(instructions).toContain(
    'Before acting on a pending milestone, check observations; if a successful result already satisfies it, cite that evidence instead of repeating the action.',
  )
  expect(instructions).toContain(
    'The goal in the working state is the current request and the only task for this run. Use earlier conversation only to interpret it; never resume, repeat or plan an earlier request unless the goal asks for it.',
  )
  expect(buildHarnessInstructions('Surface instructions')).toContain(
    'Before acting on a pending milestone, check observations; if a successful result already satisfies it, cite that evidence instead of repeating the action.',
  )
  expect(instructions).toContain('Never describe actions that were not executed')
  expect(instructions).not.toContain('\u2013')
  expect(instructions).not.toContain('\u2014')
})

test('goal anchoring is present for plan-optional runs', () => {
  const instructions = buildHarnessStepInstructions(make(false), {
    instructions: 'Surface instructions', continuation: false, truncatedResponse: false,
  })
  expect(instructions).toContain(
    'The goal in the working state is the current request and the only task for this run. Use earlier conversation only to interpret it; never resume, repeat or plan an earlier request unless the goal asks for it.',
  )
})

test('planning gate allows only plan creation and explains blocker timing', () => {
  const context = {
    instructions: 'Surface instructions',
    continuation: false,
    truncatedResponse: false,
  }
  const gateInstructions = buildHarnessStepInstructions(make(), context)
  expect(gateInstructions).toContain(
    'Before a plan exists, only harness_set_plan is callable. If the request needs no action, use one answerOnly milestone. If you need user input, create the plan first, then report the blocker.',
  )

  const planned = replaceHarnessPlan(make(), [{
    id: 'work', title: 'Create a note', dependsOn: [], acceptanceCriteria: ['Note created'], requiresVerification: false,
    evidenceTools: ['read'],
  }], 1_000)
  expect(buildHarnessStepInstructions(planned, context)).not.toContain('Before a plan exists')
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
  const planned = replaceHarnessPlan(state, [{
    id: 'work', title: 'Read document', dependsOn: [], acceptanceCriteria: ['Document read'],
    requiresVerification: false, evidenceTools: ['read'],
  }], 1_000)
  expect(JSON.parse(buildHarnessWorkingContext(planned)).plan[0].evidenceTools).toEqual(['read'])
})

test('includes durable model recovery metadata in trusted working state', () => {
  const state = {
    ...make(false),
    modelRecovery: {
      receiptId: 'model:2',
      modelId: 'fixture/model',
      code: 'empty_response' as const,
      attempt: 2,
      firstFailureAt: 2_000,
      nextRetryAt: 8_000,
    },
  }
  expect(JSON.parse(buildHarnessWorkingContext(state)).modelRecovery).toEqual(state.modelRecovery)
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

test('checkpoints separate stale narrative from chronological exact-resource observations', () => {
  let state = {
    ...make(),
    workingSummary: '0 pages processed.',
  }
  state = recordHarnessEvidence(state, {
    id: 'tool:failed-render', kind: 'tool_result', source: 'render_document',
    summary: 'The first render failed.', verdict: 'failed', createdAt: 1_100,
    resource: { id: 'file-1', revision: 'rev-7', operation: 'render', page: 1 },
  }, 1_100)
  state = recordHarnessEvidence(state, {
    id: 'tool:successful-render', kind: 'tool_result', source: 'render_document',
    summary: 'Rendered page 1.', verdict: 'observed', createdAt: 1_200,
    resource: { id: 'file-1', revision: 'rev-7', operation: 'render', page: 1 },
  }, 1_200)

  const working = JSON.parse(buildHarnessWorkingContext(state)) as {
    unverifiedNarrative: string
    authoritativeCheckpoint: ReturnType<typeof buildHarnessCheckpoint>
  }
  expect(working.unverifiedNarrative).toBe('0 pages processed.')
  expect(working.authoritativeCheckpoint.evidence.map(item => item.id)).toEqual([
    'tool:failed-render', 'tool:successful-render',
  ])
  expect(working.authoritativeCheckpoint.evidence[1]).toMatchObject({
    verdict: 'observed', resource: { id: 'file-1', revision: 'rev-7', page: 1 },
  })
  expect(buildHarnessInstructions('Surface instructions')).toContain(HARNESS_EVIDENCE_POLICY)
})

test('bounded checkpoints remain valid JSON and report omitted evidence for lookup', () => {
  let state = make(false)
  for (let index = 0; index < 30; index++) {
    state = recordHarnessEvidence(state, {
      id: `tool:${index}`, kind: 'tool_result', source: 'read',
      summary: `Observation ${index} ${'x'.repeat(1_000)}`, verdict: index === 0 ? 'failed' : 'observed',
      createdAt: 1_000 + index,
    }, 1_000 + index)
  }
  const serialized = JSON.stringify(buildHarnessCheckpoint(state))
  expect(serialized.length).toBeLessThanOrEqual(7_500)
  expect(JSON.parse(serialized).omittedEvidenceCount).toBeGreaterThan(0)
  expect(JSON.parse(serialized).evidenceLookup).toBe('harness_read_evidence')
  const working = JSON.parse(buildHarnessWorkingContext(state))
  expect(working.observations).toHaveLength(working.authoritativeCheckpoint.evidence.length)

  const longText = recordHarnessEvidence(make(false), {
    id: 'tool:long-text', kind: 'tool_result', source: 'read',
    summary: 'A'.repeat(600), verdict: 'observed', createdAt: 1_001,
  }, 1_001)
  expect(buildHarnessCheckpoint(longText).evidence[0]?.summary).toBe('A'.repeat(320))
})

test('final verifier JSON rejects malformed responses and evidence from outside the run', () => {
  const evidenceIds = new Set(['tool:current-run'])
  expect(parseHarnessVerificationResponse(
    '{"supported":false,"reason":"Unsupported","evidenceIds":[]}', evidenceIds,
  )).toEqual({ supported: false, reason: 'Unsupported', evidenceIds: [] })
  expect(() => parseHarnessVerificationResponse('not-json', evidenceIds)).toThrow()
  expect(() => parseHarnessVerificationResponse(
    '{"supported":true,"reason":"ok","evidenceIds":["tool:other-run"]}', evidenceIds,
  )).toThrow(/invalid evidence reference/)
})

test('unsupported final answers receive structured correction feedback', () => {
  const state = {
    ...make(false),
    finalVerification: {
      attemptId: 'segment:1',
      candidateDigest: 'a'.repeat(64),
      planRevision: 0,
      evidenceRevision: 0,
      supported: false,
      reason: 'The render shows page 1.',
      evidenceIds: ['tool:render'],
      attempts: 1,
      createdAt: 1_000,
    },
  }
  const instructions = buildHarnessStepInstructions(state, {
    instructions: 'Surface instructions', continuation: true, truncatedResponse: false,
  })
  expect(instructions).toContain(HARNESS_ANSWER_CORRECTION_INSTRUCTIONS)
  expect(instructions).toContain(
    'Verification feedback: {"supported":false,"reason":"The render shows page 1.","evidenceIds":["tool:render"]}',
  )
})
