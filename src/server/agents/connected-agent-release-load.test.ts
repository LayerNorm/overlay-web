import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import {
  commandPollResponseSchema,
  eventBatchSchema,
  OVERLAY_AGENT_PROTOCOL_VERSION,
} from '@layernorm/overlay-agent-bridge-protocol'
import { resolveMentionFirstInvocations } from './mention-policy'

const MAX_REHEARSAL_MS = 30_000

test('release load rehearsal validates command polling and event ingestion at bounded batch limits', () => {
  const startedAt = performance.now()
  let commands = 0
  let events = 0

  for (let batchIndex = 0; batchIndex < 200; batchIndex += 1) {
    const parsedCommands = commandPollResponseSchema.parse({
      protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
      commands: Array.from({ length: 50 }, (_, index) => ({
        protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
        commandId: `command-${batchIndex}-${index}`,
        environmentId: `environment-${batchIndex}`,
        workspaceId: 'workspace-load',
        runId: `run-${batchIndex}-${index}`,
        sequence: index + 1,
        issuedAt: 1,
        type: 'cancel' as const,
        payload: { reason: 'load rehearsal' },
      })),
    })
    commands += parsedCommands.commands.length

    const runId = `event-run-${batchIndex}`
    const environmentId = `event-environment-${batchIndex}`
    const parsedEvents = eventBatchSchema.parse({
      protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
      environmentId,
      runId,
      events: Array.from({ length: 100 }, (_, index) => ({
        protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
        eventId: `event-${batchIndex}-${index}`,
        environmentId,
        runId,
        sourceSequence: index + 1,
        occurredAt: 1,
        type: 'text_checkpoint' as const,
        payload: { text: `checkpoint ${index}` },
      })),
    })
    events += parsedEvents.events.length
  }

  const elapsedMs = performance.now() - startedAt
  assert.equal(commands, 10_000)
  assert.equal(events, 20_000)
  assert.ok(elapsedMs < MAX_REHEARSAL_MS, `protocol load rehearsal took ${elapsedMs.toFixed(0)}ms`)
})

test('release load rehearsal keeps room fan-out mention-scoped during a reconnect-sized burst', () => {
  const participants = [
    { principalId: 'human-1', principalType: 'human' as const },
    ...Array.from({ length: 100 }, (_, index) => ({
      principalId: `agent-${index}`,
      principalType: 'agent' as const,
    })),
  ]
  const mentionedPrincipalIds = ['agent-1', 'agent-3', 'agent-5', 'agent-7', 'agent-9']
  const startedAt = performance.now()
  let fanOut = 0

  for (let message = 0; message < 20_000; message += 1) {
    const resolved = resolveMentionFirstInvocations({
      authorKind: 'human',
      conversationType: 'channel',
      participants,
      mentionedPrincipalIds,
    })
    assert.deepEqual(resolved, mentionedPrincipalIds)
    fanOut += resolved.length
  }

  const elapsedMs = performance.now() - startedAt
  assert.equal(fanOut, 100_000)
  assert.ok(elapsedMs < MAX_REHEARSAL_MS, `room fan-out load rehearsal took ${elapsedMs.toFixed(0)}ms`)
})
