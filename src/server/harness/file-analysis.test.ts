import { expect, test, vi } from 'vitest'
import { createHarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { createHarnessControlTools } from './control-tools'
import { fileAnalysisAssignments, fileAnalysisConstraints, fileAnalysisCoverage } from './file-analysis-coverage'
import { harnessToolOutputEvidence } from './tool-evidence'
import type { HarnessExecutionPorts } from './ports'

const partition = { fileId: 'file', revision: 'revision', startPage: 1, endPage: 3 }
function observation(page: number, output: Record<string, unknown>, toolName = 'read_document') {
  return harnessToolOutputEvidence({ toolCallId: `page-${page}`, toolName,
    input: { fileId: partition.fileId, revision: partition.revision, page },
    output: { success: true, fileId: partition.fileId, revision: partition.revision, page, mode: 'text', ...output },
    success: true,
  }, 1)
}

test('coverage requires successful exact-revision page observations, not child prose or table candidates', () => {
  const evidence = [
    observation(1, { text: 'Source text' }),
    observation(2, { revision: 'another-revision' }),
    observation(3, { mode: 'tables' }),
    observation(3, { text: 'Every page was read' }, 'computer_exec'),
  ]
  const result = fileAnalysisCoverage([partition], evidence)
  expect(result.examined.map(page => page.page)).toEqual([1])
  expect(result.missing.map(page => page.page)).toEqual([2, 3])
  expect(result.complete).toBe(false)
  expect(evidence[0].summary).toContain('Source text')
  expect(evidence[0].resource).toEqual({ id: 'file', revision: 'revision', page: 1, operation: 'read_document' })
})

test('blank/truncated pages stay missing until rendered; failed and stale reads remain distinct', () => {
  const result = fileAnalysisCoverage([partition], [
    observation(1, { needsVisualInspection: true }),
    observation(1, { mode: 'render' }),
    observation(2, { success: false, error: 'Source revision mismatch; refresh file metadata before reading.' }),
    observation(3, { truncated: true }),
  ])
  expect(result.examined.map(page => page.page)).toEqual([1])
  expect(result.stale.map(page => page.page)).toEqual([2])
  expect(result.unavailable.map(page => page.page)).toEqual([3])
  expect(result.complete).toBe(false)
  expect(fileAnalysisCoverage([partition], [1, 2, 3].map(page => observation(page, {}))).complete).toBe(true)
})

test('bounded page evidence retains facts without binary payloads or false full-page coverage', () => {
  const evidence = observation(1, { text: 'Known source fact. ' + '\u0000'.repeat(5_000), image: new Uint8Array(1_024) })
  const value = JSON.parse(evidence.summary)
  expect(evidence.summary.length).toBeLessThanOrEqual(2_000)
  expect(value.textExcerpt).toContain('Known source fact.')
  expect(value.textExcerptTruncated).toBe(true)
  expect(value.image).toBeUndefined()
  expect(fileAnalysisCoverage([partition], [evidence]).examined.map(page => page.page)).toEqual([1])

  const partial = observation(2, { text: 'Partial page fact', truncated: true })
  expect(JSON.parse(partial.summary)).toMatchObject({ success: true, coverageComplete: false, textExcerpt: 'Partial page fact' })
  expect(partial.verdict).toBe('observed')
  expect(fileAnalysisCoverage([partition], [partial]).examined).toEqual([])
})

test('analysis schema bounds work and delegates only inherited tools with a durable assignment manifest', async () => {
  const policy = { actorUserId: 'user', workspaceId: 'workspace', allowedToolIds: ['read_file', 'read_document', 'computer_exec', 'send_message'],
    requiresPlan: false, deadlineAt: Date.now() + 60_000, maxCostMicros: 100, maxParallelChildren: 2, maxDepth: 2 }
  const state = createHarnessSnapshot({ runId: 'parent', goal: 'Analyze files', constraints: [], policy }, Date.now())
  const delegate = vi.fn<HarnessExecutionPorts['delegate']>(async () => ({ id: 'child' }) as never)
  const ports = { fileAnalysisEnabled: true, read: async () => state, delegate } as unknown as HarnessExecutionPorts
  const tool = createHarnessControlTools(ports).harness_analyze_files!
  const input = { stepId: 'work', goal: 'Compare results', partitions: [partition], maxCostMicros: 0 }
  expect(() => tool.inputSchema.parse({ ...input, partitions: [partition, partition] })).toThrow('overlap')
  expect(() => tool.inputSchema.parse({ ...input, partitions: [{ ...partition, endPage: 21 }] })).toThrow()
  await tool.execute!(tool.inputSchema.parse(input), { toolCallId: 'stable-call', messages: [] })
  expect(delegate.mock.calls[0]).toEqual([expect.objectContaining({
    allowedToolIds: ['read_file', 'read_document', 'computer_exec'], maxCostMicros: 0,
    constraints: fileAnalysisConstraints([partition], 'stable-call'),
  }), 'stable-call'])
  expect(fileAnalysisAssignments({ constraints: delegate.mock.calls[0][0].constraints })).toEqual([partition])
  expect(createHarnessControlTools({ ...ports, fileAnalysisEnabled: false }).harness_analyze_files).toBeUndefined()
  state.status = 'cancelled'
  await expect(tool.execute!(input, { toolCallId: 'cancelled-call', messages: [] })).resolves.toMatchObject({ success: false })
  expect(delegate).toHaveBeenCalledTimes(1)
})

test('nested assignments replace inherited manifests while fitting durable constraint limits', () => {
  const partitions = Array.from({ length: 32 }, (_, index) => ({ ...partition, fileId: `${'f'.repeat(240)}${index}` }))
  const inherited = fileAnalysisConstraints(partitions, 'parent-call')
  expect(inherited.every(value => value.length <= 2000)).toBe(true)
  expect(fileAnalysisAssignments({ constraints: inherited })).toEqual(partitions)
  const own = fileAnalysisConstraints([partition], 'child-call')
  expect(fileAnalysisAssignments({ constraints: [...inherited, ...own] })).toEqual([partition])
})
