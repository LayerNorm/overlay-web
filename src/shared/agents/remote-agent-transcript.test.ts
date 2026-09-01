import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentRemoteEvent } from '@overlay/workspace-contracts'
import { projectRemoteAgentEvents, resolveRemoteRequestPart, waitingRemoteAgentParts } from './remote-agent-transcript'

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

test('terminal run events resolve remote actions and attached terminals left running by a harness', () => {
  const projection = projectRemoteAgentEvents({
    content: 'Done',
    parts: [
      { type: 'text', text: 'Done' },
      { type: 'tool-invocation', toolInvocation: {
        toolCallId: 'shell-1', toolName: 'remote_action', state: 'input-available',
        toolInput: { title: 'Read repository metadata' },
      } },
      { type: 'data-remote-agent-terminal', data: {
        key: 'terminal-1', terminalId: 'terminal-1', title: 'Remote terminal',
        summary: 'Terminal is attached to this action.', status: 'running',
      } },
    ],
    events: [event(1, 'completed', { summary: 'Done', usage: {} })],
    environmentName: 'MacBook',
    queueExpiresAt: 5_000,
    runId: 'run-1',
  })

  const action = projection.parts.find((part) => part.type === 'tool-invocation')
    ?.toolInvocation as Record<string, unknown>
  const terminal = projection.parts.find((part) => part.type === 'data-remote-agent-terminal')
    ?.data as Record<string, unknown>
  assert.equal(action.state, 'output-available')
  assert.deepEqual(action.toolOutput, {
    success: true, status: 'completed', title: 'Read repository metadata', resolvedAt: 1,
  })
  assert.equal(terminal.status, 'completed')
  assert.equal(terminal.resolution, 'completed')
  assert.equal(terminal.resolvedAt, 1)
})

for (const terminalEvent of ['failed', 'cancelled'] as const) {
  test(`${terminalEvent} run resolves remote actions and attached terminals without implying success`, () => {
    const projection = projectRemoteAgentEvents({
      content: 'Partial result',
      parts: [
        { type: 'tool-invocation', toolInvocation: {
          toolCallId: 'shell-1', toolName: 'remote_action', state: 'input-available',
          toolInput: { title: 'Run command' },
        } },
        { type: 'data-remote-agent-terminal', data: {
          key: 'terminal-1', terminalId: 'terminal-1', title: 'Remote terminal',
          summary: 'Terminal is attached to this action.', status: 'running',
        } },
      ],
      events: [event(1, terminalEvent, terminalEvent === 'failed'
        ? { code: 'command_failed', message: 'Command failed', retryable: false }
        : { reason: 'Cancelled by user' })],
      environmentName: 'MacBook',
      queueExpiresAt: 5_000,
      runId: 'run-1',
    })

    const action = projection.parts.find((part) => part.type === 'tool-invocation')
      ?.toolInvocation as Record<string, unknown>
    const terminal = projection.parts.find((part) => part.type === 'data-remote-agent-terminal')
      ?.data as Record<string, unknown>
    assert.equal(action.state, 'output-error')
    assert.equal((action.toolOutput as Record<string, unknown>).status, terminalEvent)
    assert.equal(terminal.status, 'failed')
    assert.equal(terminal.resolution, terminalEvent)
  })
}

test('supervised events persist request, plan, diff, terminal, and artifact parts', () => {
  const projection = projectRemoteAgentEvents({
    content: '',
    parts: [],
    events: [
      event(1, 'elicitation_requested', { requestKey: 'request-1', prompt: 'Choose a branch',
        requestedSchema: { type: 'object', properties: { branch: { type: 'string' } }, required: ['branch'] } }),
      event(2, 'plan', { entries: [{ id: 'step-1', title: 'Inspect', status: 'completed' }] }),
      event(3, 'diff', { diffId: 'diff-1', title: 'app.ts', patch: '+const ready = true' }),
      event(4, 'terminal', { terminalId: 'terminal-1', title: 'Tests', summary: 'All tests passed', status: 'completed', exitCode: 0 }),
      event(5, 'artifact', { name: 'report.txt', mediaType: 'text/plain', size: 6,
        sha256: 'a'.repeat(64), uploadReference: 'artifact-1', url: '/api/v1/artifact-1' }),
    ],
    environmentName: 'MacBook', queueExpiresAt: 5_000, runId: 'run-1',
  })
  assert.equal(projection.runStatus, 'waiting_for_approval')
  assert.equal(projection.sessionStatus, 'waiting_for_input')
  for (const type of ['data-remote-agent-request', 'data-remote-agent-plan', 'data-remote-agent-diff', 'data-remote-agent-terminal', 'file']) {
    assert.ok(projection.parts.some((part) => part.type === type), `${type} should persist`)
  }
  const resolved = resolveRemoteRequestPart(projection.parts, 'request-1', {
    decision: 'accept', resolvedByPrincipalId: 'principal-1', resolvedAt: 10,
  })
  const request = resolved.find((part) => part.type === 'data-remote-agent-request')?.data as Record<string, unknown>
  assert.equal(request.state, 'resolved')
})

test('commands_update persists one replaceable advertised-commands part', () => {
  const projection = projectRemoteAgentEvents({
    content: '',
    parts: [],
    events: [
      event(1, 'session_started', { remoteSessionId: 'hermes-session', adapterId: 'hermes' }),
      event(2, 'commands_update', { commands: [
        { name: 'compact', description: 'Compact the session', inputHint: 'instructions' },
        { name: 'review' },
      ] }),
      event(3, 'commands_update', { commands: [{ name: 'compact', description: 'Updated description' }] }),
    ],
    environmentName: 'MacBook', queueExpiresAt: 5_000, runId: 'run-1',
  })
  const commandParts = projection.parts.filter((part) => part.type === 'data-remote-agent-commands')
  assert.equal(commandParts.length, 1)
  const data = commandParts[0]!.data as Record<string, unknown>
  const commands = data.commands as Array<Record<string, unknown>>
  assert.equal(commands.length, 1)
  assert.equal(commands[0]!.name, 'compact')
  assert.equal(commands[0]!.description, 'Updated description')
})

test('retryable failure becomes a recoverable transcript without losing completed work', () => {
  const projection = projectRemoteAgentEvents({
    content: 'Partial result', parts: [{ type: 'text', text: 'Partial result' }],
    events: [event(1, 'failed', { code: 'host_offline', message: 'Host disappeared', retryable: true })],
    environmentName: 'VPS', queueExpiresAt: 5_000, runId: 'run-1',
  })
  assert.equal(projection.content, 'Partial result')
  assert.equal(projection.runStatus, 'failed')
  const status = projection.parts.find((part) => part.type === 'data-remote-agent-status')?.data as Record<string, unknown>
  assert.deepEqual({ state: status.state, retryable: status.retryable, retryClass: status.retryClass },
    { state: 'recoverable', retryable: true, retryClass: 'host_offline' })
})
