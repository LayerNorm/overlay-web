import 'server-only'

import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalEnrollmentProof, canonicalHostRequestProof, MAX_HOST_REQUEST_BYTES } from '@layernorm/overlay-agent-bridge-protocol'
import { AGENT_ENVIRONMENT_CREDENTIAL_METHODS } from '@overlay/workspace-contracts'
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

function fixture(overrides: Partial<AgentEnvironment> = {}, credentialOverrides: Partial<AgentEnvironmentCredential> = {}) {
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
  const repository = {
    async findEnvironmentCredential({ tokenHash }: { tokenHash: string }) {
      return tokenHash === credential.tokenHash ? credential : null
    },
    async getEnvironment(args: { workspaceId: string; environmentId: string }) {
      return args.workspaceId === environment.workspaceId && args.environmentId === environment.id
        ? environment
        : null
    },
    async consumeEnvironmentProofNonce(args: { credentialId: string; nonceHash: string; expiredGraceMs?: number }) {
      if (credential.expiresAt <= NOW && NOW - credential.expiresAt >= (args.expiredGraceMs ?? 0)) return false
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
  resolve?: () => Promise<{ env: Record<string, string>; provider: 'claude-code'; method: 'subscription' }>
} = {}) {
  const environment: AgentEnvironment = {
    id: 'environment-cloud', workspaceId: 'workspace-1', kind: options.environmentKind ?? 'overlay_cloud',
    name: 'Cloud machine', status: 'online', publicKey: 'public-key',
    capabilities: { adapters: [{ id: 'claude-code', protocol: 'acp' }, { id: 'hermes', protocol: 'acp' }] },
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
      async listBindings() { return [binding] },
    } as unknown as ConnectedAgentRepository,
    audit: { record: async () => {} } as unknown as AuditService,
    workspaces: { async resolveActiveWorkspace() { return { membership: { role: 'admin' } } } } as unknown as WorkspaceService,
    agentProviderAccounts: {
      async requireUsable(args: { userId: string; accountId: string; provider: string }) {
        if (args.accountId !== 'account-1' || args.userId !== 'user-1') throw Object.assign(new Error('Account not found'), { statusCode: 404 })
        return {} as never
      },
      async resolveRunEnvironment(args: { accountId: string; ownerUserId: string; expectedProvider: string }) {
        issued.push(args)
        return await (options.resolve ?? (async () => ({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'secret-token' }, provider: 'claude-code' as const, method: 'subscription' as const })))()
      },
      async markNeedsReauth(accountId: string) { reauth.push(accountId) },
    },
    now: () => NOW,
    isEnabled: () => true,
  })
  const auth = {
    environment,
    credential: { id: 'credential-1', workspaceId: 'workspace-1', environmentId: environment.id, methods: ['agent:run-credentials'] },
  } as unknown as HostAuthentication
  return { service, auth, upserts, reauth, issued }
}

test('a binding records the account and who chose it, and refuses accounts that are not the actor\'s', async () => {
  const { service, upserts } = providerAccountHarness()
  const base = { actorUserId: 'user-1', workspaceId: 'workspace-1', agentId: 'agent-1', environmentId: 'environment-cloud', adapterId: 'claude-code', workingDirectory: '/home/user/workspace' }
  await service.upsertBinding({ ...base, providerAccountId: 'account-1' })
  assert.equal(upserts[0]?.adapterConfig.providerAccountId, 'account-1')
  assert.equal(upserts[0]?.adapterConfig.providerAccountOwnerUserId, 'user-1')
  await assertControlPlaneError(() => service.upsertBinding({ ...base, providerAccountId: 'someone-elses' }), 'provider_account_invalid')
  await assertControlPlaneError(() => service.upsertBinding({ ...base, adapterId: 'hermes', providerAccountId: 'account-1' }), 'provider_account_unsupported')
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
  const issue = async (kind: AgentEnvironment['kind']) => {
    const issued: string[][] = []
    const environment = fixture({ kind }).environment
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
      workspaces: {} as WorkspaceService, now: () => NOW, isEnabled: () => true,
    })
    const signature = sign(null, Buffer.from(canonicalEnrollmentProof(environment.id, 'challenge')), privateKey).toString('base64url')
    await service.issueInitialCredential({ environmentId: environment.id, proofChallenge: 'challenge', signature })
    return issued[0] ?? []
  }
  assert.ok((await issue('overlay_cloud')).includes('agent:run-credentials'))
  assert.equal((await issue('local')).includes('agent:run-credentials'), false)
  assert.equal((await issue('vps')).includes('agent:run-credentials'), false)
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
