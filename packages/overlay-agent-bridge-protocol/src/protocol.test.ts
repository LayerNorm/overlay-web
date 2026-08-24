import assert from 'node:assert/strict'
import test from 'node:test'
import { agentHostCommandSchema, eventBatchSchema, filesystemGrantSchema, OVERLAY_AGENT_PROTOCOL_VERSION } from './index'

test('filesystem grants require explicit roots or explicit all-user access', () => {
  assert.equal(filesystemGrantSchema.safeParse({ mode: 'selected_roots', roots: [] }).success, false)
  assert.equal(filesystemGrantSchema.safeParse({ mode: 'selected_roots', roots: ['/repo', '/data'] }).success, true)
  assert.equal(filesystemGrantSchema.safeParse({ mode: 'all_user_files' }).success, true)
})

test('commands reject unknown protocol versions', () => {
  const result = agentHostCommandSchema.safeParse({
    protocolVersion: 2, commandId: 'c1', environmentId: 'e1', workspaceId: 'w1', runId: 'r1',
    sequence: 1, issuedAt: 1, type: 'cancel', payload: {},
  })
  assert.equal(result.success, false)
})

test('event batches reject gaps and cross-run substitution', () => {
  const base = { protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, environmentId: 'e1', runId: 'r1', occurredAt: 1, type: 'text_checkpoint' as const }
  assert.equal(eventBatchSchema.safeParse({
    protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
    environmentId: 'e1', runId: 'r1',
    events: [
      { ...base, eventId: 'a', sourceSequence: 1, payload: { text: 'a' } },
      { ...base, eventId: 'b', sourceSequence: 3, payload: { text: 'b' } },
    ],
  }).success, false)
  assert.equal(eventBatchSchema.safeParse({
    protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
    environmentId: 'e1', runId: 'r1',
    events: [{ ...base, eventId: 'a', runId: 'other', sourceSequence: 1, payload: { text: 'a' } }],
  }).success, false)
})
