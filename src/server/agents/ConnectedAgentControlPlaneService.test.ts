import 'server-only'

import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalHostRequestProof, MAX_HOST_REQUEST_BYTES } from '@layernorm/overlay-agent-bridge-protocol'
import type { ObjectStore } from '@overlay/app-core'
import type { AgentArtifact, AgentEnvironment, AgentEnvironmentCredential, AgentRemoteSession } from '@overlay/workspace-contracts'
import type { AuditService } from '@/server/admin'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { ConnectedAgentRepository } from './ConnectedAgentRepository'
import {
  ConnectedAgentControlPlaneError,
  ConnectedAgentControlPlaneService,
  effectiveAgentEnvironmentStatus,
  type HostAuthentication,
} from './ConnectedAgentControlPlaneService'

const NOW = 1_800_000_000_000
const TOKEN = 'test-environment-credential-with-enough-entropy'
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function fixture(overrides: Partial<AgentEnvironment> = {}) {
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
    expiresAt: NOW + 60_000, createdAt: NOW - 1_000,
  }
  const consumed = new Set<string>()
  const repository = {
    async findEnvironmentCredential({ tokenHash }: { tokenHash: string }) {
      return tokenHash === credential.tokenHash ? credential : null
    },
    async getEnvironment(args: { workspaceId: string; environmentId: string }) {
      return args.workspaceId === environment.workspaceId && args.environmentId === environment.id
        ? environment
        : null
    },
    async consumeEnvironmentProofNonce(args: { credentialId: string; nonceHash: string }) {
      if (environment.status === 'revoked' || args.credentialId !== credential.id || consumed.has(args.nonceHash)) return false
      consumed.add(args.nonceHash)
      return true
    },
  } as unknown as ConnectedAgentRepository
  const service = new ConnectedAgentControlPlaneService({
    repository,
    audit: {} as AuditService,
    workspaces: {} as WorkspaceService,
    now: () => NOW,
    isEnabled: () => true,
  })
  return { service, environment }
}

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

test('host authentication accepts an exact request once and rejects nonce replay', async () => {
  const { service } = fixture()
  const args = signedRequest({ target: '/api/v1/agent-environments/environment-1/events?waitMs=1000', body: '{"events":[]}' })
  assert.equal((await service.authenticateHostRequest(args)).environment.id, 'environment-1')
  await assertControlPlaneError(() => service.authenticateHostRequest(args), 'proof_replayed')
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

test('working directories must stay within an explicitly approved project root', () => {
  const { service, environment } = fixture()
  assert.doesNotThrow(() => service.assertWorkingDirectory(environment, '/workspace/project/packages/app'))
  assert.throws(
    () => service.assertWorkingDirectory(environment, '/workspace/project-other'),
    (error: unknown) => error instanceof ConnectedAgentControlPlaneError && error.code === 'filesystem_scope_denied',
  )
  assert.throws(
    () => service.assertWorkingDirectory(environment, '/etc'),
    (error: unknown) => error instanceof ConnectedAgentControlPlaneError && error.code === 'filesystem_scope_denied',
  )
})

test('environment health expires when its heartbeat is stale', () => {
  assert.equal(effectiveAgentEnvironmentStatus({ status: 'online', lastSeenAt: NOW - 44_999 }, NOW), 'online')
  assert.equal(effectiveAgentEnvironmentStatus({ status: 'online', lastSeenAt: NOW - 45_001 }, NOW), 'offline')
  assert.equal(effectiveAgentEnvironmentStatus({ status: 'offline', lastSeenAt: NOW }, NOW), 'offline')
  assert.equal(effectiveAgentEnvironmentStatus({ status: 'pending' }, NOW), 'pending')
})

test('artifact intents are scoped and clean bytes become downloadable only after validation', async () => {
  const bytes = new TextEncoder().encode('safe report')
  const setup = artifactFixture(bytes)
  const upload = await setup.service.createArtifactUpload(setup.auth, {
    protocolVersion: 1, runId: setup.session.runId, name: 'report.txt', mediaType: 'text/plain',
    size: bytes.byteLength, sha256: sha256(bytes),
  })
  assert.match(upload.uploadUrl, /^https:\/\/uploads\.example\//)
  assert.equal(setup.constraints?.contentLength, bytes.byteLength)
  assert.equal(setup.constraints?.expiresIn, 300)
  const completed = await setup.service.completeArtifactUpload(setup.auth, upload.uploadReference)
  assert.equal(completed.status, 'clean')
  assert.equal(completed.scanResult, 'signature_scan_clean')
  const download = await setup.service.getArtifactDownload({
    actorUserId: 'user-1', workspaceId: setup.auth.credential.workspaceId, artifactId: upload.artifactId,
  })
  assert.match(download.url, /^https:\/\/downloads\.example\//)
})

test('artifact upload and download fail closed unless the artifact feature is explicitly enabled', async () => {
  const bytes = new TextEncoder().encode('safe report')
  const setup = artifactFixture(bytes, false)
  await assertControlPlaneError(() => setup.service.createArtifactUpload(setup.auth, {
    protocolVersion: 1, runId: setup.session.runId, name: 'report.txt', mediaType: 'text/plain',
    size: bytes.byteLength, sha256: sha256(bytes),
  }), 'agent_artifacts_disabled')
  await assertControlPlaneError(() => setup.service.getArtifactDownload({
    actorUserId: 'user-1', workspaceId: setup.auth.credential.workspaceId, artifactId: 'missing',
  }), 'agent_artifacts_disabled')
})

test('artifact checksum and malware failures are rejected and deleted', async () => {
  for (const [bytes, declared, expectedCode] of [
    [new TextEncoder().encode('different bytes'), sha256('declared bytes'), 'artifact_checksum_mismatch'],
    [new TextEncoder().encode('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'), undefined, 'artifact_malware_rejected'],
  ] as const) {
    const setup = artifactFixture(bytes)
    const upload = await setup.service.createArtifactUpload(setup.auth, {
      protocolVersion: 1, runId: setup.session.runId, name: 'scan.txt', mediaType: 'text/plain',
      size: bytes.byteLength, sha256: declared ?? sha256(bytes),
    })
    await assertControlPlaneError(
      () => setup.service.completeArtifactUpload(setup.auth, upload.uploadReference), expectedCode,
    )
    assert.equal(setup.artifacts.get(upload.artifactId)?.status, 'rejected')
    assert.equal(setup.deletedKeys.length, 1)
  }
})

test('artifact retention cleanup removes expired objects and tombstones metadata', async () => {
  const setup = artifactFixture(new TextEncoder().encode('expired'))
  const artifact = artifactRecord('artifact-expired', setup.auth, setup.session, { expiresAt: NOW - 1, status: 'linked' })
  setup.artifacts.set(artifact.id, artifact)
  assert.deepEqual(await setup.service.cleanupArtifacts(), { deleted: 1 })
  assert.equal(setup.artifacts.get(artifact.id)?.status, 'deleted')
  assert.deepEqual(setup.deletedKeys, [artifact.objectKey])
})

test('artifact retention cleanup drains multiple bounded batches without touching live artifacts', async () => {
  const setup = artifactFixture(new TextEncoder().encode('retention soak'))
  const expiredCount = 257
  for (let index = 0; index < expiredCount; index += 1) {
    const artifact = artifactRecord(`artifact-expired-${index}`, setup.auth, setup.session, {
      expiresAt: NOW - index - 1,
      status: 'linked',
    })
    setup.artifacts.set(artifact.id, artifact)
  }
  for (let index = 0; index < 3; index += 1) {
    const artifact = artifactRecord(`artifact-live-${index}`, setup.auth, setup.session, {
      expiresAt: NOW + 60_000 + index,
      status: 'linked',
    })
    setup.artifacts.set(artifact.id, artifact)
  }

  const batches: number[] = []
  for (;;) {
    const result = await setup.service.cleanupArtifacts(100)
    batches.push(result.deleted)
    if (result.deleted === 0) break
  }

  assert.deepEqual(batches, [100, 100, 57, 0])
  assert.equal(new Set(setup.deletedKeys).size, expiredCount)
  assert.equal(setup.deletedKeys.length, expiredCount)
  assert.equal([...setup.artifacts.values()].filter((artifact) => artifact.status === 'deleted').length, expiredCount)
  assert.equal([...setup.artifacts.values()].filter((artifact) => artifact.status === 'linked').length, 3)
  assert.deepEqual(await setup.service.cleanupArtifacts(100), { deleted: 0 })
})

test('reset clears harness sessions and destroys the provider sandbox', async () => {
  const setup = harnessEnvironmentFixture()
  const result = await setup.service.resetHarnessEnvironment({
    actorUserId: 'user-1', workspaceId: 'workspace-1', environmentId: 'environment-harness',
  })
  assert.equal(result.reset, true)
  assert.equal(result.sessionsCleared, 2)
  assert.equal(result.sandboxDestroyed, true)
  assert.deepEqual(setup.clearedBindingIds, ['binding-1', 'binding-2'])
  assert.equal(setup.deletedReferences[0], 'sandbox-ref-1')
})

test('reset rejects non-harness environments and unknown ids', async () => {
  const setup = harnessEnvironmentFixture()
  await assertControlPlaneError(
    () => setup.service.resetHarnessEnvironment({
      actorUserId: 'user-1', workspaceId: 'workspace-1', environmentId: 'environment-local',
    }),
    'not_a_harness_environment',
  )
  await assertControlPlaneError(
    () => setup.service.resetHarnessEnvironment({
      actorUserId: 'user-1', workspaceId: 'workspace-1', environmentId: 'missing',
    }),
    'environment_not_found',
  )
})

test('reset succeeds even when the provider sandbox is already gone', async () => {
  const setup = harnessEnvironmentFixture({ reconnectFails: true })
  const result = await setup.service.resetHarnessEnvironment({
    actorUserId: 'user-1', workspaceId: 'workspace-1', environmentId: 'environment-harness',
  })
  assert.equal(result.reset, true)
  assert.equal(result.sandboxDestroyed, false)
  assert.equal(result.sessionsCleared, 2)
})

test('harness bindings stamp Overlay-funded model billing and the picked model', async () => {
  const setup = harnessEnvironmentFixture()
  const binding = await setup.service.upsertBinding({
    actorUserId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-1',
    environmentId: 'environment-harness', adapterId: 'claude-code',
    workingDirectory: '/workspace', model: 'opus',
  })
  assert.equal(binding.protocolAdapter, 'harness')
  assert.equal(binding.adapterConfig.harnessId, 'claude-code')
  assert.equal(binding.adapterConfig.modelBilling, 'overlay')
  assert.equal(binding.adapterConfig.model, 'opus')
  assert.equal(binding.adapterConfig.provider, 'vercel')
  assert.equal(binding.adapterConfig.workingDirectory, '/workspace')
  assert.equal(setup.assertedHarness, 'claude-code')
})

test('harness bindings reject adapters the environment does not advertise', async () => {
  const setup = harnessEnvironmentFixture()
  await assertControlPlaneError(
    () => setup.service.upsertBinding({
      actorUserId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-1',
      environmentId: 'environment-harness', adapterId: 'codex',
      workingDirectory: '/workspace',
    }),
    'adapter_unavailable',
  )
})

test('BYOK harness bindings stamp the validated connection and byok billing', async () => {
  const setup = harnessEnvironmentFixture({ connections: [gatewayConnection()] })
  const binding = await setup.service.upsertBinding({
    actorUserId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-1',
    environmentId: 'environment-harness', adapterId: 'claude-code',
    workingDirectory: '/workspace', modelBilling: 'byok', byokConnectionId: 'connection-1',
  })
  assert.equal(binding.adapterConfig.modelBilling, 'byok')
  assert.equal(binding.adapterConfig.byokConnectionId, 'connection-1')
})

test('grandfathered: new harness bindings are refused when creation is gated off', async () => {
  const setup = harnessEnvironmentFixture({ harnessCreationAllowed: false })
  await assertControlPlaneError(
    () => setup.service.upsertBinding({
      actorUserId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-new',
      environmentId: 'environment-harness', adapterId: 'claude-code',
      workingDirectory: '/workspace',
    }),
    'harness_creation_disabled',
  )
})

test('grandfathered: re-saving an existing harness binding bypasses the creation gate', async () => {
  const setup = harnessEnvironmentFixture({ harnessCreationAllowed: false })
  const binding = await setup.service.upsertBinding({
    actorUserId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-1',
    environmentId: 'environment-harness', adapterId: 'claude-code',
    workingDirectory: '/workspace', model: 'opus',
  })
  assert.equal(binding.protocolAdapter, 'harness')
  assert.equal(binding.adapterConfig.model, 'opus')
})

test('BYOK harness bindings fail closed on missing, foreign, or incompatible connections', async () => {
  const setup = harnessEnvironmentFixture({ connections: [gatewayConnection()] })
  // No connection id at all.
  await assertControlPlaneError(
    () => setup.service.upsertBinding({
      actorUserId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-1',
      environmentId: 'environment-harness', adapterId: 'claude-code',
      workingDirectory: '/workspace', modelBilling: 'byok',
    }),
    'byok_connection_required',
  )
  // The connection belongs to a different user.
  await assertControlPlaneError(
    () => setup.service.upsertBinding({
      actorUserId: 'user-2', workspaceId: 'workspace-1', agentId: 'agent-1',
      environmentId: 'environment-harness', adapterId: 'claude-code',
      workingDirectory: '/workspace', modelBilling: 'byok', byokConnectionId: 'connection-1',
    }),
    'byok_connection_unavailable',
  )
  // claude-code cannot authenticate against an OpenRouter connection.
  const withOpenRouter = harnessEnvironmentFixture({
    connections: [gatewayConnection({ providerId: 'openrouter' })],
  })
  await assertControlPlaneError(
    () => withOpenRouter.service.upsertBinding({
      actorUserId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-1',
      environmentId: 'environment-harness', adapterId: 'claude-code',
      workingDirectory: '/workspace', modelBilling: 'byok', byokConnectionId: 'connection-1',
    }),
    'byok_provider_incompatible',
  )
})

test('BYOK harness bindings require the Vercel sandbox provider', async () => {
  const setup = harnessEnvironmentFixture({
    connections: [gatewayConnection()],
    leaseProvider: 'daytona',
  })
  await assertControlPlaneError(
    () => setup.service.upsertBinding({
      actorUserId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-1',
      environmentId: 'environment-harness', adapterId: 'claude-code',
      workingDirectory: '/workspace', modelBilling: 'byok', byokConnectionId: 'connection-1',
    }),
    'byok_provider_unsupported',
  )
})

async function assertControlPlaneError(operation: () => Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) =>
    error instanceof ConnectedAgentControlPlaneError && error.code === code)
}

function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

function artifactFixture(bytes: Uint8Array, artifactsEnabled = true) {
  const environment = fixture().environment
  const credential: AgentEnvironmentCredential = {
    id: 'credential-artifact', workspaceId: environment.workspaceId, environmentId: environment.id,
    tokenHash: sha256(TOKEN), audience: 'overlay-agent-control-plane', methods: ['agent:artifacts:write'],
    tokenNonce: 'artifact-nonce', expiresAt: NOW + 60_000, createdAt: NOW - 1_000,
  }
  const auth: HostAuthentication = { credential, environment }
  const session: AgentRemoteSession = {
    id: 'session-artifact', workspaceId: credential.workspaceId, environmentId: environment.id,
    bindingId: 'binding-artifact', runId: 'run-artifact', status: 'running', commandCursor: 0,
    eventCursor: 0, capabilitySnapshot: {}, createdAt: NOW - 1_000, updatedAt: NOW - 1_000,
  }
  const artifacts = new Map<string, AgentArtifact>()
  const deletedKeys: string[] = []
  let constraints: Parameters<ObjectStore['getUploadUrl']>[2]
  const repository = {
    async getRemoteSessionForRun(input: { workspaceId: string; environmentId: string; runId: string }) {
      return input.workspaceId === session.workspaceId && input.environmentId === session.environmentId && input.runId === session.runId ? session : null
    },
    async createArtifact(input: AgentArtifact) { artifacts.set(input.id, input); return input },
    async getArtifact(input: { workspaceId: string; environmentId: string; artifactId: string }) {
      const artifact = artifacts.get(input.artifactId)
      return artifact?.workspaceId === input.workspaceId && artifact.environmentId === input.environmentId ? artifact : null
    },
    async getArtifactForDownload(input: { actorUserId: string; workspaceId: string; artifactId: string }) {
      const artifact = artifacts.get(input.artifactId)
      return input.actorUserId === 'user-1' && artifact?.workspaceId === input.workspaceId && ['clean', 'linked'].includes(artifact.status) ? artifact : null
    },
    async finalizeArtifact(input: { workspaceId: string; environmentId: string; artifactId: string; status: 'clean' | 'rejected'; scanResult: string; expiresAt?: number; now: number }) {
      const artifact = artifacts.get(input.artifactId)
      if (!artifact || artifact.workspaceId !== input.workspaceId || artifact.environmentId !== input.environmentId) return null
      const next = { ...artifact, status: input.status, scanResult: input.scanResult,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }), updatedAt: input.now }
      artifacts.set(next.id, next)
      return next
    },
    async listArtifactsForCleanup(input: { now: number; limit: number }) {
      return [...artifacts.values()].filter((artifact) => artifact.status !== 'deleted' && artifact.expiresAt <= input.now).slice(0, input.limit)
    },
    async markArtifactDeleted(input: { artifactId: string; now: number }) {
      const artifact = artifacts.get(input.artifactId)
      if (!artifact) return false
      artifacts.set(artifact.id, { ...artifact, status: 'deleted', deletedAt: input.now, updatedAt: input.now })
      return true
    },
  } as unknown as ConnectedAgentRepository
  const objectStore: ObjectStore = {
    async getUploadUrl(key, _contentType, value) { constraints = value; return { url: `https://uploads.example/${key}` } },
    async getDownloadUrl(key) { return `https://downloads.example/${key}` },
    async deleteObject(key) { deletedKeys.push(key) },
    async listObjects() { return [] },
    async headObject() { return { sizeBytes: bytes.byteLength, contentType: 'text/plain' } },
    async downloadBuffer() { return bytes },
  }
  const service = new ConnectedAgentControlPlaneService({ repository, objectStore,
    audit: {} as AuditService, workspaces: {} as WorkspaceService, now: () => NOW,
    isEnabled: () => true, artifactsEnabled: () => artifactsEnabled })
  return { service, auth, session, artifacts, deletedKeys, get constraints() { return constraints } }
}

function artifactRecord(
  id: string,
  auth: HostAuthentication,
  session: AgentRemoteSession,
  overrides: Partial<AgentArtifact> = {},
): AgentArtifact {
  return { id, workspaceId: auth.credential.workspaceId, environmentId: auth.environment.id,
    runId: session.runId, remoteSessionId: session.id, name: 'artifact.txt', mediaType: 'text/plain', size: 7,
    sha256: sha256('expired'), objectKey: `artifacts/${id}`, status: 'clean', expiresAt: NOW + 60_000,
    createdAt: NOW - 1_000, updatedAt: NOW - 1_000, ...overrides }
}

/** An active user-owned provider connection, as `providerConnections.get` returns. */
function gatewayConnection(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'connection-1', userId: 'user-1', workspaceId: 'workspace-1',
    providerId: 'user-vercel-ai-gateway', endpoint: 'https://ai-gateway.vercel.sh/v1',
    displayName: 'My Vercel AI Gateway', enabledModelIds: [],
    status: 'active', credentialRef: 'vault:connection-1',
    isDefault: false, isDeletable: true,
    createdAt: NOW - 1_000, updatedAt: NOW - 1_000,
    ...overrides,
  }
}

/**
 * A managed-harness environment (`overlay_cloud`, harness adapters advertised,
 * `/workspace` grant) plus the repo/workspaces fakes the reset and
 * harness-binding paths need.
 */
function harnessEnvironmentFixture(options: {
  reconnectFails?: boolean
  leaseProvider?: string
  connections?: Array<Record<string, unknown>>
  harnessCreationAllowed?: boolean
} = {}) {
  const harnessEnvironment: AgentEnvironment = {
    id: 'environment-harness', workspaceId: 'workspace-1', kind: 'overlay_cloud',
    name: 'Overlay Cloud · claude-code', status: 'online', publicKey: 'public-key',
    capabilities: { adapters: [{ id: 'claude-code', protocol: 'harness' }] },
    filesystemGrant: { mode: 'selected_roots', roots: ['/workspace'] },
    approvedAt: NOW - 1_000, approvedByUserId: 'user-1', createdAt: NOW - 2_000, updatedAt: NOW - 1_000,
  }
  const localEnvironment: AgentEnvironment = {
    ...fixture().environment, id: 'environment-local', kind: 'local',
  }
  const environments = [harnessEnvironment, localEnvironment]
  const bindings = [
    {
      id: 'binding-1', workspaceId: 'workspace-1', agentId: 'agent-1',
      environmentId: 'environment-harness', protocolAdapter: 'harness',
      adapterConfig: { harnessId: 'claude-code', workingDirectory: '/workspace' },
    },
    {
      id: 'binding-2', workspaceId: 'workspace-1', agentId: 'agent-2',
      environmentId: 'environment-harness', protocolAdapter: 'harness',
      adapterConfig: { harnessId: 'claude-code', workingDirectory: '/workspace' },
    },
  ]
  const lease = {
    id: 'lease-1', workspaceId: 'workspace-1', environmentId: 'environment-harness',
    provider: options.leaseProvider ?? 'vercel', providerReference: 'sandbox-ref-1', status: 'running',
    reservedUntil: NOW + 60_000, usage: {}, cleanupAttempts: 0, createdAt: NOW - 1_000, updatedAt: NOW - 1_000,
  }
  const clearedBindingIds: string[] = []
  const deletedReferences: string[] = []
  const upserts: Array<Record<string, unknown>> = []
  let assertedHarness: string | null = null
  const repository = {
    async getEnvironment(args: { workspaceId: string; environmentId: string }) {
      return environments.find(
        (environment) => environment.id === args.environmentId && environment.workspaceId === args.workspaceId,
      ) ?? null
    },
    async listBindings(args: { workspaceId: string; agentId?: string }) {
      return bindings.filter((binding) =>
        binding.workspaceId === args.workspaceId
        && (!args.agentId || binding.agentId === args.agentId))
    },
    async deleteHarnessSessionsForBinding(args: { workspaceId: string; bindingId: string }) {
      clearedBindingIds.push(args.bindingId)
      return 1
    },
    async getActiveSandboxLease(args: { workspaceId: string; environmentId: string }) {
      return args.environmentId === lease.environmentId ? lease : null
    },
    async upsertBinding(input: Record<string, unknown>) {
      upserts.push(input)
      return { ...input, createdAt: input.now, updatedAt: input.now }
    },
  } as unknown as ConnectedAgentRepository
  const workspaces = {
    async resolveActiveWorkspace() { return { membership: { role: 'admin' } } },
    async assertAgentHarnessAllowed(args: { harness: string }) { assertedHarness = args.harness },
  } as unknown as WorkspaceService
  const managedRuntime = () => ({
    reconnect: async (reference: string) => {
      if (options.reconnectFails) throw new Error('sandbox already deleted')
      return { delete: async () => { deletedReferences.push(reference) } }
    },
  })
  const service = new ConnectedAgentControlPlaneService({
    repository,
    audit: { record: async () => {} } as unknown as AuditService,
    workspaces,
    providerConnections: {
      async get(args: { connectionId: string; userId: string }) {
        return (options.connections ?? []).find(
          (connection) => connection._id === args.connectionId && connection.userId === args.userId,
        ) ?? null
      },
    } as never,
    now: () => NOW,
    isEnabled: () => true,
    managedRuntime: managedRuntime as never,
    harnessCreationAllowed: async () => options.harnessCreationAllowed ?? true,
  })
  return {
    service, clearedBindingIds, deletedReferences, upserts,
    get assertedHarness() { return assertedHarness },
  }
}
