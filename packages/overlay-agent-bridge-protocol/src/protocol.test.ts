import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalEnrollmentProof,
  canonicalHostRequestProof,
  enrollmentRequestSchema,
  environmentCredentialResponseSchema,
  filesystemGrantSchema,
  hostCapabilitiesSchema,
  localToolCallSchema,
  localToolResultSchema,
  OVERLAY_AGENT_PROTOCOL_VERSION,
} from './index'

const localTools = { version: 1, os: 'darwin', features: ['exec', 'files', 'screenshot'], homeDirectory: '/Users/dev' }
const capabilities = {
  protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, localTools, hostVersion: '0.5.0', platform: 'darwin 25.0.0',
  filesystem: { mode: 'all_user_files' },
}

test('a host advertises only local tools; harness adapters are not part of the contract', () => {
  assert.equal(hostCapabilitiesSchema.safeParse(capabilities).success, true)
  assert.equal(hostCapabilitiesSchema.safeParse({ ...capabilities, adapters: [] }).success, false)
  assert.equal(hostCapabilitiesSchema.safeParse({ ...capabilities, localTools: undefined }).success, false)
  assert.equal(enrollmentRequestSchema.safeParse({
    code: 'single-use-enrollment-code-1234', name: 'Dev MacBook', publicKey: 'k'.repeat(64), hostVersion: '0.5.0',
    platform: 'darwin', capabilities,
  }).success, true)
})

test('filesystem grants are explicit and credentials carry only host scopes', () => {
  assert.equal(filesystemGrantSchema.safeParse({ mode: 'selected_roots', roots: [] }).success, false)
  const credential = {
    protocolVersion: 1, workspaceId: 'w', environmentId: 'e', audience: 'overlay-agent-control-plane',
    token: 't'.repeat(32), expiresAt: 1, filesystemGrant: { mode: 'all_user_files' },
  }
  assert.equal(environmentCredentialResponseSchema.safeParse({ ...credential, methods: ['agent:commands:poll', 'agent:events:write'] }).success, true)
  assert.equal(environmentCredentialResponseSchema.safeParse({ ...credential, methods: ['agent:drive-credentials'] }).success, false)
})

test('local tool calls and results are bounded, typed and strict', () => {
  const call = { protocolVersion: 1, callId: 'c', environmentId: 'e', workspaceId: 'w', issuedAt: 1, deadlineAt: 2,
    request: { kind: 'exec', command: 'ls', timeoutMs: 5_000 } }
  assert.equal(localToolCallSchema.safeParse(call).success, true)
  assert.equal(localToolCallSchema.safeParse({ ...call, request: { kind: 'exec', command: 'ls', timeoutMs: 900_000 } }).success, false)
  assert.equal(localToolCallSchema.safeParse({ ...call, request: { kind: 'driver', command: 'rm', args: {} } }).success, false)
  assert.equal(localToolResultSchema.safeParse({ protocolVersion: 1, callId: 'c', outcome: { ok: false, error: { code: 'x', message: 'y' } } }).success, true)
})

test('signed proofs bind every request field', () => {
  assert.equal(canonicalEnrollmentProof('e', 'c'), 'overlay-agent-enrollment-v1\ne\nc')
  assert.equal(canonicalHostRequestProof({ method: 'get', pathname: '/p?x=1', timestamp: '1', nonce: 'n', bodySha256: 'b', tokenSha256: 't' }),
    'overlay-agent-request-v1\nGET\n/p?x=1\n1\nn\nb\nt')
})
