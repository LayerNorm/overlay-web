import { expect, test, vi } from 'vitest'
import {
  admitHarnessChild, createHarnessSnapshot, recordHarnessEvidence, replaceHarnessPlan,
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
    else throw new Error('Unexpected operation')
    return parent
  })
  const readChild = vi.fn(async () => child)
  const waitForChildren = vi.fn<HarnessExecutionPorts['waitForChildren']>(async () => undefined)
  const ports = { read: async () => parent, readChild, waitForChildren, apply } as unknown as HarnessExecutionPorts
  return { ports, apply, readChild, waitForChildren, child }
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
