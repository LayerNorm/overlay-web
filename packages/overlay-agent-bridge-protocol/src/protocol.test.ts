import assert from 'node:assert/strict'
import test from 'node:test'
import { agentHostCommandSchema, agentHostEventSchema, canonicalEnrollmentProof, canonicalHostRequestProof, enrollmentRequestSchema, eventBatchSchema, filesystemGrantSchema, OVERLAY_AGENT_PROTOCOL_VERSION } from './index'
import { providerCredentialsRequestSchema, driveCredentialsRequestSchema, driveCredentialsResponseSchema, driveSyncStatusSchema, driveStartDescriptorSchema, startAdapterPayloadSchema, recoveryCapabilitiesSchema } from './index'

test('fenced native restoration requires its original session and a complete stopped-provider receipt', () => {
  const base = {bindingId: 'binding', adapterId: 'claude-code', workingDirectory: '/home/user/drive', prompt: 'Continue', metadata: {}}
  const restore = {previousExecution: {attemptId: 'previous', generation: 1, hostBootId: 'old-boot'},
    providerStop: {provider: 'box', leaseId: 'original-lease', providerReference: 'original-machine', observedAt: 1000}}
  const valid = {...base, sessionId: 'original-native-session', restore}
  assert.equal(startAdapterPayloadSchema.safeParse(base).success, true)
  assert.equal(startAdapterPayloadSchema.safeParse(valid).success, true)
  for (const input of [{...valid, fresh: true}, {...base, restore},
    {...valid, restore: {...restore, previousExecution: {attemptId: 'previous', generation: 0}}},
    {...valid, restore: {...restore, providerStop: {...restore.providerStop, provider: 'e2b'}}},
    {...valid, restore: {...restore, providerStop: undefined}}]) {
    assert.equal(startAdapterPayloadSchema.safeParse(input).success, false)
  }
})

test('fenced loading is negotiated independently of live interrupted-turn reattachment', () => {
  const legacy = {liveReattachment: true, sessionLoading: true, interruptedTurnContinuation: false,
    approvalRestoration: false, providerCheckpoints: false}
  assert.equal(recoveryCapabilitiesSchema.parse(legacy).fencedSessionRestoration, undefined)
  const fenced = recoveryCapabilitiesSchema.parse({...legacy, fencedSessionRestoration: true})
  assert.equal(fenced.fencedSessionRestoration, true)
  assert.equal(fenced.interruptedTurnContinuation, false)
})

test('drive start descriptors carry no host-selected scope and save summaries are bounded and consistent', () => {
  assert.equal(driveStartDescriptorSchema.safeParse({ version: 1, sessionId: 'session', location: 'cloud' }).success, true)
  assert.equal(driveStartDescriptorSchema.safeParse({ version: 1, sessionId: 'session', location: 'cloud', scope: { kind: 'workspace', workspaceId: 'foreign' } }).success, false)
  const entry = { fileId: 'file', path: 'Research/report.md', kind: 'file' }
  const status = { state: 'saved', fileCount: 1, folderCount: 0, entries: [entry] }
  assert.equal(driveSyncStatusSchema.safeParse(status).success, true)
  for (const patch of [{ fileCount: 0 }, { entries: [entry, entry] }, { entries: [{ ...entry, path: '../secret' }] },
    { entries: Array.from({ length: 33 }, (_, i) => ({ ...entry, fileId: `f${i}`, path: `f${i}.md` })) }])
    assert.equal(driveSyncStatusSchema.safeParse({ ...status, ...patch }).success, false)
})

test('drive credential wire requests bind exact execution and reject host-selected authority', () => {
  const request = { protocolVersion: 1, runId: 'run', sessionId: 'session', execution: { attemptId: 'attempt', generation: 1 } }
  assert.deepEqual(driveCredentialsRequestSchema.parse(request), request)
  for (const patch of [{ actorUserId: 'other' }, { workspaceId: 'other' }, { scope: { kind: 'workspace', workspaceId: 'other' } },
    { execution: { attemptId: 'attempt', generation: 0 } }, { execution: { attemptId: 'attempt', generation: 1, hostBootId: 'not-part-of-grant' } }]) {
    assert.equal(driveCredentialsRequestSchema.safeParse({ ...request, ...patch }).success, false)
  }
  const response = { protocolVersion: 1, token: 'ovdrive_' + 'a'.repeat(32) + '.' + 'b'.repeat(43), expiresAt: 1000,
    scope: { kind: 'workspace', workspaceId: 'workspace' } }
  assert.deepEqual(driveCredentialsResponseSchema.parse(response), response)
  assert.equal(driveCredentialsResponseSchema.safeParse({ ...response, storageKey: 'secret' }).success, false)
})

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


test('provider credential requests distinguish active runs from bound-adapter discovery without accepting caller-selected accounts', () => {
  for (const input of [{protocolVersion: 1, runId: 'run'}, {protocolVersion: 1, adapterId: 'codex'}])
    assert.deepEqual(providerCredentialsRequestSchema.parse(input), input)
  for (const input of [
    {protocolVersion: 1}, {protocolVersion: 1, runId: 'run', adapterId: 'codex'},
    {protocolVersion: 1, adapterId: 'codex', accountId: 'other-account'},
    {protocolVersion: 1, adapterId: 'codex', ownerUserId: 'other-owner'},
  ]) assert.equal(providerCredentialsRequestSchema.safeParse(input).success, false)
})
