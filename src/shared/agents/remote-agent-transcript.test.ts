import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentRemoteEvent } from '@overlay/workspace-contracts'
import { projectRemoteAgentEvents, waitingRemoteAgentParts } from './remote-agent-transcript'

function event(sequence: number, type: AgentRemoteEvent['type'], payload: Record<string, unknown>): AgentRemoteEvent {
  return {
    protocolVersion: 1,
    eventId: `event-${sequence}`,
    environmentId: 'environment-1',
    runId: 'run-1',
    sourceSequence: sequence,
    type,
    occurredAt: sequence,
    payload,
  }
}

test('remote checkpoints replace one stable markdown block and actions update in place', () => {
  const projection = projectRemoteAgentEvents({
    content: 'Waiting for MacBook',
    parts: waitingRemoteAgentParts({ environmentName: 'MacBook', queueExpiresAt: 5000, runId: 'run-1' }),
    events: [
      event(1, 'session_started', { remoteSessionId: 'codex-session', adapterId: 'codex' }),
      event(2, 'text_checkpoint', { text: '# Result\n\nFirst complete checkpoint' }),
      event(3, 'action', { actionId: 'shell-1', title: 'Run tests', status: 'started' }),
      event(4, 'action', { actionId: 'shell-1', title: 'Run tests', status: 'completed' }),
      event(5, 'text_checkpoint', { text: '# Result\n\nFinal stable markdown' }),
    ],
    environmentName: 'MacBook',
    queueExpiresAt: 5000,
    runId: 'run-1',
  })
  assert.equal(projection.content, '# Result\n\nFinal stable markdown')
  assert.equal(projection.remoteSessionId, 'codex-session')
  assert.equal(projection.parts.filter((part) => part.type === 'text').length, 1)
  assert.equal(projection.parts.filter((part) => part.type === 'tool-invocation').length, 1)
  assert.equal(projection.terminal, false)
})

test('terminal event closes transcript once with normalized usage', () => {
  const projection = projectRemoteAgentEvents({
    content: 'Done',
    parts: [{ type: 'text', text: 'Done' }],
    events: [event(1, 'completed', { summary: 'ignored', usage: { input_tokens: 12, outputTokens: 7 } })],
    environmentName: 'VPS',
    queueExpiresAt: 5000,
    runId: 'run-1',
  })
  assert.equal(projection.runStatus, 'completed')
  assert.equal(projection.sessionStatus, 'completed')
  assert.deepEqual(projection.tokens, { input: 12, output: 7 })
  assert.equal(projection.terminal, true)
})
