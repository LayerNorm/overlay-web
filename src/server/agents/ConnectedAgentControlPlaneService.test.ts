import 'server-only'

import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalHostRequestProof, MAX_HOST_REQUEST_BYTES } from '@layernorm/overlay-agent-bridge-protocol'
import type { AgentEnvironment, AgentEnvironmentCredential } from '@overlay/workspace-contracts'
import { AuditService } from '@/server/admin'
import type { AuditEventRecord } from '@/server/admin/AuditRepository'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { ConnectedAgentRepository } from './ConnectedAgentRepository'
import {
  ConnectedAgentControlPlaneError,
  ConnectedAgentControlPlaneService,
  effectiveAgentEnvironmentStatus,
} from './ConnectedAgentControlPlaneService'

const NOW = 1_800_000_000_000
const TOKEN = 'test-environment-credential-with-enough-entropy'
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function fixture(overrides: Partial<AgentEnvironment> = {}, credentialOverrides: Partial<AgentEnvironmentCredential> = {}, options: {
  policyLimits?: ConstructorParameters<typeof ConnectedAgentControlPlaneService>[0]['policyLimits']
  enabled?: boolean
} = {}) {
  const environment: AgentEnvironment = {
    id: 'environment-1', workspaceId: 'workspace-1', kind: 'local', name: 'Test host',
    status: 'online', publicKey: publicKeyPem, capabilities: {},
    filesystemGrant: { mode: 'selected_roots', roots: ['/workspace/project'] },
    approvedAt: NOW - 1_000, approvedByUserId: 'user-1', createdAt: NOW - 2_000,
    updatedAt: NOW - 1_000, ...overrides,
  }
  const credential: AgentEnvironmentCredential = {
    id: 'credential-1', workspaceId: environment.workspaceId, environmentId: environment.id,
    tokenHash: sha256(TOKEN), audience: 'overlay-agent-control-plane',
    methods: ['agent:commands:poll', 'agent:events:write'], tokenNonce: 'token-nonce',
    expiresAt: NOW + 60_000, createdAt: NOW - 1_000, ...credentialOverrides,
  }
  const consumed = new Set<string>()
  let enrollmentRedemptions = 0
  const scopeUpdates: Array<Parameters<ConnectedAgentRepository['updateEnvironmentFilesystemGrant']>[0]> = []
  const audits: AuditEventRecord[] = []
  const repository = {
    async findEnvironmentCredential({ tokenHash }: { tokenHash: string }) {
      return tokenHash === credential.tokenHash ? credential : null
    },
    async getEnvironment(args: { workspaceId: string; environmentId: string }) {
      return args.workspaceId === environment.workspaceId && args.environmentId === environment.id
        ? environment
        : null
    },
    async listEnvironments(args: { workspaceId: string }) {
      return args.workspaceId === environment.workspaceId ? [environment] : []
    },
    async revokeEnvironment(args: { workspaceId: string; environmentId: string }) {
      return args.workspaceId === environment.workspaceId && args.environmentId === environment.id
    },
    async redeemEnrollmentSession() {
      enrollmentRedemptions += 1
      throw Error('unexpected enrollment redemption')
    },
    async updateEnvironmentFilesystemGrant(args: Parameters<ConnectedAgentRepository['updateEnvironmentFilesystemGrant']>[0]) {
      if (args.workspaceId !== environment.workspaceId || args.environmentId !== environment.id) return null
      scopeUpdates.push(args)
      environment.filesystemGrant = args.filesystemGrant
      return environment
    },
    async consumeEnvironmentProofNonce(args: { credentialId: string; nonceHash: string; expiredGraceMs?: number }) {
      if (credential.expiresAt <= NOW && NOW - credential.expiresAt >= (args.expiredGraceMs ?? 0)) return false
      if (environment.status === 'revoked' || args.credentialId !== credential.id || consumed.has(args.nonceHash)) return false
      consumed.add(args.nonceHash)
      return true
    },
  } as unknown as ConnectedAgentRepository
  const dependencies = {
    repository,
    audit: new AuditService({ async append(input) {
      const entry = { ...input, id: input.id ?? `audit-${audits.length}`, createdAt: input.createdAt ?? NOW }
      audits.push(entry); return entry
    }, async list() { return audits } }),
    workspaces: {
      async resolveActiveWorkspace() {
        return { workspace: { id: environment.workspaceId }, membership: { role: 'owner' } }
      },
    } as unknown as WorkspaceService,
    now: () => NOW,
    isEnabled: () => options.enabled !== false,
    policyLimits: options.policyLimits,
  }
  const service = new ConnectedAgentControlPlaneService(dependencies)
  return {
    service, environment, repository, credential, scopeUpdates, audits,
    get enrollmentRedemptions() { return enrollmentRedemptions },
  }
}


test('host authentication accepts an exact request once and rejects nonce replay', async () => {
  const { service } = fixture()
  const args = signedRequest({ target: '/api/v1/agent-environments/environment-1/events?waitMs=1000', body: '{"events":[]}' })
  assert.equal((await service.authenticateHostRequest(args)).environment.id, 'environment-1')
  await assertControlPlaneError(() => service.authenticateHostRequest(args), 'proof_replayed')
})

test('host authentication uses an atomic credential/environment snapshot without a second environment read', async () => {
  const f = fixture()
  f.repository.findEnvironmentCredential = async () => ({ ...f.credential, environment: f.environment })
  f.repository.getEnvironment = async () => { throw Error('Unexpected separate environment read') }
  const args = signedRequest({ target: '/api/v1/agent-environments/environment-1/events' })
  assert.equal((await f.service.authenticateHostRequest(args)).environment.id, f.environment.id)
  await assertControlPlaneError(() => f.service.authenticateHostRequest(args), 'proof_replayed')
})

test('an absent, mismatched or revoked environment snapshot cannot fall back to a different read', async () => {
  const valid = fixture().environment
  const snapshots: Array<AgentEnvironment | null> = [null,
    { ...valid, id: 'other-environment' }, { ...valid, workspaceId: 'other-workspace' },
    { ...valid, status: 'revoked' }, { ...valid, approvedAt: undefined }, { ...valid, filesystemGrant: undefined },
  ]
  for (const environment of snapshots) {
    const f = fixture()
    f.repository.findEnvironmentCredential = async () => ({ ...f.credential, environment })
    f.repository.getEnvironment = async () => { throw Error('Snapshot must not fall back') }
    await assertControlPlaneError(() => f.service.authenticateHostRequest(
      signedRequest({ target: '/api/v1/agent-environments/environment-1/events' })), 'environment_unavailable')
  }
})

test('a bundled environment does not bypass credential expiry or device signature verification', async () => {
  const expired = fixture({}, { expiresAt: NOW - 1 })
  expired.repository.findEnvironmentCredential = async () => ({ ...expired.credential, environment: expired.environment })
  await assertControlPlaneError(() => expired.service.authenticateHostRequest(
    signedRequest({ target: '/api/v1/agent-environments/environment-1/events' })), 'credential_invalid')
  const active = fixture()
  active.repository.findEnvironmentCredential = async () => ({ ...active.credential, environment: active.environment })
  const request = signedRequest({ target: '/api/v1/agent-environments/environment-1/events', body: '{}' })
  await assertControlPlaneError(() => active.service.authenticateHostRequest({ ...request, rawBody: new TextEncoder().encode('{"forged":true}') }), 'proof_invalid')
})

test('a Mac that slept past its credential can renew it, and only renew it, for 30 days', async () => {
  const methods = ['agent:commands:poll', 'agent:events:write', 'agent:credentials:refresh'] as const
  const asleep = fixture({}, { expiresAt: NOW - 8 * 60 * 60_000, methods: [...methods] })
  asleep.repository.findEnvironmentCredential = async () => ({ ...asleep.credential, environment: asleep.environment })
  const renew = { ...signedRequest({ target: '/api/v1/agent-environments/environment-1/credentials/refresh' }), requiredMethod: 'agent:credentials:refresh' as const }
  const auth = await asleep.service.authenticateHostRequest(renew)
  assert.equal(auth.credential.id, 'credential-1')
  await assertControlPlaneError(() => asleep.service.authenticateHostRequest(
    signedRequest({ target: '/api/v1/agent-environments/environment-1/events', nonce: 'nonce_nonce_nonce_nonce_02' })), 'credential_invalid')
  const gone = fixture({}, { expiresAt: NOW - 31 * 24 * 60 * 60_000, methods: [...methods] })
  gone.repository.findEnvironmentCredential = async () => ({ ...gone.credential, environment: gone.environment })
  await assertControlPlaneError(() => gone.service.authenticateHostRequest(renew), 'credential_invalid')
})

test('host authentication rejects query tampering and forged event bodies', async () => {
  const { service } = fixture()
  const signed = signedRequest({ target: '/api/v1/agent-environments/environment-1/events?limit=1', body: '{"events":[]}' })
  const queryTampered = {
    ...signed,
    request: new Request('https://overlay.example/api/v1/agent-environments/environment-1/events?limit=50', signed.request),
  }
  await assertControlPlaneError(() => service.authenticateHostRequest(queryTampered), 'proof_invalid')

  const forgedBody = { ...signed, rawBody: new TextEncoder().encode('{"events":[{"forged":true}]}') }
  await assertControlPlaneError(() => service.authenticateHostRequest(forgedBody), 'proof_invalid')
})

test('host authentication rejects cross-environment use, revoked hosts, and oversized requests', async () => {
  const active = fixture()
  await assertControlPlaneError(
    () => active.service.authenticateHostRequest(signedRequest({ target: '/api/v1/agent-environments/environment-2/events', environmentId: 'environment-2' })),
    'credential_invalid',
  )

  const revoked = fixture({ status: 'revoked', revokedAt: NOW - 1 })
  await assertControlPlaneError(
    () => revoked.service.authenticateHostRequest(signedRequest({ target: '/api/v1/agent-environments/environment-1/events' })),
    'environment_unavailable',
  )

  const oversized = signedRequest({ target: '/api/v1/agent-environments/environment-1/events' })
  oversized.rawBody = new Uint8Array(MAX_HOST_REQUEST_BYTES + 1)
  await assertControlPlaneError(() => active.service.authenticateHostRequest(oversized), 'request_too_large')
})

test('retired Cloud credentials cannot refresh', async () => {
  const cloud = fixture({ kind: 'overlay_cloud' })
  await assertControlPlaneError(
    () => cloud.service.refreshCredential({ credential: cloud.credential, environment: cloud.environment }),
    'hosted_runtime_retired',
  )
})

test('environment health expires when its heartbeat is stale', () => {
  assert.equal(effectiveAgentEnvironmentStatus({ status: 'online', lastSeenAt: NOW - 44_999 }, NOW), 'online')
  assert.equal(effectiveAgentEnvironmentStatus({ status: 'online', lastSeenAt: NOW - 45_001 }, NOW), 'offline')
  assert.equal(effectiveAgentEnvironmentStatus({ status: 'offline', lastSeenAt: NOW }, NOW), 'offline')
  assert.equal(effectiveAgentEnvironmentStatus({ status: 'pending' }, NOW), 'pending')
})

test('connecting a machine follows the Computers feature and refuses before any repository write', async () => {
  const disabled = fixture({}, {}, { enabled: false })
  await assert.rejects(disabled.service.createEnrollmentSession({ actorUserId: 'user-1', workspaceId: 'workspace-1' }),
    (error: unknown) => error instanceof ConnectedAgentControlPlaneError && error.code === 'feature_disabled')
  await assert.rejects(disabled.service.redeemEnrollment({
    code: 'single-use-enrollment-code-1234', name: 'Mac', publicKey: publicKeyPem, hostVersion: '0.5.0', platform: 'darwin',
    capabilities: { protocolVersion: 1, hostVersion: '0.5.0', platform: 'darwin', filesystem: { mode: 'all_user_files' },
      localTools: { version: 1, os: 'darwin', features: ['exec'], homeDirectory: '/Users/me' } },
    kind: 'local',
  }), (error: unknown) => error instanceof ConnectedAgentControlPlaneError && error.code === 'feature_disabled')
  assert.equal(disabled.enrollmentRedemptions, 0)
})

function signedRequest(args: {
  target: string
  body?: string
  environmentId?: string
  nonce?: string
}) {
  const body = args.body ?? ''
  const target = args.target
  const nonce = args.nonce ?? 'nonce_nonce_nonce_nonce_01'
  const timestamp = String(NOW)
  const canonical = canonicalHostRequestProof({
    method: 'POST', pathname: target, timestamp, nonce,
    bodySha256: sha256(body), tokenSha256: sha256(TOKEN),
  })
  const request = new Request(`https://overlay.example${target}`, {
    method: 'POST', body: body || undefined,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-overlay-agent-timestamp': timestamp,
      'x-overlay-agent-nonce': nonce,
      'x-overlay-agent-signature': sign(null, Buffer.from(canonical), privateKey).toString('base64url'),
    },
  })
  return {
    request,
    environmentId: args.environmentId ?? 'environment-1',
    requiredMethod: 'agent:events:write' as const,
    rawBody: new TextEncoder().encode(body),
  }
}

async function assertControlPlaneError(operation: () => Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) =>
    error instanceof ConnectedAgentControlPlaneError && error.code === code)
}

function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}
