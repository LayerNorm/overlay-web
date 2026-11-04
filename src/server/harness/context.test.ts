import { expect, test } from 'vitest'
import { createHarnessSnapshot, recordHarnessEvidence, recordHarnessReceipt, replaceHarnessPlan, transitionHarnessStep } from '@overlay/agent-runtime/harness-state'
import { buildHarnessInstructions, buildHarnessStepInstructions, buildHarnessWorkingContext, harnessProgressFingerprint, HARNESS_CONTROL_TOOLS } from './context'
import { buildHarnessCheckpoint, parseHarnessVerificationResponse } from './continuity'
import { HARNESS_ANSWER_CORRECTION_INSTRUCTIONS, HARNESS_EVIDENCE_POLICY } from './continuity-policy'
import { harnessToolOutputEvidence } from './tool-evidence'

test('shared Harness controls retain file analysis after transcript integration', () => {
  expect(HARNESS_CONTROL_TOOLS).toContain('harness_analyze_files')
})

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

test('pending answer-only milestones can still ask for essential input', () => {
  const state = replaceHarnessPlan(make(), [{ id: 'answer', title: 'Confirm the word', dependsOn: [],
    acceptanceCriteria: ['Repeat the user confirmation word'], requiresVerification: false, answerOnly: true }], 1_000)
  const instructions = buildHarnessStepInstructions(state, {
    instructions: 'Surface instructions', continuation: true, truncatedResponse: false, finalAnswerRequired: true,
  })
  expect(instructions).toContain('call harness_report_blocker rather than guessing')
  expect(instructions).toContain('external action tools are unavailable')
  expect(instructions).not.toContain('All plan milestones and required evidence are complete')
  expect(instructions).not.toContain('Do not call tools')
})

test('write-capable runs receive evidence-backed planning instructions', () => {
  const instructions = buildHarnessStepInstructions(make(), {
    instructions: 'Surface instructions', continuation: false, truncatedResponse: false,
  })
  expect(instructions).toContain('make harness_set_plan your first tool call, after a brief user-facing acknowledgment')
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

test('progress is public text rather than private reasoning or tool labels', () => {
  const instructions = buildHarnessInstructions('Surface instructions')
  expect(instructions).toContain('Before the first tool call, briefly acknowledge the request')
  expect(instructions).toContain('Between meaningful batches of tools, explain what you found')
  expect(instructions).toContain('When a tool fails or you change approach, explain the practical impact')
  expect(instructions).toContain('not private reasoning or tool arguments')
})

test('goal anchoring is present for plan-optional runs', () => {
  const instructions = buildHarnessStepInstructions(make(false), {
    instructions: 'Surface instructions', continuation: false, truncatedResponse: false,
  })
  expect(instructions).toContain(
    'The goal in the working state is the current request and the only task for this run. Use earlier conversation only to interpret it; never resume, repeat or plan an earlier request unless the goal asks for it.',
  )
})

test('public progress does not receive execution, recovery, or final-answer directives', () => {
  const instructions = buildHarnessStepInstructions(make(), {
    instructions: 'Keep workspace information private.', continuation: true,
    truncatedResponse: true, finalAnswerRequired: true, stagnationRecoveryAttempt: 1, publicProgress: true,
  })
  expect(instructions).toContain('Keep workspace information private.')
  expect(instructions).toContain('Check the requested document')
  expect(instructions).toContain('Instructions elsewhere to create or update plans, call tools, or finish the task apply only to later work calls')
  expect(instructions).not.toContain('make harness_set_plan your first tool call')
  expect(instructions).not.toContain('Recovery attempt 1')
  expect(instructions).not.toContain('Return the final answer')
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
  expect(required).toContain('All action milestones are complete. Reply to the user now in plain text with the saved results and requested links. Reporting-only milestones finish with your answer; do not call tools or write tool calls as text.')
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
  expect(HARNESS_EVIDENCE_POLICY).toContain('Use harness_read_evidence to read a truncated observation by evidenceId or list omitted observations before claiming details were absent or repeating a successful tool')
})

test('checkpoints preserve short document facts after resource metadata within the existing byte budget', () => {
  let state = make(false)
  const text = 'Page 2 - depot shipments\n\nRegion  Crates\nNorth  12\nSouth  29\nTotal  41'
  for (let index = 0; index < 6; index++) {
    state = recordHarnessEvidence(state, harnessToolOutputEvidence({
      toolCallId: `read-${index}`, toolName: 'read_document', success: true,
      input: { fileId: `file-${index}`, page: 2, mode: 'text' },
      output: {
        success: true, fileId: `file-${index}`, revision: 'a'.repeat(64),
        page: 2, mode: 'text', text,
      },
    }, 1_100 + index), 1_100 + index)
  }
  const checkpoint = buildHarnessCheckpoint(state)
  expect(state.evidence.every(item => item.summary.length > 240)).toBe(true)
  expect(checkpoint.evidence).toHaveLength(6)
  expect(checkpoint.omittedEvidenceCount).toBe(0)
  expect(new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength).toBeLessThanOrEqual(7_500)
  checkpoint.evidence.forEach((item, index) => {
    expect(item.summary).toBe(state.evidence[index]!.summary)
    expect(JSON.parse(item.summary).textExcerpt).toBe(text)
    expect(item.excerptTruncated).toBe(false)
    expect(item.resource).toMatchObject({ id: `file-${index}`, revision: 'a'.repeat(64), page: 2 })
  })
})

test('checkpoints shorten large observations before dropping recent evidence', () => {
  let state = make(false)
  for (let index = 0; index < 6; index++) {
    state = recordHarnessEvidence(state, {
      id: `tool:${index}`, kind: 'tool_result', source: 'read',
      summary: '\u754c'.repeat(2_000), verdict: 'observed', createdAt: 1_000 + index,
    }, 1_000 + index)
  }
  const checkpoint = buildHarnessCheckpoint(state)
  expect(new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength).toBeLessThanOrEqual(7_500)
  expect(checkpoint.evidence).toHaveLength(6)
  expect(checkpoint.omittedEvidenceCount).toBe(0)
  expect(checkpoint.evidence.map(item => item.id)).toEqual(state.evidence.map(item => item.id))
  expect(checkpoint.evidence.every(item => item.excerptTruncated && item.summary.endsWith('[TRUNCATED]'))).toBe(true)
  expect(checkpoint.evidenceLookup).toBe('harness_read_evidence')
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
  expect(buildHarnessCheckpoint(longText).evidence[0]?.summary).toBe('A'.repeat(600))
  expect(buildHarnessCheckpoint(longText).evidence[0]?.excerptTruncated).toBe(false)
})

test('maximum-size checkpoint fields disclose omitted goal, plan and evidence details', () => {
  const state = {
    ...make(false),
    goal: 'g'.repeat(30_000),
    plan: Array.from({ length: 100 }, (_, index) => ({
      id: `step-${index}`,
      title: 't'.repeat(500),
      status: 'pending' as const,
      dependsOn: [],
      acceptanceCriteria: [],
      evidenceRefs: [`evidence-${index}-1`, `evidence-${index}-2`, `evidence-${index}-3`],
      requiresVerification: false,
      evidenceTools: [],
    })),
  }
  const checkpoint = buildHarnessCheckpoint(state)
  const serialized = JSON.stringify(checkpoint)
  expect(serialized.length).toBeLessThanOrEqual(7_500)
  expect(checkpoint.goalOmittedCharacters).toBeGreaterThan(0)
  expect(checkpoint.omittedPlanCount).toBeGreaterThan(0)
  expect(checkpoint.plan.some(step => step.excerptTruncated || step.omittedEvidenceRefCount > 0)).toBe(true)
  expect(JSON.parse(serialized)).toEqual(checkpoint)
})

test('checkpoint limits include JSON escaping and UTF-8 without truncating evidence identities', () => {
  const evidenceId = `tool:${'i'.repeat(250)}`
  const state = {
    ...make(false),
    goal: '\u0000'.repeat(8_000),
    plan: Array.from({ length: 4 }, (_, index) => ({
      id: `step-${index}${'x'.repeat(100)}`, title: 'Plan', status: 'pending' as const,
      dependsOn: [], acceptanceCriteria: [], requiresVerification: false,
      evidenceRefs: ['\u0000'.repeat(256), '\u0000'.repeat(256)],
    })),
  }
  const checkpoint = buildHarnessCheckpoint(state)
  expect(new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength).toBeLessThanOrEqual(7_500)
  const observed = recordHarnessEvidence(make(false), {
    id: evidenceId, kind: 'tool_result', source: 'read', summary: 'Observed', verdict: 'observed', createdAt: 1_001,
  }, 1_001)
  expect(buildHarnessCheckpoint(observed).evidence[0]?.id).toBe(evidenceId)
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
