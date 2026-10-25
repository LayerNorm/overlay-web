import 'server-only'

import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalEnrollmentProof, canonicalHostRequestProof, MAX_HOST_REQUEST_BYTES } from '@layernorm/overlay-agent-bridge-protocol'
import { AGENT_ENVIRONMENT_CREDENTIAL_METHODS } from '@overlay/workspace-contracts'
import type { ObjectStore } from '@overlay/app-core'
import type { AgentArtifact, AgentEnvironment, AgentEnvironmentCredential, AgentRemoteSession } from '@overlay/workspace-contracts'
import { AuditService } from '@/server/admin'
import { clearOverlayRuntimeConfigCache } from '@/server/config'
import type { AuditEventRecord } from '@/server/admin/AuditRepository'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { ConnectedAgentRepository } from './ConnectedAgentRepository'
import {
  ConnectedAgentControlPlaneError,
  ConnectedAgentControlPlaneService,
  effectiveAgentEnvironmentStatus,
  type HostAuthentication,
} from './ConnectedAgentControlPlaneService'
import {connectedAgentPolicyEntitlementsSchema, connectedAgentPolicyFor, type ConnectedAgentPolicyEntitlements} from './ConnectedAgentPolicy'

const NOW = 1_800_000_000_000
const TOKEN = 'test-environment-credential-with-enough-entropy'
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function fixture(overrides: Partial<AgentEnvironment> = {}, credentialOverrides: Partial<AgentEnvironmentCredential> = {}, options: {
  driveEnabled: boolean
  policyLimits?: ConstructorParameters<typeof ConnectedAgentControlPlaneService>[0]['policyLimits']
  policyProjectionEnabled?: boolean
  launchEnabled?: boolean
  omitLaunchEnabled?: boolean
  settleUsage?: (settlement: Parameters<ConnectedAgentControlPlaneService['finalizeRemoteRunUsage']>[0]) => Promise<void>
} = { driveEnabled: false }) {
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
  const launchWorkspaceIds: Array<string | undefined> = []
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
    async listBindings(args: { workspaceId: string }) {
      return args.workspaceId === environment.workspaceId ? [] : []
    },
    async revokeEnvironment(args: { workspaceId: string; environmentId: string }) {
      return args.workspaceId === environment.workspaceId && args.environmentId === environment.id
    },
    async disableBindingsForAgent() { return true },
    async claimCommands() { return [] },
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
    isEnabled: () => true,
    ...(options.omitLaunchEnabled ? {} : {
      launchEnabled: (workspaceId?: string) => {
        launchWorkspaceIds.push(workspaceId)
        return options.launchEnabled !== false
      },
    }),
    driveEnabled: () => options.driveEnabled,
    settleUsage: options.settleUsage,
    policyLimits: options.policyLimits,
    policyProjectionEnabled: options.policyProjectionEnabled,
  }
  const service = new ConnectedAgentControlPlaneService(dependencies)
  return {
    service, environment, repository, credential, scopeUpdates, audits, launchWorkspaceIds,
    get enrollmentRedemptions() { return enrollmentRedemptions },
  }
}

function queuedCommands(): Awaited<ReturnType<ConnectedAgentRepository['claimCommands']>> {
  const common = {
    workspaceId: 'workspace-1',
    environmentId: 'environment-1',
    runId: 'run-1',
    status: 'claimed' as const,
    createdAt: NOW,
    updatedAt: NOW,
  }
  return [
    {
      ...common,
      id: 'start-command',
      sequence: 1,
      type: 'start',
      payload: {
        bindingId: 'binding-1',
        adapterId: 'codex',
        workingDirectory: '/workspace/project',
        prompt: 'start this run',
        metadata: { overlayMcp: { url: 'https://overlay.example/api/agent-mcp', token: 'private-mcp-token' } },
      },
    },
    { ...common, id: 'resume-command', sequence: 2, type: 'reconnect', payload: { remoteSessionId: 'session-1' } },
    { ...common, id: 'steer-command', sequence: 3, type: 'prompt', payload: { prompt: 'continue the run' } },
    { ...common, id: 'cancel-command', sequence: 4, type: 'cancel', payload: { reason: 'stop the run' } },
    { ...common, id: 'observe-command', sequence: 5, type: 'observe', payload: {} },
    { ...common, id: 'shutdown-command', sequence: 6, type: 'shutdown', payload: { reason: 'retired run' } },
  ] as Awaited<ReturnType<ConnectedAgentRepository['claimCommands']>>
}

test('launch-off preserves authorized host/read and cleanup paths while rejecting setup', async () => {
  let settled = 0
  const f = fixture({}, {}, {
    driveEnabled: false,
    launchEnabled: false,
    settleUsage: async () => { settled += 1 },
  })
  await assertControlPlaneError(
    () => f.service.createEnrollmentSession({ actorUserId: 'user-1', workspaceId: f.environment.workspaceId }),
    'feature_disabled',
  )
  assert.equal((await f.service.listEnvironments({
    actorUserId: 'user-1',
    workspaceId: f.environment.workspaceId,
  })).length, 1)
  await f.service.revokeEnvironment({
    actorUserId: 'user-1',
    workspaceId: f.environment.workspaceId,
    environmentId: f.environment.id,
  })
  await f.service.disableBindings({
    actorUserId: 'user-1',
    workspaceId: f.environment.workspaceId,
    agentId: 'agent-1',
  })
  const host = await f.service.authenticateHostRequest(signedRequest({
    target: '/api/v1/agent-environments/environment-1/events',
  }))
  assert.equal(host.environment.id, f.environment.id)
  await f.service.pollCommands(host, 10)
  await f.service.finalizeRemoteRunUsage({
    agentId: 'agent-1',
    conversationId: 'conversation-1',
    environmentId: f.environment.id,
    forceFreeTierLimits: false,
    inputTokens: 1,
    modelId: 'test-model',
    modelUsageBilling: 'overlay',
    memoryEnabled: false,
    messageId: 'message-1',
    operationId: 'operation-1',
    outputTokens: 1,
    outcome: 'completed',
    reservationId: null,
    runId: 'run-1',
    sandboxBilling: null,
    userId: 'user-1',
    turnId: 'turn-1',
    workspaceId: f.environment.workspaceId,
  })
  assert.equal(settled, 1)
})

test('workspace-less enrollment redemption checks launch policy before repository mutation', async () => {
  const f = fixture({}, {}, { driveEnabled: false, launchEnabled: false })
  const request = {
    code: 'enrollment-code-123456',
    name: 'Test host',
    publicKey: publicKeyPem,
    hostVersion: '1.0.0',
    platform: 'test',
    capabilities: {},
  }

  await assertControlPlaneError(
    () => f.service.redeemEnrollment(request as Parameters<typeof f.service.redeemEnrollment>[0]),
    'feature_disabled',
  )
  assert.deepEqual(f.launchWorkspaceIds, [undefined])
  assert.equal(f.enrollmentRedemptions, 0)
})

test('launch-off polling neutralizes start, resume, and steer while preserving cancel, observe, shutdown, and sequence', async () => {
  const f = fixture({}, {}, { driveEnabled: false, launchEnabled: false })
  f.repository.claimCommands = async () => queuedCommands()
  const response = await f.service.pollCommands({ environment: f.environment, credential: f.credential }, 10)

  assert.deepEqual(response.commands.map(({ type, sequence }) => [type, sequence]), [
    ['shutdown', 1],
    ['shutdown', 2],
    ['shutdown', 3],
    ['cancel', 4],
    ['observe', 5],
    ['shutdown', 6],
  ])
  assert.deepEqual(
    response.commands.filter((command) => command.type === 'shutdown').slice(0, 3).map((command) => command.payload),
    Array.from({ length: 3 }, () => ({ reason: 'External agent runtimes are disabled.' })),
  )
  assert.equal(JSON.stringify(response).includes('private-mcp-token'), false)
})

test('polling without an injected launch policy uses the runtime release policy', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousExternalAgents = process.env.OVERLAY_FEATURE_EXTERNAL_AGENTS
  process.env.NODE_ENV = 'test'
  process.env.OVERLAY_FEATURE_EXTERNAL_AGENTS = 'false'
  clearOverlayRuntimeConfigCache()
  try {
    const f = fixture({}, {}, { driveEnabled: false, omitLaunchEnabled: true })
    f.repository.claimCommands = async () => queuedCommands()
    const response = await f.service.pollCommands({ environment: f.environment, credential: f.credential }, 10)

    assert.equal(response.commands[0]?.type, 'shutdown')
    assert.equal(JSON.stringify(response).includes('private-mcp-token'), false)
  } finally {
    if (previousExternalAgents === undefined) delete process.env.OVERLAY_FEATURE_EXTERNAL_AGENTS
    else process.env.OVERLAY_FEATURE_EXTERNAL_AGENTS = previousExternalAgents
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    clearOverlayRuntimeConfigCache()
  }
})

test('drive activation persists only the managed Cloud root and is idempotent', async () => {
  const f = fixture({ kind: 'overlay_cloud', capabilities: { drive: { version: 1 } },
    filesystemGrant: { mode: 'selected_roots', roots: ['/home/user/workspace'] } }, {}, { driveEnabled: true })
  await f.service.prepareDriveEnvironment({ workspaceId: f.environment.workspaceId, environmentId: f.environment.id })
  assert.deepEqual(f.environment.filesystemGrant, { mode: 'selected_roots', roots: ['/home/user/workspace', '/home/user/drive'] })
  assert.equal(f.scopeUpdates.length, 1)
  assert.equal(f.audits[0]?.actorType, 'service')
  assert.equal(f.audits[0]?.metadata.reason, 'connected_agent_drive')
  await f.service.prepareDriveEnvironment({ workspaceId: f.environment.workspaceId, environmentId: f.environment.id })
  assert.equal(f.scopeUpdates.length, 1)
})

test('drive activation never expands local/VPS grants and refuses disabled, unupgraded or revoked Cloud hosts', async () => {
  for (const kind of ['local', 'vps', 'external'] as const) {
    const f = fixture({ kind, capabilities: { drive: { version: 1 } } }, {}, { driveEnabled: true })
    await f.service.prepareDriveEnvironment({ workspaceId: f.environment.workspaceId, environmentId: f.environment.id })
    assert.deepEqual(f.environment.filesystemGrant, { mode: 'selected_roots', roots: ['/workspace/project'] })
    assert.equal(f.scopeUpdates.length, 0)
  }
  for (const input of [{ enabled: false, capabilities: { drive: { version: 1 } }, status: 'online' as const },
    { enabled: true, capabilities: {}, status: 'online' as const },
    { enabled: true, capabilities: { drive: { version: 1 } }, status: 'revoked' as const }]) {
    const f = fixture({ kind: 'overlay_cloud', capabilities: input.capabilities, status: input.status }, {}, { driveEnabled: input.enabled })
    await assert.rejects(f.service.prepareDriveEnvironment({ workspaceId: f.environment.workspaceId, environmentId: f.environment.id }))
    assert.equal(f.scopeUpdates.length, 0)
  }
  const f = fixture({ kind: 'overlay_cloud', capabilities: { drive: { version: 1 } } }, {}, { driveEnabled: true })
  await assert.rejects(f.service.prepareDriveEnvironment({ workspaceId: 'foreign', environmentId: f.environment.id }))
  assert.equal(f.scopeUpdates.length, 0)
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

test('an expired credential may only refresh itself, and only on an Overlay Cloud machine', async () => {
  const methods: AgentEnvironmentCredential['methods'] = ['agent:commands:poll', 'agent:credentials:refresh']
  const expired = { expiresAt: NOW - 3 * 60 * 60_000, methods }
  const refresh = () => ({ ...signedRequest({ target: '/api/v1/agent-environments/environment-1/credentials/refresh' }), requiredMethod: 'agent:credentials:refresh' as const })

  const cloud = fixture({ kind: 'overlay_cloud' }, expired)
  assert.equal((await cloud.service.authenticateHostRequest(refresh())).environment.id, 'environment-1')

  await assertControlPlaneError(() => cloud.service.authenticateHostRequest({
    ...signedRequest({ target: '/api/v1/agent-environments/environment-1/events', nonce: 'nonce_nonce_nonce_nonce_02' }),
  }), 'credential_invalid')

  const laptop = fixture({ kind: 'local' }, expired)
  await assertControlPlaneError(() => laptop.service.authenticateHostRequest(refresh()), 'credential_invalid')

  const longGone = fixture({ kind: 'overlay_cloud' }, { ...expired, expiresAt: NOW - 8 * 24 * 60 * 60_000 })
  await assertControlPlaneError(() => longGone.service.authenticateHostRequest(refresh()), 'credential_invalid')

  const revoked = fixture({ kind: 'overlay_cloud' }, { ...expired, revokedAt: NOW - 1 })
  await assertControlPlaneError(() => revoked.service.authenticateHostRequest(refresh()), 'credential_invalid')
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

test('hosted harness adapters can no longer be bound', async () => {
  const environment: AgentEnvironment = {
    id: 'environment-hosted', workspaceId: 'workspace-1', kind: 'overlay_cloud',
    name: 'Overlay Cloud · claude-code', status: 'online', publicKey: 'public-key',
    capabilities: { adapters: [{ id: 'claude-code', protocol: 'harness' }] },
    filesystemGrant: { mode: 'selected_roots', roots: ['/workspace'] },
    approvedAt: NOW - 1_000, approvedByUserId: 'user-1', createdAt: NOW - 2_000, updatedAt: NOW - 1_000,
  }
  const upserts: unknown[] = []
  const service = new ConnectedAgentControlPlaneService({
    repository: {
      async getEnvironment() { return environment },
      async upsertBinding(input: unknown) { upserts.push(input); return input },
    } as unknown as ConnectedAgentRepository,
    audit: { record: async () => {} } as unknown as AuditService,
    workspaces: {
      async resolveActiveWorkspace() { return { membership: { role: 'admin' } } },
    } as unknown as WorkspaceService,
    now: () => NOW,
    isEnabled: () => true,
    launchEnabled: () => true,
  })
  await assertControlPlaneError(
    () => service.upsertBinding({
      actorUserId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-1',
      environmentId: 'environment-hosted', adapterId: 'claude-code', workingDirectory: '/workspace',
    }),
    'adapter_unavailable',
  )
  assert.deepEqual(upserts, [])
})

function providerAccountHarness(options: {
  bindingConfig?: Record<string, unknown>
  sessionStatus?: string
  environmentKind?: AgentEnvironment['kind']
  resolve?: () => Promise<{ env: Record<string, string>; files: Array<{ path: string; contents: string; mode?: number }>; provider: 'claude-code' | 'codex'; method: 'subscription' }>
  deliver?: 'fail' | 'none'
  discoveryBindings?: 'none' | 'foreign' | 'disabled' | 'ambiguous'
  activeRuns?: boolean
  memberRevoked?: boolean
} = {}) {
  const delivered: unknown[] = []
  const environment: AgentEnvironment = {
    id: 'environment-cloud', workspaceId: 'workspace-1', kind: options.environmentKind ?? 'overlay_cloud',
    name: 'Cloud machine', status: 'online', publicKey: 'public-key',
    capabilities: { adapters: [{ id: 'claude-code', protocol: 'acp' }, { id: 'codex', protocol: 'acp' }, { id: 'hermes', protocol: 'acp' }, { id: 'eve', protocol: 'acp' }] },
    filesystemGrant: { mode: 'selected_roots', roots: ['/home/user/workspace'] },
    approvedAt: NOW - 1_000, approvedByUserId: 'user-1', createdAt: NOW - 2_000, updatedAt: NOW - 1_000,
  }
  const upserts: Array<{ adapterConfig: Record<string, unknown> }> = []
  const reauth: string[] = []
  const issued: Array<{ accountId: string; ownerUserId: string; expectedProvider: string }> = []
  const binding = {
    id: 'binding-1', workspaceId: 'workspace-1', agentId: 'agent-1', environmentId: environment.id,
    protocolAdapter: 'acp', enabled: true, createdAt: 1, updatedAt: 1,
    adapterConfig: options.bindingConfig ?? { adapterId: 'claude-code', workingDirectory: '/home/user/workspace', providerAccountId: 'account-1', providerAccountOwnerUserId: 'user-1' },
  }
  const session = {
    id: 'session-1', workspaceId: 'workspace-1', environmentId: environment.id, bindingId: 'binding-1', runId: 'run-1',
    status: options.sessionStatus ?? 'running', capabilitySnapshot: { billing: { agentId: 'agent-1' } },
  }
  const service = new ConnectedAgentControlPlaneService({
    repository: {
      async getEnvironment() { return environment },
      async upsertBinding(input: { adapterConfig: Record<string, unknown> }) { upserts.push(input); return { ...binding, adapterConfig: input.adapterConfig } },
      async getRemoteSessionForRun(args: { runId: string }) { return args.runId === 'run-1' ? session : null },
      async listBindings() {
        if (options.discoveryBindings === 'none') return []
        if (options.discoveryBindings === 'foreign') return [{ ...binding, environmentId: 'other-environment' }]
        if (options.discoveryBindings === 'disabled') return [{ ...binding, enabled: false }]
        if (options.discoveryBindings === 'ambiguous') return [binding, { ...binding, id: 'binding-2' }]
        return [binding]
      },
      async environmentHasActiveRuns() { return options.activeRuns === true },
    } as unknown as ConnectedAgentRepository,
    audit: { record: async () => {} } as unknown as AuditService,
    workspaces: { async resolveActiveWorkspace() { if (options.memberRevoked) throw Error('Workspace membership revoked'); return { membership: { role: 'admin' } } } } as unknown as WorkspaceService,
    agentProviderAccounts: {
      async requireUsable(args: { userId: string; accountId: string; provider: string }) {
        if (args.accountId !== 'account-1' || args.userId !== 'user-1') throw Object.assign(new Error('Account not found'), { statusCode: 404 })
        return {} as never
      },
      async resolveRunEnvironment(args: { accountId: string; ownerUserId: string; expectedProvider: string }) {
        issued.push(args)
        return await (options.resolve ?? (async () => ({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'secret-token' }, files: [], provider: 'claude-code' as const, method: 'subscription' as const })))()
      },
      async markNeedsReauth(accountId: string) { reauth.push(accountId) },
    },
    ...(options.deliver === 'none' ? {} : { deliverMachineFiles: async (args: unknown) => { if (options.deliver === 'fail') throw new Error('machine down'); delivered.push(args) } }),
    now: () => NOW,
    isEnabled: () => true,
    launchEnabled: () => true,
  })
  const auth = {
    environment,
    credential: { id: 'credential-1', workspaceId: 'workspace-1', environmentId: environment.id, methods: ['agent:run-credentials'] },
  } as unknown as HostAuthentication
  return { service, auth, upserts, reauth, issued, delivered }
}

test('a binding records the account and who chose it, and refuses accounts that are not the actor\'s', async () => {
  const { service, upserts } = providerAccountHarness()
  const base = { actorUserId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-1', environmentId: 'environment-cloud', adapterId: 'claude-code', workingDirectory: '/home/user/workspace' }
  await service.upsertBinding({ ...base, providerAccountId: 'account-1' })
  assert.equal(upserts[0]?.adapterConfig.providerAccountId, 'account-1')
  assert.equal(upserts[0]?.adapterConfig.providerAccountOwnerUserId, 'user-1')
  await assertControlPlaneError(() => service.upsertBinding({ ...base, providerAccountId: 'someone-elses' }), 'provider_account_invalid')
  await assertControlPlaneError(() => service.upsertBinding({ ...base, adapterId: 'hermes', providerAccountId: 'account-1' }), 'adapter_unavailable')
  await assertControlPlaneError(() => service.upsertBinding({ ...base, adapterId: 'eve', providerAccountId: 'account-1' }), 'adapter_unavailable')
})

test('run credentials go only to the Overlay Cloud host running that active run, for the account the binding chose', async () => {
  const { service, auth, issued } = providerAccountHarness()
  assert.deepEqual(await service.issueRunCredentials(auth, 'run-1'), { env: { CLAUDE_CODE_OAUTH_TOKEN: 'secret-token' } })
  assert.deepEqual(issued, [{ accountId: 'account-1', ownerUserId: 'user-1', expectedProvider: 'claude-code' }])
  await assertControlPlaneError(() => service.issueRunCredentials(auth, 'other-run'), 'run_not_active')
})

test('run credentials are refused for finished runs, other environment kinds, and bindings without an account', async () => {
  await assertControlPlaneError(
    () => providerAccountHarness({ sessionStatus: 'completed' }).service.issueRunCredentials(providerAccountHarness().auth, 'run-1'),
    'run_not_active',
  )
  const local = providerAccountHarness({ environmentKind: 'local' })
  await assertControlPlaneError(() => local.service.issueRunCredentials(local.auth, 'run-1'), 'run_credentials_forbidden')
  const none = providerAccountHarness({ bindingConfig: { adapterId: 'claude-code', workingDirectory: '/home/user/workspace' } })
  await assertControlPlaneError(() => none.service.issueRunCredentials(none.auth, 'run-1'), 'provider_account_missing')
})

test('an account that needs reconnecting surfaces its own code to the host', async () => {
  const { service, auth } = providerAccountHarness({
    resolve: async () => { throw Object.assign(new Error('Reconnect'), { statusCode: 409, code: 'account_needs_reauth' }) },
  })
  await assertControlPlaneError(() => service.issueRunCredentials(auth, 'run-1'), 'account_needs_reauth')
})

test('only Overlay Cloud credentials carry the run-credentials method, so older hosts keep parsing theirs', async () => {
  assert.ok(AGENT_ENVIRONMENT_CREDENTIAL_METHODS.includes('agent:run-credentials'))
  const issue = async (kind: AgentEnvironment['kind'], drive = false) => {
    const issued: string[][] = []
    const environment = fixture({ kind }).environment
    if (drive) environment.capabilities = { ...environment.capabilities, drive: { version: 1 } }
    const service = new ConnectedAgentControlPlaneService({
      repository: {
        async getEnvironmentProofChallenge() {
          return { environment, proofChallenge: { id: 'p', challengeHash: sha256('challenge') } }
        },
        async issueEnvironmentCredential(input: { credential: AgentEnvironmentCredential }) {
          issued.push([...input.credential.methods])
          return input.credential
        },
      } as unknown as ConnectedAgentRepository,
      audit: { record: async () => {} } as unknown as AuditService,
      workspaces: {} as WorkspaceService, now: () => NOW, isEnabled: () => true, launchEnabled: () => true,
    })
    const signature = sign(null, Buffer.from(canonicalEnrollmentProof(environment.id, 'challenge')), privateKey).toString('base64url')
    await service.issueInitialCredential({ environmentId: environment.id, proofChallenge: 'challenge', signature })
    return issued[0] ?? []
  }
  assert.ok((await issue('overlay_cloud')).includes('agent:run-credentials'))
  assert.equal((await issue('local')).includes('agent:run-credentials'), false)
  assert.equal((await issue('vps')).includes('agent:run-credentials'), false)
  for (const kind of ['overlay_cloud', 'local', 'vps'] as const) {
    assert.equal((await issue(kind)).includes('agent:drive-credentials'), false)
    assert.equal((await issue(kind, true)).includes('agent:drive-credentials'), true)
  }
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
    isEnabled: () => true, launchEnabled: () => true, artifactsEnabled: () => artifactsEnabled })
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

test('an account that needs a file on the machine (a Codex subscription) has it written first, and the run gets no secret in its environment', async () => {
  const files = [{ path: '/home/user/.codex/auth.json', contents: '{"tokens":{}}', mode: 0o600 }]
  const resolve = async () => ({ env: {}, files, provider: 'codex' as const, method: 'subscription' as const })
  const ok = providerAccountHarness({ resolve, bindingConfig: { adapterId: 'codex', workingDirectory: '/home/user/workspace', providerAccountId: 'account-1', providerAccountOwnerUserId: 'user-1' } })
  assert.deepEqual(await ok.service.issueRunCredentials(ok.auth, 'run-1'), { env: {} })
  assert.deepEqual(ok.delivered, [{ workspaceId: 'workspace-1', environmentId: 'environment-cloud', files }])

  const down = providerAccountHarness({ resolve, deliver: 'fail', bindingConfig: { adapterId: 'codex', workingDirectory: '/home/user/workspace', providerAccountId: 'account-1', providerAccountOwnerUserId: 'user-1' } })
  await assertControlPlaneError(() => down.service.issueRunCredentials(down.auth, 'run-1'), 'machine_files_failed')
  const none = providerAccountHarness({ resolve, deliver: 'none', bindingConfig: { adapterId: 'codex', workingDirectory: '/home/user/workspace', providerAccountId: 'account-1', providerAccountOwnerUserId: 'user-1' } })
  await assertControlPlaneError(() => none.service.issueRunCredentials(none.auth, 'run-1'), 'machine_files_unavailable')
})


test('poll extension is omitted for strict legacy hosts and sent only after v2 negotiation', async () => {
  for (const negotiated of [false, true]) {
    const f = fixture({ capabilities: negotiated ? { remoteLifecycleVersion: 2 } : {} })
    f.repository.claimCommands = async () => []
    let floorReads = 0
    f.repository.commandResolutionFloor = async () => { floorReads++; return 12 }
    const response = await f.service.pollCommands({ environment: f.environment, credential: f.credential }, 10)
    const wire = JSON.parse(JSON.stringify(response))
    assert.equal(Object.hasOwn(wire, 'resolvedThroughSequence'), negotiated)
    assert.equal(floorReads, negotiated ? 1 : 0)
    if (negotiated) assert.equal(wire.resolvedThroughSequence, 12)
  }
})

test('legacy web-first controls omit the new argument until lifecycle v2 is enabled', async () => {
  const previous = process.env.OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION
  try {
    for (const enabled of [false, true]) {
      if (enabled) process.env.OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION = '2'
      else delete process.env.OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION
      const f = fixture()
      const received: Array<Parameters<ConnectedAgentRepository['controlRemoteAgentTurn']>[0]> = []
      f.repository.controlRemoteAgentTurn = async input => {
        if (!enabled) assert.equal(Object.hasOwn(input, 'controlRequestId'), false)
        received.push(input)
        return { applied: true }
      }
      const service = new ConnectedAgentControlPlaneService({ repository: f.repository,
        audit: { async record() {} } as unknown as AuditService, workspaces: {} as WorkspaceService,
        now: () => NOW, isEnabled: () => true, launchEnabled: () => true })
      await service.controlRemoteTurn({ actorUserId: 'user-1', workspaceId: 'workspace-1',
        conversationId: 'conversation-1', runId: 'run-1', action: 'cancel', controlRequestId: 'control-1' })
      assert.equal(received[0]?.controlRequestId, enabled ? 'control-1' : undefined)
      assert.equal(received[0]?.action, 'cancel')
    }
  } finally {
    if (previous === undefined) delete process.env.OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION
    else process.env.OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION = previous
  }
})

test('every delivered start binds MCP scope to its execution without extending expiry', async () => {
  const { mintAgentMcpToken, verifyAgentMcpToken } = await import('./agent-mcp-token')
  const previous = process.env.OVERLAY_AGENT_MCP_SECRET
  process.env.OVERLAY_AGENT_MCP_SECRET = 'integration-test-mcp-secret'
  try {
    for (const fresh of [false, true]) for (const runId of ['run-1', 'foreign-run']) {
      const token = mintAgentMcpToken({ userId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-1',
        agentPrincipalId: 'principal-agent', conversationId: 'conversation-1', environmentId: 'environment-1',
        runId, turnId: 'turn-1', invocationNonce: 'nonce-1', modelId: 'byo/codex', memoryEnabled: false,
        sessionId: 'attempt-1', execution: { attemptId: 'attempt-1', generation: 1 },
        grant: { allowedToolIds: [], isDefaultMaster: false }, ttlMs: 60_000 })!
      const f = fixture({ capabilities: { remoteLifecycleVersion: 2 } })
      f.repository.commandResolutionFloor = async () => 0
      f.repository.claimCommands = async () => [{ id: 'command-1', workspaceId: 'workspace-1', environmentId: 'environment-1',
        runId: 'run-1', type: 'start', sequence: 1, status: 'claimed', createdAt: NOW, updatedAt: NOW,
        attemptId: 'attempt-2', executionGeneration: 2,
        payload: { bindingId: 'binding-1', adapterId: 'codex', workingDirectory: '/workspace/project', prompt: 'Work', fresh,
          metadata: { overlayMcp: { url: 'https://overlay.example/api/agent-mcp', token } } },
      }]
      const poll = f.service.pollCommands({ environment: f.environment, credential: f.credential }, 10)
      if (runId !== 'run-1') {
        await assert.rejects(poll, (error: unknown) => error instanceof ConnectedAgentControlPlaneError && error.code === 'recovery_credentials_invalid')
      } else {
        const { commands } = await poll
        assert.equal(commands[0]?.type, 'start')
        if (commands[0]?.type !== 'start') throw new Error('Expected a start command')
        assert.equal(commands[0].payload.metadata.overlayPreparation, 1)
        const mcp = commands[0].payload.metadata.overlayMcp
        assert.ok(mcp && typeof mcp === 'object' && 'token' in mcp && typeof mcp.token === 'string')
        const claims = verifyAgentMcpToken(mcp.token)
        assert.equal(claims?.runId, 'run-1')
        assert.equal(claims?.sessionId, 'attempt-2')
        assert.deepEqual(claims?.execution, { attemptId: 'attempt-2', generation: 2 })
        assert.equal(verifyAgentMcpToken(token)?.execution?.generation, 1)
        assert.deepEqual(claims?.grant, { allowedToolIds: [], isDefaultMaster: false })
        assert.ok(claims!.expiresAt <= verifyAgentMcpToken(token)!.expiresAt)
      }
    }
  } finally {
    if (previous === undefined) delete process.env.OVERLAY_AGENT_MCP_SECRET
    else process.env.OVERLAY_AGENT_MCP_SECRET = previous
  }
})

test('a batch Convex refuses as unusable is counted against its run, and the refusal still reaches the host', async () => {
  const { service, repository } = fixture()
  const counted: Array<{ runId: string; workspaceId: string; environmentId: string }> = []
  Object.assign(repository, {
    async getRemoteSessionForRun() { return { id: 'session-1', eventCursor: 0, capabilitySnapshot: {} } },
    async applyRemoteEvents() { throw new Error('[Request ID: abc123] Uncaught Error: AGENT_EVENT_BATCH_TOO_LARGE') },
    async recordRejectedEventBatch(args: { runId: string; workspaceId: string; environmentId: string }) { counted.push(args); return true },
  })
  const auth = { credential: { workspaceId: 'workspace-1', environmentId: 'environment-1' }, environment: { id: 'environment-1' } }
  const batch = { protocolVersion: 1, environmentId: 'environment-1', runId: 'run-1', events: [] }
  await assert.rejects(() => service.applyEvents(auth as never, batch as never), /AGENT_EVENT_BATCH_TOO_LARGE/)
  assert.deepEqual(counted, [{ workspaceId: 'workspace-1', environmentId: 'environment-1', runId: 'run-1' }])

  // A failing counter never replaces the original refusal.
  Object.assign(repository, { async recordRejectedEventBatch() { throw new Error('convex down') } })
  await assert.rejects(() => service.applyEvents(auth as never, batch as never), /AGENT_EVENT_BATCH_TOO_LARGE/)
})

test('ingestion uses current policy projections only for the canonical resolver and keeps legacy fallback fail closed', async () => {
  const projections: Array<ConnectedAgentPolicyEntitlements | null | undefined> = [
    undefined, {planKind: 'paid', tier: 'pro'}, {planKind: 'free', tier: 'free'}, null,
    JSON.parse('{"planKind":"free","tier":"pro"}'), JSON.parse('{"tier":"pro"}'),
  ]
  for (const enabled of [false, true]) for (const projection of projections) {
    let policyCalls = 0, legacyLookups = 0
    const applied: Array<Parameters<ConnectedAgentRepository['applyRemoteEvents']>[0]> = []
    const f = fixture({}, {}, {driveEnabled: false, policyProjectionEnabled: enabled,
      policyLimits: async input => {
        policyCalls++
        if (!input.entitlements) legacyLookups++
        return connectedAgentPolicyFor(input.entitlements ?? {planKind: 'free', tier: 'free'})
      }})
    Object.assign(f.repository, {
      async getRemoteSessionForRun() {return {id: 'session', eventCursor: 0,
        capabilitySnapshot: {billing: {userId: 'user-1'}},
        ...(projection === undefined ? {} : {policyEntitlements: projection})}},
      async applyRemoteEvents(input: Parameters<ConnectedAgentRepository['applyRemoteEvents']>[0]) {
        applied.push(input); return {accepted: true as const, acknowledgedSequence: 0}
      },
    })
    const apply = () => f.service.applyEvents({environment: f.environment, credential: f.credential},
      {protocolVersion: 1, environmentId: f.environment.id, runId: 'run', events: []})
    if (enabled && projection !== undefined && !connectedAgentPolicyEntitlementsSchema.safeParse(projection).success) {
      await assert.rejects(apply, error => error instanceof ConnectedAgentControlPlaneError && error.code === 'policy_entitlements_unavailable')
      assert.equal(policyCalls, 0)
      assert.equal(applied.length, 0)
    } else {
      await apply()
      assert.equal(policyCalls, 1)
      assert.equal(legacyLookups, enabled && projection ? 0 : 1)
      assert.equal(applied[0]?.maxEventsPerMinute, enabled && projection?.planKind === 'paid' ? 10_000 : 1_000)
    }
  }
})


test('idle Cloud options discovery resolves only its unique enabled adapter binding account', async () => {
  const {service, auth, issued} = providerAccountHarness()
  assert.deepEqual(await service.issueDiscoveryCredentials(auth, 'claude-code'), {env: {CLAUDE_CODE_OAUTH_TOKEN: 'secret-token'}})
  assert.deepEqual(issued, [{accountId: 'account-1', ownerUserId: 'user-1', expectedProvider: 'claude-code'}])
})

test('options discovery refuses local hosts, foreign/disabled/ambiguous bindings, unsupported adapters and active work before credential lookup', async () => {
  for (const discoveryBindings of ['none', 'foreign', 'disabled', 'ambiguous'] as const) {
    const {service, auth, issued} = providerAccountHarness({discoveryBindings})
    await assertControlPlaneError(() => service.issueDiscoveryCredentials(auth, 'claude-code'), 'provider_account_missing')
    assert.deepEqual(issued, [])
  }
  const local = providerAccountHarness({environmentKind: 'local'})
  await assertControlPlaneError(() => local.service.issueDiscoveryCredentials(local.auth, 'claude-code'), 'run_credentials_forbidden')
  assert.deepEqual(local.issued, [])
  const busy = providerAccountHarness({activeRuns: true})
  await assertControlPlaneError(() => busy.service.issueDiscoveryCredentials(busy.auth, 'claude-code'), 'provider_discovery_busy')
  assert.deepEqual(busy.issued, [])
  const unsupported = providerAccountHarness()
  await assertControlPlaneError(() => unsupported.service.issueDiscoveryCredentials(unsupported.auth, 'eve'), 'provider_account_missing')
  assert.deepEqual(unsupported.issued, [])
  const revoked = providerAccountHarness({memberRevoked: true})
  await assert.rejects(revoked.service.issueDiscoveryCredentials(revoked.auth, 'claude-code'), /membership revoked/)
  assert.deepEqual(revoked.issued, [])
})

test('Codex catalog discovery uses broker-owned file delivery and fails closed if delivery is unavailable', async () => {
  const files = [{path: '/home/user/.codex/auth.json', contents: 'placeholder-refresh-test-fixture', mode: 0o600}]
  for (const deliver of [undefined, 'fail', 'none'] as const) {
    const harness = providerAccountHarness({deliver, bindingConfig: {adapterId: 'codex', providerAccountId: 'account-1', providerAccountOwnerUserId: 'user-1'},
      resolve: async () => ({env: {}, files, provider: 'codex', method: 'subscription'})})
    if (deliver) await assertControlPlaneError(() => harness.service.issueDiscoveryCredentials(harness.auth, 'codex'), deliver === 'fail' ? 'machine_files_failed' : 'machine_files_unavailable')
    else {
      assert.deepEqual(await harness.service.issueDiscoveryCredentials(harness.auth, 'codex'), {env: {}})
      assert.deepEqual(harness.delivered, [{workspaceId: 'workspace-1', environmentId: 'environment-cloud', files}])
    }
  }
})
