import { expect, test, vi } from 'vitest'
import { createHarnessSnapshot, recordHarnessEvidence, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { createHarnessControlTools } from './control-tools'
import type { HarnessExecutionPorts } from './ports'

function fixture() {
  const policy = { actorUserId: 'user', allowedToolIds: [], requiresPlan: false,
    deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxParallelChildren: 2, maxDepth: 2 }
  let parent = createHarnessSnapshot({ runId: 'parent', goal: 'Read child findings', constraints: [], policy }, Date.now())
  parent.children.push({ id: 'child', stepId: 'work', status: 'completed', maxCostMicros: 0,
    costMicros: 0, allowedToolIds: [], evidenceRefs: [] })
  const child: HarnessSnapshot = { ...createHarnessSnapshot({ runId: 'child', goal: 'Bounded work', constraints: [], policy }, Date.now()),
    parentRunId: parent.runId, rootRunId: parent.rootRunId, status: 'completed', resultSummary: 'Child findings.' }
  const apply = vi.fn<HarnessExecutionPorts['apply']>(async (_id, operation) => {
    if (operation.type !== 'record_evidence') throw new Error('Unexpected operation')
    parent = recordHarnessEvidence(parent, operation.evidence, Date.now())
    return parent
  })
  const readChild = vi.fn(async () => child)
  const ports = { read: async () => parent, readChild, apply } as unknown as HarnessExecutionPorts
  return { ports, apply, readChild, child }
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
  expect(f.apply.mock.calls[0][0]).toBe('control:read-child')
})

test.each(['running', 'failed', 'cancelled'] as const)('%s children do not produce completion evidence', async status => {
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
