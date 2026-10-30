import { expect, test, vi } from 'vitest'
import {
  admitHarnessChild, blockHarness, createHarnessSnapshot, recordHarnessEvidence, replaceHarnessPlan,
  settleHarnessChild, transitionHarnessStep, type HarnessSnapshot,
} from '@overlay/agent-runtime/harness-state'
import { createHarnessControlTools } from './control-tools'
import type { HarnessExecutionPorts } from './ports'

function fixture() {
  const policy = { actorUserId: 'user', allowedToolIds: [], requiresPlan: false,
    deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxParallelChildren: 2, maxDepth: 2 }
  let parent = createHarnessSnapshot({ runId: 'parent', goal: 'Read child findings', constraints: [], policy }, Date.now())
  parent = replaceHarnessPlan(parent, [{ id: 'work', title: 'Read child findings', dependsOn: [],
    acceptanceCriteria: ['Read the child result'], requiresVerification: false }], Date.now())
  parent = admitHarnessChild(parent, { id: 'child', stepId: 'work', status: 'running', maxCostMicros: 0,
    costMicros: 0, allowedToolIds: [], evidenceRefs: [] }, Date.now())
  const child: HarnessSnapshot = { ...createHarnessSnapshot({ runId: 'child', goal: 'Bounded work', constraints: [], policy }, Date.now()),
    parentRunId: parent.runId, rootRunId: parent.rootRunId, depth: 1, status: 'completed', resultSummary: 'Child findings.' }
  const apply = vi.fn<HarnessExecutionPorts['apply']>(async (_id, operation) => {
    if (operation.type === 'settle_child') parent = settleHarnessChild(parent, child, Date.now())
    else if (operation.type === 'record_evidence') parent = recordHarnessEvidence(parent, operation.evidence, Date.now())
    else if (operation.type === 'transition_step') parent = transitionHarnessStep(parent, operation, Date.now())
    else if (operation.type === 'block') parent = blockHarness(parent, operation.blocker, Date.now())
    else throw new Error('Unexpected operation')
    return parent
  })
  const setParent = (snapshot: HarnessSnapshot) => { parent = snapshot }
  const readChild = vi.fn(async () => child)
  const waitForChildren = vi.fn<HarnessExecutionPorts['waitForChildren']>(async () => undefined)
  const ports = { read: async () => parent, readChild, waitForChildren, apply } as unknown as HarnessExecutionPorts
  return { ports, apply, readChild, waitForChildren, child, setParent }
}

function planningGateState() {
  return createHarnessSnapshot({
    runId: 'planning-gate',
    goal: 'Complete the requested action',
    constraints: [],
    policy: {
      actorUserId: 'user', allowedToolIds: ['ask_agent'], requiresPlan: true,
      deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxParallelChildren: 2, maxDepth: 2,
    },
  }, Date.now())
}

test('completed child results become parent observations without certifying independent verification', async () => {
  const f = fixture()
  const execute = createHarnessControlTools(f.ports).harness_read_child.execute!
  const result = await execute({ childRunId: 'child' }, { toolCallId: 'read-child', messages: [] })
  expect(result).toMatchObject({ status: 'completed', summary: 'Child findings.', evidenceRef: 'child-result:read-child' })
  const parent = await f.ports.read()
  expect(parent.evidence).toHaveLength(1)
  expect(parent.evidence[0]).toMatchObject({ id: 'child-result:read-child', kind: 'tool_result',
    source: 'harness_read_child:child', verdict: 'observed' })
  expect(parent.evidence[0].verification).toBeUndefined()
  expect(JSON.parse(parent.evidence[0].summary)).toEqual({ childRunId: 'child', status: 'completed',
    summary: 'Child findings.', evidenceRefs: [] })
  expect(f.apply.mock.calls[0]).toEqual(['settle-child:child:0', { type: 'settle_child', childRunId: 'child' }])
  expect(f.apply.mock.calls[1][0]).toBe('control:read-child')
  expect(parent.children[0].status).toBe('completed')
  await createHarnessControlTools(f.ports).harness_update_step.execute!(
    { id: 'work', status: 'done', evidenceRefs: ['child-result:read-child'] }, { toolCallId: 'finish-work', messages: [] },
  )
  expect((await f.ports.read()).plan[0].status).toBe('done')
})

test('plan tools accept answer-only milestones', () => {
  const planTool = createHarnessControlTools(fixture().ports).harness_set_plan
  expect(planTool.inputSchema.parse({
    steps: [{
      id: 'answer',
      title: 'Answer from prior knowledge',
      dependsOn: [],
      acceptanceCriteria: ['Answer the question.'],
      requiresVerification: false,
      answerOnly: true,
    }],
  })).toMatchObject({ steps: [{ answerOnly: true }] })
})

test('plan tools keep omitted verification optional and preserve explicit requests', () => {
  const planTool = createHarnessControlTools(fixture().ports).harness_set_plan
  const step = { id: 'work', title: 'Do work', dependsOn: [], acceptanceCriteria: ['Complete the work.'] }
  expect(planTool.inputSchema.parse({ steps: [step] }).steps[0]?.requiresVerification).toBeUndefined()
  expect(planTool.inputSchema.parse({ steps: [{ ...step, requiresVerification: true }] }).steps[0]?.requiresVerification).toBe(true)
})

test('plan execution normalizes raw omitted verification input before applying the operation', async () => {
  const f = fixture()
  const apply = vi.fn<HarnessExecutionPorts['apply']>(async () => f.ports.read())
  const planTool = createHarnessControlTools({ ...f.ports, apply }).harness_set_plan
  await planTool.execute!({
    steps: [{
      id: 'work',
      title: 'Raw model plan',
      dependsOn: [],
      acceptanceCriteria: ['Apply normalized input'],
      answerOnly: false,
      evidenceTools: ['ask_agent'],
    }],
  }, { toolCallId: 'raw-plan', messages: [] })

  expect(apply).toHaveBeenCalledWith('control:raw-plan', {
    type: 'replace_plan',
    steps: [{
      id: 'work',
      title: 'Raw model plan',
      dependsOn: [],
      acceptanceCriteria: ['Apply normalized input'],
      requiresVerification: false,
      evidenceTools: ['ask_agent'],
    }],
  })
})

test('blockers are rejected until a required plan exists', async () => {
  const f = fixture()
  f.setParent(planningGateState())
  const blockerTool = createHarnessControlTools(f.ports).harness_report_blocker
  const result = await blockerTool.execute!(
    { question: 'Which account should I update?' },
    { toolCallId: 'deferred-blocker', messages: [] },
  )

  expect(result).toEqual({
    success: false,
    error: 'Call harness_set_plan first; report blockers after the plan exists.',
  })
  expect(f.apply).not.toHaveBeenCalled()
  expect((await f.ports.read()).status).toBe('running')
})

test.each([
  'I cannot ask_agent because it is unavailable.',
  'Which account should I update?',
])('blockers are recorded after a plan exists: %s', async question => {
  const f = fixture()
  const planned = replaceHarnessPlan(planningGateState(), [{
    id: 'work', title: 'Ask the agent', dependsOn: [], acceptanceCriteria: ['Agent consulted'], requiresVerification: false,
    evidenceTools: ['ask_agent'],
  }], Date.now())
  f.setParent(planned)
  const blockerTool = createHarnessControlTools(f.ports).harness_report_blocker
  const result = await blockerTool.execute!({ question }, { toolCallId: 'post-plan-blocker', messages: [] })

  expect(result).toEqual({ status: 'waiting_for_input', question })
  expect(f.apply).toHaveBeenCalledWith('control:post-plan-blocker', {
    type: 'block', blocker: { kind: 'input', question },
  })
  expect((await f.ports.read()).status).toBe('waiting_for_input')
})

test('verification rejection tells the model to revise an unsatisfiable plan', async () => {
  const f = fixture()
  const policy = { actorUserId: 'user', allowedToolIds: [], requiresPlan: false,
    deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxParallelChildren: 2, maxDepth: 2 }
  let parent = createHarnessSnapshot({ runId: 'verification', goal: 'Check work', constraints: [], policy }, Date.now())
  parent = replaceHarnessPlan(parent, [{ id: 'work', title: 'Check work', dependsOn: [],
    acceptanceCriteria: ['Check work'], requiresVerification: true }], Date.now())
  parent = recordHarnessEvidence(parent, {
    id: 'source:1', kind: 'tool_result', source: 'read', summary: 'Observed source', verdict: 'observed', createdAt: Date.now(),
  }, Date.now())
  f.setParent(parent)
  const result = await createHarnessControlTools(f.ports).harness_update_step.execute!(
    { id: 'work', status: 'done', evidenceRefs: ['source:1'] }, { toolCallId: 'finish-work', messages: [] },
  )
  expect(result).toEqual({
    success: false,
    error: 'Independent verification of this milestone in the current plan revision is required.',
    hint: 'Revise the plan if no independent verifier is available for this milestone.',
  })
  expect((await f.ports.read()).plan[0].status).toBe('pending')
})

test('rejected evidence updates return the 12 most recent successful evidence IDs', async () => {
  const f = fixture()
  let parent = await f.ports.read()
  for (let index = 1; index <= 15; index++) {
    parent = recordHarnessEvidence(parent, {
      id: `evidence:${index}`,
      kind: 'tool_result',
      source: 'read',
      summary: `Observation ${index}`,
      verdict: index === 15 ? 'failed' : 'observed',
      createdAt: index,
    }, index)
  }
  f.setParent(parent)

  const result = await createHarnessControlTools(f.ports).harness_update_step.execute!(
    { id: 'work', status: 'done', evidenceRefs: ['missing-evidence'] },
    { toolCallId: 'bad-evidence', messages: [] },
  )

  expect(result).toEqual({
    success: false,
    error: 'Evidence must reference successful observations from this run.',
    availableEvidenceIds: Array.from({ length: 12 }, (_, index) => ({ id: `evidence:${14 - index}`, source: 'read' })),
  })
})

test.each([
  { error: 'Completion requires evidence.', evidenceKind: undefined },
  { error: 'Completion requires tool-result evidence.', evidenceKind: 'artifact' as const },
  { error: "Completion requires tool-result evidence from this milestone's evidenceTools.", evidenceKind: 'tool_result' as const },
])('completion rejection for $error returns evidence and answerOnly guidance', async ({ error, evidenceKind }) => {
  const f = fixture()
  const policy = { actorUserId: 'user', allowedToolIds: ['read', 'get_note'], requiresPlan: true,
    deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxParallelChildren: 2, maxDepth: 2 }
  let parent = createHarnessSnapshot({ runId: 'completion', goal: 'Complete the milestone', constraints: [], policy }, Date.now())
  parent = replaceHarnessPlan(parent, [{ id: 'work', title: 'Complete the milestone', dependsOn: [],
    acceptanceCriteria: ['Complete the work'], requiresVerification: false, evidenceTools: ['read'] }], Date.now())
  const evidenceRefs = evidenceKind ? ['artifact:1'] : undefined
  if (evidenceKind) {
    parent = recordHarnessEvidence(parent, {
      id: 'artifact:1', kind: evidenceKind, source: evidenceKind === 'tool_result' ? 'get_note' : 'file',
      summary: 'A supplied artifact', verdict: 'observed', createdAt: Date.now(),
    }, Date.now())
  }
  f.setParent(parent)

  const result = await createHarnessControlTools(f.ports).harness_update_step.execute!(
    { id: 'work', status: 'done', ...(evidenceRefs ? { evidenceRefs } : {}) },
    { toolCallId: 'complete-work', messages: [] },
  )

  expect(result).toEqual({
    success: false,
    error,
    availableEvidenceIds: evidenceRefs
      ? [{ id: 'artifact:1', source: evidenceKind === 'tool_result' ? 'get_note' : 'file' }]
      : [],
    hint: 'Cite tool:<id> evidence that supports this milestone, or revise the plan with harness_set_plan to mark a milestone that only reports results as answerOnly.',
  })
  expect((await f.ports.read()).plan[0]?.status).toBe('pending')
})

test('tool-result evidence already used by another action milestone returns model-visible guidance', async () => {
  const f = fixture()
  const now = Date.now()
  const policy = { actorUserId: 'user', allowedToolIds: ['create_note'], requiresPlan: true,
    deadlineAt: now + 60_000, maxCostMicros: 0, maxParallelChildren: 2, maxDepth: 2 }
  let parent = createHarnessSnapshot({ runId: 'write-evidence', goal: 'Complete both actions', constraints: [], policy }, now)
  parent = replaceHarnessPlan(parent, [
    { id: 'first', title: 'First action', dependsOn: [], acceptanceCriteria: ['First action done'], requiresVerification: false, evidenceTools: ['create_note'] },
    { id: 'second', title: 'Second action', dependsOn: [], acceptanceCriteria: ['Second action done'], requiresVerification: false, evidenceTools: ['create_note'] },
  ], now)
  parent = recordHarnessEvidence(parent, {
    id: 'tool:create_note', kind: 'tool_result', source: 'create_note', summary: 'Created a note', verdict: 'observed', createdAt: now,
  }, now)
  parent = transitionHarnessStep(parent, {
    id: 'first', status: 'done', evidenceRefs: ['tool:create_note'],
  }, now)
  f.setParent(parent)

  const result = await createHarnessControlTools(f.ports).harness_update_step.execute!(
    { id: 'second', status: 'done', evidenceRefs: ['tool:create_note'] },
    { toolCallId: 'reuse-write-result', messages: [] },
  )

  expect(result).toEqual({
    success: false,
    error: 'Evidence from a tool result already supports another milestone.',
    availableEvidenceIds: [],
    hint: "Cite the tool result that performed this milestone's own action, or revise the plan to merge the milestones.",
  })
  expect((await f.ports.read()).plan.find(step => step.id === 'second')?.status).toBe('pending')
})

test('dependency rejection returns unresolved dependency IDs and a completion hint', async () => {
  const f = fixture()
  const policy = { actorUserId: 'user', allowedToolIds: ['read'], requiresPlan: true,
    deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxParallelChildren: 2, maxDepth: 2 }
  const parent = replaceHarnessPlan(
    createHarnessSnapshot({ runId: 'dependencies', goal: 'Complete dependent work', constraints: [], policy }, Date.now()),
    [
      { id: 'first', title: 'First milestone', dependsOn: [], acceptanceCriteria: ['Finish first'], requiresVerification: false, evidenceTools: ['read'] },
      { id: 'second', title: 'Second milestone', dependsOn: ['first'], acceptanceCriteria: ['Finish second'], requiresVerification: false, evidenceTools: ['read'] },
    ],
    Date.now(),
  )
  f.setParent(parent)

  const result = await createHarnessControlTools(f.ports).harness_update_step.execute!(
    { id: 'second', status: 'done' }, { toolCallId: 'complete-second', messages: [] },
  )

  expect(result).toEqual({
    success: false,
    error: 'Dependencies are not complete.',
    availableEvidenceIds: [],
    pendingDependencyIds: ['first'],
    hint: 'Complete or skip these milestones first.',
  })
  expect((await f.ports.read()).plan.find(step => step.id === 'second')?.status).toBe('pending')
})

test('a completed child with unresolved usage cannot expose completion evidence', async () => {
  const f = fixture()
  f.child.modelReservation = { id: 'model:0', maxCostMicros: 0 }
  await expect(createHarnessControlTools(f.ports).harness_read_child.execute!(
    { childRunId: 'child' }, { toolCallId: 'read-child', messages: [] },
  )).rejects.toThrow('Reconcile outstanding child model calls')
  const parent = await f.ports.read()
  expect(parent.children[0].status).toBe('running')
  expect(parent.evidence).toHaveLength(0)
  expect(f.child.modelReservation).toBeDefined()
})

test('joining an active child suspends until its completed result is available', async () => {
  const f = fixture()
  f.readChild.mockResolvedValueOnce({ ...f.child, status: 'running' })
  let complete!: () => void
  f.waitForChildren.mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  const pending = createHarnessControlTools(f.ports).harness_read_child.execute!(
    { childRunId: 'child' }, { toolCallId: 'read-child', messages: [] },
  )
  await vi.waitFor(() => expect(f.waitForChildren).toHaveBeenCalledWith(['child']))
  expect(f.apply).not.toHaveBeenCalled()
  complete()
  await expect(pending).resolves.toMatchObject({ status: 'completed', evidenceRef: 'child-result:read-child' })
  expect(f.readChild).toHaveBeenCalledTimes(2)
  expect(f.waitForChildren).toHaveBeenCalledOnce()
})

test.each(['failed', 'cancelled'] as const)('%s children do not produce completion evidence', async status => {
  const f = fixture()
  f.readChild.mockResolvedValue({ ...f.child, status })
  const result = await createHarnessControlTools(f.ports).harness_read_child.execute!(
    { childRunId: 'child' }, { toolCallId: 'read-child', messages: [] },
  )
  expect(result).not.toHaveProperty('evidenceRef')
  expect(f.apply).not.toHaveBeenCalled()
})

test('unrelated children cannot supply parent completion evidence', async () => {
  const f = fixture()
  f.readChild.mockResolvedValue({ ...f.child, parentRunId: 'other-parent' })
  await expect(createHarnessControlTools(f.ports).harness_read_child.execute!(
    { childRunId: 'child' }, { toolCallId: 'read-child', messages: [] },
  )).rejects.toThrow('Invalid child lineage')
  expect(f.apply).not.toHaveBeenCalled()
})

test('answer-only plans normalize empty evidence tools without relaxing action proof', async () => {
  const f = fixture()
  const initial = planningGateState()
  const apply: HarnessExecutionPorts['apply'] = async (_id, operation) => {
    if (operation.type !== 'replace_plan') throw new Error('Unexpected operation')
    return replaceHarnessPlan(initial, operation.steps, Date.now())
  }
  const plan = createHarnessControlTools({ ...f.ports, apply }).harness_set_plan
  const step = { id: 'answer', title: 'Answer the question', dependsOn: [],
    acceptanceCriteria: ['Return the requested answer'], answerOnly: true, evidenceTools: [] }
  const result = await plan.execute!({ steps: [step] }, { toolCallId: 'answer-plan', messages: [] })
  expect(result).toMatchObject({ plan: [{ id: 'answer', answerOnly: true }] })
  await expect(plan.execute!({ steps: [{ ...step, answerOnly: false }] }, {
    toolCallId: 'action-plan', messages: [],
  })).rejects.toThrow('must declare evidenceTools')
})
