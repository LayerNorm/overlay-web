import assert from 'node:assert/strict'
import test from 'node:test'
import { agentHostCommandSchema, agentHostEventSchema, canonicalEnrollmentProof, canonicalHostRequestProof, enrollmentRequestSchema, eventBatchSchema, filesystemGrantSchema, OVERLAY_AGENT_PROTOCOL_VERSION } from './index'

test('filesystem grants require explicit roots or explicit all-user access', () => {
  assert.equal(filesystemGrantSchema.safeParse({ mode: 'selected_roots', roots: [] }).success, false)
  assert.equal(filesystemGrantSchema.safeParse({ mode: 'selected_roots', roots: ['/repo', '/data'] }).success, true)
  assert.equal(filesystemGrantSchema.safeParse({ mode: 'all_user_files' }).success, true)
})

test('managed hosts enroll through the same strict protocol as user-owned hosts', () => {
  assert.equal(enrollmentRequestSchema.parse({
    code: 'a'.repeat(32), kind: 'overlay_cloud', name: 'Overlay Cloud', publicKey: 'a'.repeat(64),
    hostVersion: '0.0.1', platform: 'linux',
    capabilities: {
      protocolVersion: 1, hostVersion: '0.0.1', platform: 'linux', adapters: [],
      filesystem: { mode: 'selected_roots', roots: ['/workspace'] }, maxConcurrentRuns: 1,
    },
  }).kind, 'overlay_cloud')
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

test('commands_update events validate advertised agent commands', () => {
  const base = { protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, environmentId: 'e1', runId: 'r1', occurredAt: 1, type: 'commands_update' as const }
  assert.equal(agentHostEventSchema.safeParse({
    ...base, eventId: 'cmd-1', sourceSequence: 1,
    payload: { commands: [{ name: 'compact', description: 'Compact the session', inputHint: 'instructions' }, { name: 'review' }] },
  }).success, true)
  assert.equal(agentHostEventSchema.safeParse({
    ...base, eventId: 'cmd-2', sourceSequence: 1, payload: { commands: [{ name: '' }] },
  }).success, false)
  assert.equal(agentHostEventSchema.safeParse({
    ...base, eventId: 'cmd-3', sourceSequence: 1,
    payload: { commands: Array.from({ length: 101 }, (_, index) => ({ name: `cmd-${index}` })) },
  }).success, false)
})

test('proof canonicalization binds every security-relevant request field', () => {
  assert.equal(canonicalEnrollmentProof('environment-1', 'challenge-1'), 'overlay-agent-enrollment-v1\nenvironment-1\nchallenge-1')
  const baseline = canonicalHostRequestProof({
    method: 'POST', pathname: '/api/v1/agent-environments/e1/events', timestamp: '1800000000000',
    nonce: 'request-nonce', bodySha256: 'body-hash', tokenSha256: 'token-hash',
  })
  assert.notEqual(baseline, canonicalHostRequestProof({
    method: 'POST', pathname: '/api/v1/agent-environments/e2/events', timestamp: '1800000000000',
    nonce: 'request-nonce', bodySha256: 'body-hash', tokenSha256: 'token-hash',
  }))
  assert.notEqual(baseline, canonicalHostRequestProof({
    method: 'POST', pathname: '/api/v1/agent-environments/e1/events', timestamp: '1800000000000',
    nonce: 'request-nonce', bodySha256: 'forged-body', tokenSha256: 'token-hash',
  }))
})
