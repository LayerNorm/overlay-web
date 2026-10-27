import { expect, test, vi } from 'vitest'
import { cancelPersonalHarnessWorkflows } from './personal-cancellation'

vi.mock('server-only', () => ({}))
vi.mock('@/server/observability/logger', () => ({ logger: { warn: vi.fn() } }))

const input = { actorUserId: 'user', agentRunId: 'delivery', rootRunId: 'root' }

test('continues through empty pages and cancels every claimed workflow', async () => {
  const pages = [
    { workflowRunIds: [], cursor: 'next', isDone: false },
    { workflowRunIds: ['root-workflow', 'child-workflow'], cursor: 'done', isDone: true },
  ]
  const list = vi.fn()
    .mockResolvedValueOnce(pages[0])
    .mockResolvedValueOnce(pages[1])
  const cancel = vi.fn().mockResolvedValue(undefined)

  await cancelPersonalHarnessWorkflows(input, { list, cancel })

  expect(list).toHaveBeenNthCalledWith(1, { ...input, cursor: null })
  expect(list).toHaveBeenNthCalledWith(2, { ...input, cursor: 'next' })
  expect(cancel).toHaveBeenCalledTimes(2)
  expect(cancel).toHaveBeenNthCalledWith(1, 'root-workflow')
  expect(cancel).toHaveBeenNthCalledWith(2, 'child-workflow')
})

test('one SDK cancellation failure does not prevent sibling cleanup', async () => {
  const list = vi.fn().mockResolvedValue({ workflowRunIds: ['failed', 'sibling'], cursor: 'done', isDone: true })
  const cancel = vi.fn()
    .mockRejectedValueOnce(new Error('already gone'))
    .mockResolvedValueOnce(undefined)

  await expect(cancelPersonalHarnessWorkflows(input, { list, cancel })).resolves.toBeUndefined()
  expect(cancel).toHaveBeenCalledTimes(2)
})
