import { expect, test, vi } from 'vitest'
import {
  admitHarnessChild, blockHarness, createHarnessSnapshot, HarnessPlanValidationError, recordHarnessEvidence, replaceHarnessPlan,
  settleHarnessChild, transitionHarnessStep, type HarnessSnapshot,
} from '@overlay/agent-runtime/harness-state'
import { decodeRunQuestions } from '@/shared/agents/run-questions'
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

function noPlanState() {
  return createHarnessSnapshot({
    runId: 'no-plan',
    goal: 'Complete the requested action',
    constraints: [],
    policy: {
      actorUserId: 'user', allowedToolIds: ['ask_agent'], requiresPlan: false,
      deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxParallelChildren: 2, maxDepth: 2,
    },
  }, Date.now())
}

test('a blocked assignment returns its truthful blocker without joining indefinitely or recording success', async () => {
  const f = fixture()
  f.readChild.mockResolvedValue({ ...f.child, status: 'waiting_for_input' })
  f.ports.readAssignmentResult = async () => ({ assignmentId: 'assignment', attemptId: 'attempt', conversationId: 'room',
    turnId: 'reply', superseded: false, terminal: false, state: 'working', runStatus: 'waiting_for_input', summary: '',
    blocker: { kind: 'input', question: 'Need a decision' }, artifactRefs: [] })
  expect(await createHarnessControlTools(f.ports).harness_read_child.execute!({ childRunId: 'child' }, { toolCallId: 'blocked', messages: [] }))
    .toMatchObject({ status: 'waiting_for_input', blocker: { question: 'Need a decision' } })
  expect(f.waitForChildren).not.toHaveBeenCalled()
  expect(f.apply).not.toHaveBeenCalled()
})

test('assignment child reads return the canonical full reply and never settle publication-pending results', async () => {
  const f = fixture()
  const reply = 'Full final reply. '.repeat(2500)
  const readAssignmentResult = vi.fn(async () => ({ assignmentId: 'assignment', attemptId: 'attempt',
    conversationId: 'room', turnId: 'reply-turn', superseded: false, terminal: true,
    state: 'ready' as const, runStatus: 'completed', summary: 'Short summary', reply, artifactRefs: [] }))
  f.ports.readAssignmentResult = readAssignmentResult
  const result = await createHarnessControlTools(f.ports).harness_read_child.execute!(
    { childRunId: 'child' }, { toolCallId: 'read-assignment', messages: [] },
  )
  expect(result).toMatchObject({ reply, assignment: { reply, attemptId: 'attempt' } })
  expect(readAssignmentResult).toHaveBeenCalledWith('child')
  f.apply.mockClear()
  f.ports.readAssignmentResult = vi.fn(async () => ({ ...await readAssignmentResult(), state: 'publication_pending', reply: undefined }))
  const pending = await createHarnessControlTools(f.ports).harness_read_child.execute!(
    { childRunId: 'child' }, { toolCallId: 'read-pending', messages: [] },
  )
  expect(pending).toMatchObject({ publicationPending: true })
  expect(f.apply).not.toHaveBeenCalled()
  f.ports.readAssignmentResult = vi.fn(async () => ({ ...await readAssignmentResult(), runStatus: 'failed', failureReason: 'Delivery failed' }))
  expect(await createHarnessControlTools(f.ports).harness_read_child.execute!(
    { childRunId: 'child' }, { toolCallId: 'failed-delivery', messages: [] },
  )).toMatchObject({ status: 'failed', reply })
  expect(f.apply).not.toHaveBeenCalled()
})

test('plan steps need only an id and a title', async () => {
  const f = fixture()
  const apply = vi.fn<HarnessExecutionPorts['apply']>(async () => f.ports.read())
  const planTool = createHarnessControlTools({ ...f.ports, apply }).harness_set_plan
  await planTool.execute!({ steps: [{ id: 'work', title: 'Do the work' }] }, { toolCallId: 'raw-plan', messages: [] })
  expect(apply).toHaveBeenCalledWith('control:raw-plan', {
    type: 'replace_plan',
    steps: [{ id: 'work', title: 'Do the work', dependsOn: [], acceptanceCriteria: ['Do the work'], requiresVerification: false }],
  })
})

test('an invalid plan is returned to the model to correct', async () => {
  const apply = vi.fn<HarnessExecutionPorts['apply']>(async () => {
    throw new HarnessPlanValidationError('Unknown dependency.')
  })
  const plan = createHarnessControlTools({ ...fixture().ports, apply }).harness_set_plan
  const invalid = await plan.execute!({ steps: [{ id: 'work', title: 'Work', dependsOn: ['missing'] }] }, { toolCallId: 'invalid-plan', messages: [] })
  expect(invalid).toMatchObject({ success: false, code: 'tool_validation_failure', error: 'Unknown dependency.' })
})

test('questions can be asked without a plan and are stored for the questionnaire', async () => {
  const f = fixture()
  f.setParent(noPlanState())
  const questions = [{ prompt: 'Which account should I update?', choices: [{ label: 'Personal' }, { label: 'Team' }] }]
  const result = await createHarnessControlTools(f.ports).harness_report_blocker.execute!(
    { questions }, { toolCallId: 'ask', messages: [] },
  )
  expect(result).toEqual({ status: 'waiting_for_input', questions })
  const { blocker } = await f.ports.read()
  expect(blocker?.kind).toBe('input')
  expect(decodeRunQuestions(blocker!.question)).toEqual(questions)
})

test.each(['placeholder', 'Question', 'TBD', '???', 'short'])('"%s" is rejected and the run keeps going', async prompt => {
  const f = fixture()
  f.setParent(noPlanState())
  const result = await createHarnessControlTools(f.ports).harness_report_blocker.execute!(
    { questions: [{ prompt }] }, { toolCallId: 'bad-question', messages: [] },
  )
  expect(result).toMatchObject({ success: false, error: expect.stringContaining('not a real question') })
  expect(f.apply).not.toHaveBeenCalled()
  expect((await f.ports.read()).status).toBe('running')
})

test('questions too long to store are returned to the model to shorten', async () => {
  const f = fixture()
  f.setParent(noPlanState())
  const questions = Array.from({ length: 4 }, (_, index) => ({ prompt: `Question ${index} ${'x'.repeat(280)}`, description: 'y'.repeat(300) }))
  const result = await createHarnessControlTools(f.ports).harness_report_blocker.execute!(
    { questions }, { toolCallId: 'long-question', messages: [] },
  )
  expect(result).toMatchObject({ success: false, error: expect.stringContaining('too long') })
  expect(f.apply).not.toHaveBeenCalled()
})

test('a step is done when the model marks it done, with no evidence', async () => {
  const f = fixture()
  const policy = { actorUserId: 'user', allowedToolIds: ['read'], requiresPlan: false,
    deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxParallelChildren: 2, maxDepth: 2 }
  f.setParent(replaceHarnessPlan(
    createHarnessSnapshot({ runId: 'plain', goal: 'Do it', constraints: [], policy }, Date.now()),
    [{ id: 'work', title: 'Do it', dependsOn: [], acceptanceCriteria: ['Do it'], requiresVerification: false }],
    Date.now(),
  ))
  const result = await createHarnessControlTools(f.ports).harness_update_step.execute!(
    { id: 'work', status: 'done' }, { toolCallId: 'finish', messages: [] },
  )
  expect(result).toMatchObject({ step: { id: 'work', status: 'done' } })
})

test('a backend that still requires evidence returns its rejection to the model', async () => {
  const f = fixture()
  const apply = vi.fn<HarnessExecutionPorts['apply']>(async () => { throw new Error('Completion requires evidence.') })
  const result = await createHarnessControlTools({ ...f.ports, apply }).harness_update_step.execute!(
    { id: 'work', status: 'done' }, { toolCallId: 'old-backend', messages: [] },
  )
  expect(result).toEqual({ success: false, error: 'Completion requires evidence.' })
})

test('dependency rejection returns unresolved dependency IDs and a completion hint', async () => {
  const f = fixture()
  const policy = { actorUserId: 'user', allowedToolIds: ['read'], requiresPlan: false,
    deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxParallelChildren: 2, maxDepth: 2 }
  const parent = replaceHarnessPlan(
    createHarnessSnapshot({ runId: 'dependencies', goal: 'Complete dependent work', constraints: [], policy }, Date.now()),
    [
      { id: 'first', title: 'First step', dependsOn: [], acceptanceCriteria: ['Finish first'], requiresVerification: false },
      { id: 'second', title: 'Second step', dependsOn: ['first'], acceptanceCriteria: ['Finish second'], requiresVerification: false },
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
    pendingDependencyIds: ['first'],
    hint: 'Complete or skip these steps first.',
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

test('reopened artifact excerpts become bounded observations for final verification', async () => {
  const f = fixture()
  f.ports.readArtifact = vi.fn(async () => ({ kind: 'text', text: 'Final validation code: HARBOR_384_END_9K2',
    metadata: { artifactId: `ha_${'a'.repeat(64)}`, toolCallId: 'original-read', toolName: 'get_note',
      byteSize: 90_000, mediaPartCount: 0, resource: { id: 'note-source', revision: 'rev-7', operation: 'get_note' } } }))
  const control = createHarnessControlTools(f.ports).harness_read_artifact
  await control.execute!({ artifactId: `ha_${'a'.repeat(64)}`, start: 89_000, end: 90_000 }, { toolCallId: 'reopen-tail', messages: [] })
  const recorded = await f.ports.read()
  expect(recorded.evidence).toContainEqual(expect.objectContaining({ id: 'tool:reopen-tail', source: 'harness_read_artifact',
    resource: { id: 'note-source', revision: 'rev-7', operation: 'get_note' },
    summary: expect.stringContaining('HARBOR_384_END_9K2'), verdict: 'observed' }))
  expect(recorded.evidence.at(-1)!.summary.length).toBeLessThanOrEqual(2_000)
})

test('denied artifact reads never create observations', async () => {
  const f = fixture()
  f.ports.readArtifact = vi.fn(async () => { throw new Error('Source access revoked') })
  await expect(createHarnessControlTools(f.ports).harness_read_artifact.execute!(
    { artifactId: `ha_${'a'.repeat(64)}`, start: 0, end: 1_000 },
    { toolCallId: 'denied-read', messages: [] },
  )).rejects.toThrow('Source access revoked')
  expect(f.apply).not.toHaveBeenCalled()
})
