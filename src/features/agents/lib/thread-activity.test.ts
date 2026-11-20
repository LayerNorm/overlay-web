import assert from 'node:assert/strict'
import test from 'node:test'
import { threadActivity } from './thread-activity'

const call = (toolCallId: string, toolName: string, toolInput: Record<string, unknown>, toolOutput?: unknown, state = 'output-available') => ({
  type: 'tool-invocation', toolInvocation: { toolCallId, toolName, state, toolInput, toolOutput },
})

test('an empty or human-only thread has no activity', () => {
  assert.deepEqual(threadActivity([]), { plan: null, calls: [], edits: [] })
  const human = threadActivity([{ id: 'h', authorKind: 'human', createdAt: 1, parts: [call('x', 'computer_exec', { command: 'ls' })] }])
  assert.equal(human.calls.length, 0)
})

test('the newest plan is read with whether its run is still going', () => {
  const steps = [{ id: 'a', title: 'Reproduce', status: 'done' }]
  const later = [{ id: 'b', title: 'Fix', status: 'running' }]
  const activity = threadActivity([
    { id: '1', authorKind: 'agent', createdAt: 1, status: 'completed', agentPlan: steps },
    { id: '2', authorKind: 'agent', createdAt: 2, status: 'generating', agentPlan: later },
    { id: '3', authorKind: 'agent', createdAt: 3, status: 'completed' },
  ])
  assert.deepEqual(activity.plan, { steps: later, phase: 'active' })
})

test('a plan whose run asked a question is waiting for the answer', () => {
  const steps = [{ id: 'a', title: 'Run the command', status: 'running' }]
  const question = { runId: 'r', conversationId: 'c', userId: 'u', token: 't', requestedAt: 1, question: 'Authorize?' }
  const activity = threadActivity([{
    id: '1', authorKind: 'agent', createdAt: 1, status: 'generating', agentPlan: steps,
    parts: [{ type: 'data-native-agent-input', data: question }],
  }])
  assert.equal(activity.plan?.phase, 'waiting')
})

test('edits to the same file add up their line counts', () => {
  const activity = threadActivity([{
    id: '1', authorKind: 'agent', createdAt: 1, parts: [
      call('w1', 'computer_write_file', { path: 'src/a.ts', contents: 'x' }, { success: true, created: false, linesAdded: 3, linesRemoved: 1 }),
      call('w2', 'computer_write_file', { path: 'src/a.ts', contents: 'y' }, { success: true, created: false, linesAdded: 2, linesRemoved: 2 }),
      call('w3', 'computer_write_file', { path: 'src/b.ts', contents: 'z' }, { success: false, error: 'denied' }),
    ],
  }])
  assert.deepEqual(activity.edits, [{ path: 'src/a.ts', added: 5, removed: 3 }])
})
