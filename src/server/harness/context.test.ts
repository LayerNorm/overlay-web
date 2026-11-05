import { expect, test } from 'vitest'
import { createHarnessSnapshot, recordHarnessEvidence, recordHarnessReceipt, replaceHarnessPlan, transitionHarnessStep } from '@overlay/agent-runtime/harness-state'
import { buildHarnessInstructions, buildHarnessStepInstructions, buildHarnessWorkingContext, harnessProgressFingerprint, HARNESS_CONTROL_TOOLS } from './context'
import { buildHarnessCheckpoint } from './continuity'
import { HARNESS_EVIDENCE_POLICY } from './continuity-policy'
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
    acceptanceCriteria: ['Document read'], requiresVerification: false }], 1_000)
  const context = { instructions: 'Surface instructions', continuation: true, truncatedResponse: false }
  expect(buildHarnessStepInstructions(state, context)).toContain('finish the remaining plan steps')
  state = transitionHarnessStep(state, { id: 'work', status: 'done' }, 1_000)
  const instructions = buildHarnessStepInstructions(state, context)
  expect(instructions).toContain('Every plan step is finished.')
  expect(instructions).toContain('If you already wrote it, end your turn without repeating it.')
  expect(instructions).not.toContain('finish the remaining plan steps')
})

test('the model plans only when a task needs structure', () => {
  const instructions = buildHarnessStepInstructions(make(), {
    instructions: 'Surface instructions', continuation: false, truncatedResponse: false,
  })
  const system = buildHarnessInstructions('Surface instructions')
  expect(system).toContain('If a task seems long and needs structure, create a concise plan with harness_set_plan')
  expect(system).toContain('Simple questions and quick tasks don\'t need a plan')
  expect(system).toContain('For comprehensive document work, partition versioned page ranges, delegate bounded analysis with harness_analyze_files when available, join completed children, and check reported missing ranges before claiming complete coverage. Use deterministic code for exact aggregation.')
  expect(system).toContain('Marking a step done means the work is finished.')
  expect(system).not.toContain('evidenceTools')
  expect(instructions).not.toContain('before anything else')
  expect(instructions).not.toContain('evidenceTools')
  expect(instructions).not.toContain('answerOnly')
  expect(instructions).toContain(
    'The goal in the working state is the current request and the only task for this run. Use earlier conversation only to interpret it; never resume, repeat or plan an earlier request unless the goal asks for it.',
  )
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

test('requests a plain-text final answer after a protocol-only response', () => {
  const state = make()
  const context = { instructions: 'Surface instructions', continuation: true, truncatedResponse: false }
  const required = buildHarnessStepInstructions(state, { ...context, finalAnswerRequired: true })
  expect(required).toContain('Reply to the person now in plain text with the results and any requested links.')
  expect(buildHarnessStepInstructions(state, context)).not.toContain('Reply to the person now in plain text')
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

test('a continuation with no plan never implies that plan steps were done', () => {
  const instructions = buildHarnessStepInstructions(make(false), {
    instructions: 'Surface instructions', continuation: true, truncatedResponse: false,
  })
  expect(instructions).toContain('Only work shown in the observations has been done')
  expect(instructions).not.toContain('remaining plan steps')
})
