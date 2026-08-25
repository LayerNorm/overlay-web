import 'server-only'

import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature,
} from 'node:crypto'
import { posix, win32 } from 'node:path'
import {
  AGENT_ENVIRONMENT_CREDENTIAL_AUDIENCE,
  AGENT_ENVIRONMENT_CREDENTIAL_METHODS,
  canManageWorkspace,
  type AgentEnvironment,
  type AgentEnvironmentCredential,
  type AgentEnvironmentCredentialMethod,
  type AgentFilesystemGrant,
} from '@overlay/workspace-contracts'
import type { ObjectStore } from '@overlay/app-core'
import {
  MAX_HOST_REQUEST_BYTES,
  MAX_COMMAND_BYTES,
  canonicalEnrollmentProof,
  canonicalHostRequestProof,
  agentHostCommandSchema,
  filesystemGrantSchema,
  hostRequestProofHeadersSchema,
  type EnvironmentCredentialResponse,
  type EnrollmentRequest,
  type CommandAcknowledgement,
  type EventBatch,
  type HostCapabilities,
  type ArtifactUploadRequest,
} from '@overlay/agent-bridge-protocol'
import type { AuditService } from '@/server/admin'
import { getOverlayRuntimeConfig } from '@/server/config'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { ConnectedAgentRepository } from './ConnectedAgentRepository'

const ENROLLMENT_TTL_MS = 10 * 60_000
const PROOF_CHALLENGE_TTL_MS = 15 * 60_000
const CREDENTIAL_TTL_MS = 15 * 60_000
const REQUEST_CLOCK_SKEW_MS = 60_000
const PROOF_NONCE_TTL_MS = 2 * 60_000
const INTERACTIVE_QUEUE_TTL_MS = 2 * 60_000
const ARTIFACT_UPLOAD_TTL_MS = 5 * 60_000
const ARTIFACT_RETENTION_MS = 30 * 24 * 60 * 60_000
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024

const PHRASE_WORDS = [
  'amber', 'birch', 'cedar', 'coral', 'dawn', 'ember', 'fern', 'harbor',
  'indigo', 'juniper', 'maple', 'meadow', 'ocean', 'olive', 'orchid', 'pebble',
  'quartz', 'river', 'sage', 'silver', 'spruce', 'stone', 'sunset', 'tulip',
  'violet', 'willow', 'winter', 'yellow', 'zenith', 'cloud', 'forest', 'island',
] as const

export class ConnectedAgentControlPlaneError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'ConnectedAgentControlPlaneError'
  }
}

export type HostAuthentication = {
  credential: AgentEnvironmentCredential
  environment: AgentEnvironment
}

type RemoteAgentUsageSettlement = {
  forceFreeTierLimits: boolean
  inputTokens: number
  modelId: string
  operationId: string
  outcome: 'completed' | 'failed' | 'cancelled' | 'timeout'
  outputTokens: number
  reservationId: string | null
  userId: string
}

export class ConnectedAgentControlPlaneService {
  constructor(private readonly dependencies: {
    audit: AuditService
    repository: ConnectedAgentRepository
    workspaces: WorkspaceService
    objectStore?: ObjectStore
    now?: () => number
    isEnabled?: () => boolean | Promise<boolean>
    settleUsage?: (input: RemoteAgentUsageSettlement) => Promise<void>
  }) {}

  async createEnrollmentSession(args: { actorUserId: string; workspaceId: string }) {
    await this.assertEnabled()
    const access = await this.requireManager(args.actorUserId, args.workspaceId)
    const now = this.now()
    const code = randomSecret()
    const record = await this.dependencies.repository.createEnrollmentSession({
      id: randomUUID(),
      workspaceId: access.workspace.id,
      createdByUserId: args.actorUserId,
      codeHash: sha256(code),
      verificationPhrase: verificationPhrase(),
      status: 'created',
      expiresAt: now + ENROLLMENT_TTL_MS,
      createdAt: now,
      updatedAt: now,
    })
    await this.audit('agent_environment.enrollment_created', 'user', args.actorUserId, {
      workspaceId: record.workspaceId,
      enrollmentSessionId: record.id,
      expiresAt: record.expiresAt,
    }, record.id)
    return { code, expiresAt: record.expiresAt, enrollmentSessionId: record.id }
  }

  async redeemEnrollment(input: EnrollmentRequest) {
    await this.assertEnabled()
    assertEd25519PublicKey(input.publicKey)
    const now = this.now()
    const proofChallenge = randomSecret()
    const environmentId = randomUUID()
    const result = await this.dependencies.repository.redeemEnrollmentSession({
      codeHash: sha256(input.code),
      now,
      environment: {
        id: environmentId,
        workspaceId: '',
        kind: input.kind,
        name: input.name,
        status: 'pending',
        publicKey: input.publicKey,
        hostVersion: input.hostVersion,
        platform: input.platform,
        capabilities: input.capabilities,
        now,
      },
      proofChallenge: {
        id: randomUUID(),
        workspaceId: '',
        environmentId,
        challengeHash: sha256(proofChallenge),
        expiresAt: now + PROOF_CHALLENGE_TTL_MS,
        createdAt: now,
      },
    })
    if (!result) throw controlPlaneError('Enrollment code is invalid, expired, or already used', 410, 'enrollment_invalid')
    await this.audit('agent_environment.enrolled', 'service', undefined, {
      workspaceId: result.environment.workspaceId,
      enrollmentSessionId: result.enrollment.id,
      environmentId,
      platform: input.platform,
      hostVersion: input.hostVersion,
    }, environmentId)
    return {
      protocolVersion: 1 as const,
      workspaceId: result.environment.workspaceId,
      environmentId,
      verificationPhrase: result.enrollment.verificationPhrase,
      proofChallenge,
      proofChallengeExpiresAt: result.proofChallenge.expiresAt,
    }
  }

  async listEnvironments(args: { actorUserId: string; workspaceId: string }) {
    await this.assertEnabled()
    await this.dependencies.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const environments = await this.dependencies.repository.listEnvironments({ workspaceId: args.workspaceId })
    return await Promise.all(environments.map(async (environment) => {
      const enrollment = environment.status === 'pending'
        ? await this.dependencies.repository.getEnvironmentEnrollment({
            workspaceId: args.workspaceId,
            environmentId: environment.id,
          })
        : null
      return {
        ...publicEnvironment(environment),
        ...(enrollment ? {
          verificationPhrase: enrollment.verificationPhrase,
          enrollmentExpiresAt: enrollment.enrollmentExpiresAt,
        } : {}),
      }
    }))
  }

  async approveEnvironment(args: {
    actorUserId: string
    workspaceId: string
    environmentId: string
    filesystemGrant: AgentFilesystemGrant
  }) {
    await this.assertEnabled()
    await this.requireManager(args.actorUserId, args.workspaceId)
    const grant = validateFilesystemGrant(args.filesystemGrant)
    const environment = await this.dependencies.repository.approveEnvironment({
      workspaceId: args.workspaceId,
      environmentId: args.environmentId,
      approvedByUserId: args.actorUserId,
      filesystemGrant: grant,
      now: this.now(),
    })
    if (!environment) throw controlPlaneError('Environment not found', 404, 'environment_not_found')
    await this.audit('agent_environment.approved', 'user', args.actorUserId, {
      workspaceId: args.workspaceId,
      environmentId: args.environmentId,
      filesystemGrant: grant,
    }, args.environmentId)
    return publicEnvironment(environment)
  }

  async updateFilesystemGrant(args: {
    actorUserId: string
    workspaceId: string
    environmentId: string
    filesystemGrant: AgentFilesystemGrant
  }) {
    await this.assertEnabled()
    await this.requireManager(args.actorUserId, args.workspaceId)
    const grant = validateFilesystemGrant(args.filesystemGrant)
    const environment = await this.dependencies.repository.updateEnvironmentFilesystemGrant({
      workspaceId: args.workspaceId,
      environmentId: args.environmentId,
      filesystemGrant: grant,
      now: this.now(),
    })
    if (!environment) throw controlPlaneError('Environment not found', 404, 'environment_not_found')
    await this.audit('agent_environment.scope_changed', 'user', args.actorUserId, {
      workspaceId: args.workspaceId,
      environmentId: args.environmentId,
      filesystemGrant: grant,
    }, args.environmentId)
    return publicEnvironment(environment)
  }

  async revokeEnvironment(args: { actorUserId: string; workspaceId: string; environmentId: string }) {
    await this.assertEnabled()
    await this.requireManager(args.actorUserId, args.workspaceId)
    const revoked = await this.dependencies.repository.revokeEnvironment({
      workspaceId: args.workspaceId,
      environmentId: args.environmentId,
      now: this.now(),
    })
    if (!revoked) throw controlPlaneError('Environment not found', 404, 'environment_not_found')
    await this.audit('agent_environment.revoked', 'user', args.actorUserId, {
      workspaceId: args.workspaceId,
      environmentId: args.environmentId,
    }, args.environmentId)
  }

  async listBindings(args: { actorUserId: string; workspaceId: string; agentId?: string }) {
    await this.assertEnabled()
    await this.requireManager(args.actorUserId, args.workspaceId)
    return await this.dependencies.repository.listBindings({
      workspaceId: args.workspaceId,
      ...(args.agentId ? { agentId: args.agentId } : {}),
    })
  }

  async upsertBinding(args: {
    actorUserId: string
    workspaceId: string
    agentId: string
    environmentId: string
    adapterId: string
    workingDirectory: string
  }) {
    await this.assertEnabled()
    await this.requireManager(args.actorUserId, args.workspaceId)
    if (!args.agentId.trim() || args.agentId.length > 256 ||
      !args.environmentId.trim() || args.environmentId.length > 256 ||
      !args.adapterId.trim() || args.adapterId.length > 128 ||
      !args.workingDirectory.trim() || args.workingDirectory.length > 4_096) {
      throw controlPlaneError('Agent binding fields are invalid', 400, 'binding_invalid')
    }
    const environment = await this.dependencies.repository.getEnvironment({
      workspaceId: args.workspaceId,
      environmentId: args.environmentId,
    })
    if (!environment || environment.status === 'pending' || environment.status === 'revoked' || !environment.approvedAt) {
      throw controlPlaneError('Environment is unavailable', 409, 'environment_unavailable')
    }
    this.assertWorkingDirectory(environment, args.workingDirectory)
    const adapters = Array.isArray(environment.capabilities.adapters)
      ? environment.capabilities.adapters as Array<Record<string, unknown>> : []
    const adapter = adapters.find((candidate) => candidate.id === args.adapterId)
    if (!adapter || adapter.protocol !== 'acp') {
      throw controlPlaneError('The selected ACP adapter is not installed on this environment', 409, 'adapter_unavailable')
    }
    const now = this.now()
    const binding = await this.dependencies.repository.upsertBinding({
      id: randomUUID(),
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      environmentId: args.environmentId,
      protocolAdapter: 'acp',
      adapterConfig: { adapterId: args.adapterId, workingDirectory: args.workingDirectory },
      enabled: true,
      now,
    })
    await this.audit('agent_binding.upserted', 'user', args.actorUserId, {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      environmentId: args.environmentId,
      adapterId: args.adapterId,
      workingDirectory: args.workingDirectory,
    }, binding.id, 'agent_binding')
    return binding
  }

  async disableBindings(args: { actorUserId: string; workspaceId: string; agentId: string }) {
    await this.assertEnabled()
    await this.requireManager(args.actorUserId, args.workspaceId)
    const disabled = await this.dependencies.repository.disableBindingsForAgent({
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      now: this.now(),
    })
    if (disabled) {
      await this.audit('agent_binding.disabled', 'user', args.actorUserId, {
        workspaceId: args.workspaceId,
        agentId: args.agentId,
      }, args.agentId, 'agent_binding')
    }
    return disabled
  }

  async controlRemoteTurn(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
    runId: string
    action: 'cancel' | 'retry' | 'resume' | 'start_fresh'
  }) {
    await this.assertEnabled()
    const now = this.now()
    const result = await this.dependencies.repository.controlRemoteAgentTurn({
      ...args,
      now,
      queueExpiresAt: now + INTERACTIVE_QUEUE_TTL_MS,
    })
    if (!result.applied) throw controlPlaneError('Queued remote run was not found', 404, 'remote_run_not_found')
    if (result.terminal?.reservationId && this.dependencies.settleUsage) await this.dependencies.settleUsage(result.terminal)
    await this.audit(`agent_remote_run.${args.action}`, 'user', args.actorUserId, {
      workspaceId: args.workspaceId, conversationId: args.conversationId, runId: args.runId,
      commandId: result.commandId,
    }, args.runId, 'agent_remote_run')
    return result
  }

  async resolveRemoteRequest(args: {
    actorUserId: string
    workspaceId: string
    conversationId: string
    runId: string
    requestKey: string
    decision: string
    response?: Record<string, unknown>
  }) {
    await this.assertEnabled()
    const result = await this.dependencies.repository.resolveRemoteRequest({ ...args, now: this.now() })
    if (!result.applied) throw controlPlaneError('This agent request is no longer pending or you are not authorized to resolve it', 409, 'remote_request_not_pending')
    await this.audit('agent_remote_request.resolved', 'user', args.actorUserId, {
      workspaceId: args.workspaceId, conversationId: args.conversationId, runId: args.runId,
      requestKey: args.requestKey, decision: args.decision,
    }, args.requestKey, 'agent_remote_request')
    return result
  }

  async createArtifactUpload(auth: HostAuthentication, input: ArtifactUploadRequest) {
    const objectStore = this.requireObjectStore()
    const now = this.now()
    const name = safeArtifactName(input.name)
    const mediaType = safeArtifactMediaType(input.mediaType)
    if (input.size < 1 || input.size > MAX_ARTIFACT_BYTES) throw controlPlaneError('Artifact size is outside the allowed range', 413, 'artifact_size_invalid')
    const session = await this.dependencies.repository.getRemoteSessionForRun({
      workspaceId: auth.credential.workspaceId, environmentId: auth.environment.id, runId: input.runId,
    })
    if (!session || ['completed', 'failed', 'cancelled'].includes(session.status)) throw controlPlaneError('Remote session is not active', 409, 'remote_session_inactive')
    const artifactId = `artifact_${randomUUID()}`
    const objectKey = `workspaces/${encodeURIComponent(auth.credential.workspaceId)}/agent-artifacts/${encodeURIComponent(auth.environment.id)}/${encodeURIComponent(input.runId)}/${artifactId}`
    const artifact = await this.dependencies.repository.createArtifact({
      id: artifactId, workspaceId: auth.credential.workspaceId, environmentId: auth.environment.id,
      runId: input.runId, remoteSessionId: session.id, name, mediaType, size: input.size,
      sha256: input.sha256, objectKey, status: 'pending_upload', expiresAt: now + ARTIFACT_UPLOAD_TTL_MS,
      createdAt: now, updatedAt: now,
    })
    const checksum = Buffer.from(input.sha256, 'hex').toString('base64')
    const upload = await objectStore.getUploadUrl(objectKey, mediaType, {
      expiresIn: ARTIFACT_UPLOAD_TTL_MS / 1_000, contentLength: input.size, checksumSha256: input.sha256,
    })
    return { protocolVersion: 1 as const, artifactId: artifact.id, uploadReference: artifact.id,
      uploadUrl: upload.url, headers: { 'content-type': mediaType, 'x-amz-checksum-sha256': checksum },
      expiresAt: now + ARTIFACT_UPLOAD_TTL_MS }
  }

  async completeArtifactUpload(auth: HostAuthentication, uploadReference: string) {
    const objectStore = this.requireObjectStore()
    const now = this.now()
    const artifact = await this.dependencies.repository.getArtifact({
      workspaceId: auth.credential.workspaceId, environmentId: auth.environment.id, artifactId: uploadReference,
    })
    if (!artifact) throw controlPlaneError('Artifact upload was not found', 404, 'artifact_not_found')
    if (artifact.status === 'clean' || artifact.status === 'linked') return artifact
    if (artifact.status !== 'pending_upload' || artifact.createdAt + ARTIFACT_UPLOAD_TTL_MS < now) {
      throw controlPlaneError('Artifact upload is no longer completable', 409, 'artifact_upload_expired')
    }
    if (!objectStore.headObject || !objectStore.downloadBuffer) throw controlPlaneError('Object store cannot validate agent artifacts', 503, 'artifact_validation_unavailable')
    const metadata = await objectStore.headObject(artifact.objectKey)
    if (!metadata || metadata.sizeBytes !== artifact.size || normalizeMediaType(metadata.contentType) !== normalizeMediaType(artifact.mediaType)) {
      await this.rejectArtifact(artifact, 'metadata_mismatch')
      throw controlPlaneError('Uploaded artifact metadata does not match the intent', 409, 'artifact_metadata_mismatch')
    }
    const bytes = await objectStore.downloadBuffer(artifact.objectKey, MAX_ARTIFACT_BYTES)
    const checksum = createHash('sha256').update(bytes).digest('hex')
    if (checksum !== artifact.sha256) {
      await this.rejectArtifact(artifact, 'checksum_mismatch')
      throw controlPlaneError('Uploaded artifact checksum does not match the intent', 409, 'artifact_checksum_mismatch')
    }
    const scan = scanArtifact(bytes, artifact.mediaType)
    if (!scan.clean) {
      await this.rejectArtifact(artifact, scan.result)
      throw controlPlaneError('Uploaded artifact failed malware validation', 422, 'artifact_malware_rejected')
    }
    const finalized = await this.dependencies.repository.finalizeArtifact({
      workspaceId: artifact.workspaceId, environmentId: artifact.environmentId, artifactId: artifact.id,
      status: 'clean', scanResult: scan.result, expiresAt: now + ARTIFACT_RETENTION_MS, now,
    })
    if (!finalized) throw controlPlaneError('Artifact state changed while validating', 409, 'artifact_state_conflict')
    return finalized
  }

  async getArtifactDownload(args: { actorUserId: string; workspaceId: string; artifactId: string }) {
    const artifact = await this.dependencies.repository.getArtifactForDownload(args)
    if (!artifact) throw controlPlaneError('Artifact was not found', 404, 'artifact_not_found')
    return { artifact, url: await this.requireObjectStore().getDownloadUrl(artifact.objectKey) }
  }

  async cleanupArtifacts(limit = 100) {
    const now = this.now()
    const artifacts = await this.dependencies.repository.listArtifactsForCleanup({ now, limit })
    for (const artifact of artifacts) {
      await this.requireObjectStore().deleteObject(artifact.objectKey)
      await this.dependencies.repository.markArtifactDeleted({ artifactId: artifact.id, now })
    }
    return { deleted: artifacts.length }
  }

  async sweepRemoteRuns() {
    const now = this.now()
    const result = await this.dependencies.repository.sweepRemoteRuns({
      now, hostOfflineBefore: now - 90_000, limit: 100,
    })
    if (this.dependencies.settleUsage) for (const settlement of result.settlements) {
      if (settlement.reservationId) await this.dependencies.settleUsage(settlement)
    }
    return result
  }

  async issueInitialCredential(args: {
    environmentId: string
    proofChallenge: string
    signature: string
  }): Promise<EnvironmentCredentialResponse> {
    await this.assertEnabled()
    const now = this.now()
    const pending = await this.dependencies.repository.getEnvironmentProofChallenge({
      environmentId: args.environmentId,
      now,
    })
    if (!pending) throw controlPlaneError('Environment is awaiting approval or its proof expired', 425, 'environment_pending')
    if (sha256(args.proofChallenge) !== pending.proofChallenge.challengeHash) {
      throw controlPlaneError('Proof challenge is invalid', 401, 'proof_invalid')
    }
    verifyDeviceSignature(
      pending.environment.publicKey,
      canonicalEnrollmentProof(args.environmentId, args.proofChallenge),
      args.signature,
    )
    const { credential, token } = createCredential(pending.environment, now)
    const issued = await this.dependencies.repository.issueEnvironmentCredential({
      workspaceId: pending.environment.workspaceId,
      environmentId: pending.environment.id,
      proofChallengeId: pending.proofChallenge.id,
      proofChallengeHash: pending.proofChallenge.challengeHash,
      credential,
      now,
    })
    if (!issued) throw controlPlaneError('Proof challenge was already used or expired', 409, 'proof_replayed')
    await this.audit('agent_environment.credential_issued', 'service', undefined, {
      workspaceId: issued.workspaceId,
      environmentId: issued.environmentId,
      credentialId: issued.id,
      expiresAt: issued.expiresAt,
    }, issued.environmentId)
    return credentialResponse(issued, token, pending.environment.filesystemGrant!)
  }

  async authenticateHostRequest(args: {
    request: Request
    environmentId: string
    requiredMethod: AgentEnvironmentCredentialMethod
    rawBody: Uint8Array
  }): Promise<HostAuthentication> {
    await this.assertEnabled()
    if (args.rawBody.byteLength > MAX_HOST_REQUEST_BYTES) {
      throw controlPlaneError('Request body is too large', 413, 'request_too_large')
    }
    const authorization = args.request.headers.get('authorization') ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    if (!token) throw controlPlaneError('Environment credential is required', 401, 'credential_required')
    const headers = hostRequestProofHeadersSchema.safeParse({
      timestamp: args.request.headers.get('x-overlay-agent-timestamp'),
      nonce: args.request.headers.get('x-overlay-agent-nonce'),
      signature: args.request.headers.get('x-overlay-agent-signature'),
    })
    if (!headers.success) throw controlPlaneError('Device request proof is invalid', 401, 'proof_invalid')
    const now = this.now()
    const timestamp = Number(headers.data.timestamp)
    if (Math.abs(now - timestamp) > REQUEST_CLOCK_SKEW_MS) {
      throw controlPlaneError('Device request proof has expired', 401, 'proof_expired')
    }
    const tokenHash = sha256(token)
    const credential = await this.dependencies.repository.findEnvironmentCredential({ tokenHash })
    if (!credential || credential.revokedAt || credential.expiresAt <= now ||
      credential.audience !== AGENT_ENVIRONMENT_CREDENTIAL_AUDIENCE ||
      credential.environmentId !== args.environmentId ||
      !credential.methods.includes(args.requiredMethod)) {
      throw controlPlaneError('Environment credential is invalid or expired', 401, 'credential_invalid')
    }
    const environment = await this.dependencies.repository.getEnvironment({
      workspaceId: credential.workspaceId,
      environmentId: credential.environmentId,
    })
    if (!environment || environment.status === 'revoked' || !environment.approvedAt || !environment.filesystemGrant) {
      throw controlPlaneError('Environment is revoked or unavailable', 401, 'environment_unavailable')
    }
    const requestUrl = new URL(args.request.url)
    const canonical = canonicalHostRequestProof({
      method: args.request.method,
      pathname: `${requestUrl.pathname}${requestUrl.search}`,
      timestamp: headers.data.timestamp,
      nonce: headers.data.nonce,
      bodySha256: sha256(args.rawBody),
      tokenSha256: tokenHash,
    })
    verifyDeviceSignature(environment.publicKey, canonical, headers.data.signature)
    const consumed = await this.dependencies.repository.consumeEnvironmentProofNonce({
      credentialId: credential.id,
      nonceHash: sha256(headers.data.nonce),
      expiresAt: now + PROOF_NONCE_TTL_MS,
      now,
    })
    if (!consumed) throw controlPlaneError('Device request proof was already used', 409, 'proof_replayed')
    return { credential, environment }
  }

  async refreshCredential(auth: HostAuthentication): Promise<EnvironmentCredentialResponse> {
    const now = this.now()
    const { credential, token } = createCredential(auth.environment, now)
    const rotated = await this.dependencies.repository.rotateEnvironmentCredential({
      currentCredentialId: auth.credential.id,
      credential,
      now,
    })
    if (!rotated) throw controlPlaneError('Environment credential can no longer be refreshed', 401, 'credential_invalid')
    return credentialResponse(rotated, token, auth.environment.filesystemGrant!)
  }

  async heartbeat(auth: HostAuthentication) {
    const environment = await this.dependencies.repository.heartbeatEnvironment({
      workspaceId: auth.credential.workspaceId,
      environmentId: auth.credential.environmentId,
      now: this.now(),
    })
    if (!environment) throw controlPlaneError('Environment is unavailable', 401, 'environment_unavailable')
    return publicEnvironment(environment)
  }

  async updateCapabilities(auth: HostAuthentication, capabilities: HostCapabilities) {
    const environment = await this.dependencies.repository.updateEnvironmentCapabilities({
      workspaceId: auth.credential.workspaceId,
      environmentId: auth.credential.environmentId,
      capabilities: { ...capabilities, filesystem: auth.environment.filesystemGrant },
      now: this.now(),
    })
    if (!environment) throw controlPlaneError('Environment is unavailable', 401, 'environment_unavailable')
    return publicEnvironment(environment)
  }

  async pollCommands(auth: HostAuthentication, limit: number) {
    const commands = await this.dependencies.repository.claimCommands({
      workspaceId: auth.credential.workspaceId,
      environmentId: auth.credential.environmentId,
      now: this.now(),
      leaseMs: 30_000,
      limit: Math.max(1, Math.min(limit, 50)),
    })
    return commands.map((command) => {
      if (new TextEncoder().encode(JSON.stringify(command)).byteLength > MAX_COMMAND_BYTES) {
        throw controlPlaneError('Queued command exceeds the bridge protocol byte limit', 413, 'command_too_large')
      }
      const parsed = agentHostCommandSchema.safeParse({
        protocolVersion: 1,
        commandId: command.id,
        environmentId: command.environmentId,
        workspaceId: command.workspaceId,
        runId: command.runId,
        sequence: command.sequence,
        issuedAt: command.createdAt,
        type: command.type,
        payload: command.payload,
      })
      if (!parsed.success) {
        throw controlPlaneError('Queued command does not conform to bridge protocol', 409, 'command_invalid')
      }
      if (parsed.data.type === 'start') {
        this.assertWorkingDirectory(auth.environment, parsed.data.payload.workingDirectory)
      }
      return parsed.data
    })
  }

  async acknowledgeCommand(auth: HostAuthentication, acknowledgement: CommandAcknowledgement) {
    if (acknowledgement.environmentId !== auth.environment.id) {
      throw controlPlaneError('Command acknowledgement scope does not match credential', 403, 'command_scope_mismatch')
    }
    const updated = await this.dependencies.repository.acknowledgeCommand({
      workspaceId: auth.credential.workspaceId,
      environmentId: auth.credential.environmentId,
      commandId: acknowledgement.commandId,
      accepted: acknowledgement.accepted,
      now: this.now(),
    })
    if (!updated) throw controlPlaneError('Command was not found or is no longer acknowledgeable', 409, 'command_acknowledgement_rejected')
  }

  async applyEvents(auth: HostAuthentication, batch: EventBatch) {
    if (batch.environmentId !== auth.environment.id) {
      throw controlPlaneError('Event batch scope does not match credential', 403, 'event_scope_mismatch')
    }
    const session = await this.dependencies.repository.getRemoteSessionForRun({
      workspaceId: auth.credential.workspaceId,
      environmentId: auth.credential.environmentId,
      runId: batch.runId,
    })
    if (!session) throw controlPlaneError('Remote session was not found', 404, 'remote_session_not_found')
    const result = await this.dependencies.repository.applyRemoteEvents({
      workspaceId: auth.credential.workspaceId,
      environmentId: auth.credential.environmentId,
      sessionId: session.id,
      events: batch.events,
      now: this.now(),
    })
    if (result.accepted && result.terminal?.reservationId && this.dependencies.settleUsage) {
      await this.dependencies.settleUsage(result.terminal)
    }
    return result
  }

  assertWorkingDirectory(environment: AgentEnvironment, workingDirectory: string): void {
    const grant = environment.filesystemGrant
    if (!grant) throw controlPlaneError('Environment has no filesystem grant', 403, 'filesystem_scope_required')
    if (grant.mode === 'all_user_files') return
    if (!grant.roots.some((root) => isPathInside(root, workingDirectory))) {
      throw controlPlaneError('Command working directory is outside the approved roots', 403, 'filesystem_scope_denied')
    }
  }

  private async requireManager(userId: string, workspaceId: string) {
    const access = await this.dependencies.workspaces.resolveActiveWorkspace(userId, workspaceId)
    if (!canManageWorkspace(access.membership.role)) {
      throw controlPlaneError('Workspace owner or admin access is required', 403, 'workspace_manager_required')
    }
    return access
  }

  private async assertEnabled() {
    if (this.dependencies.isEnabled) {
      if (!await this.dependencies.isEnabled()) {
        throw controlPlaneError('Connected agent control plane is disabled', 404, 'feature_disabled')
      }
      return
    }
    const runtime = await getOverlayRuntimeConfig()
    if (runtime.features.connectedAgentControlPlane !== true) {
      throw controlPlaneError('Connected agent control plane is disabled', 404, 'feature_disabled')
    }
  }

  private now() { return this.dependencies.now?.() ?? Date.now() }

  private requireObjectStore() {
    if (!this.dependencies.objectStore) throw controlPlaneError('Object storage is unavailable', 503, 'object_storage_unavailable')
    return this.dependencies.objectStore
  }

  private async rejectArtifact(artifact: { id: string; workspaceId: string; environmentId: string; objectKey: string }, result: string) {
    await this.dependencies.repository.finalizeArtifact({ workspaceId: artifact.workspaceId,
      environmentId: artifact.environmentId, artifactId: artifact.id, status: 'rejected', scanResult: result, now: this.now() })
    await this.requireObjectStore().deleteObject(artifact.objectKey).catch((_error) => undefined)
  }

  private async audit(
    action: string,
    actorType: 'user' | 'service',
    actorUserId: string | undefined,
    metadata: Record<string, unknown>,
    resourceId: string,
    resourceType = 'agent_environment',
  ) {
    await this.dependencies.audit.record({
      action,
      actorType,
      actorUserId,
      metadata,
      outcome: 'success',
      resourceId,
      resourceType,
    })
  }
}

function createCredential(environment: AgentEnvironment, now: number) {
  const token = randomSecret()
  const credential: AgentEnvironmentCredential = {
    id: randomUUID(),
    workspaceId: environment.workspaceId,
    environmentId: environment.id,
    tokenHash: sha256(token),
    audience: AGENT_ENVIRONMENT_CREDENTIAL_AUDIENCE,
    methods: [...AGENT_ENVIRONMENT_CREDENTIAL_METHODS],
    tokenNonce: randomSecret(16),
    expiresAt: now + CREDENTIAL_TTL_MS,
    createdAt: now,
  }
  return { credential, token }
}

function credentialResponse(
  credential: AgentEnvironmentCredential,
  token: string,
  filesystemGrant: AgentFilesystemGrant,
): EnvironmentCredentialResponse {
  return {
    protocolVersion: 1,
    workspaceId: credential.workspaceId,
    environmentId: credential.environmentId,
    audience: credential.audience,
    methods: credential.methods,
    token,
    expiresAt: credential.expiresAt,
    filesystemGrant,
  }
}

function publicEnvironment(environment: AgentEnvironment) {
  const { publicKey: _publicKey, ...safe } = environment
  return safe
}

function validateFilesystemGrant(input: AgentFilesystemGrant): AgentFilesystemGrant {
  const parsed = filesystemGrantSchema.safeParse(input)
  if (!parsed.success) throw controlPlaneError('A valid explicit filesystem grant is required', 400, 'filesystem_grant_invalid')
  if (parsed.data.mode === 'all_user_files') return parsed.data
  const roots = [...new Set(parsed.data.roots.map((root) => root.trim()))]
  for (const root of roots) {
    if (root.length > 2_048 || !isAbsoluteHostPath(root) || isFilesystemRoot(root)) {
      throw controlPlaneError('Project roots must be absolute, scoped paths', 400, 'filesystem_root_invalid')
    }
  }
  return { mode: 'selected_roots', roots }
}

function isAbsoluteHostPath(value: string) {
  return posix.isAbsolute(value) || win32.isAbsolute(value)
}

function isFilesystemRoot(value: string) {
  if (posix.isAbsolute(value)) return posix.normalize(value) === '/'
  if (win32.isAbsolute(value)) return win32.dirname(win32.normalize(value)) === win32.normalize(value)
  return false
}

function isPathInside(root: string, candidate: string) {
  const windows = win32.isAbsolute(root)
  const path = windows ? win32 : posix
  if (!path.isAbsolute(candidate)) return false
  const normalizedRoot = path.resolve(root)
  const normalizedCandidate = path.resolve(candidate)
  const relative = path.relative(normalizedRoot, normalizedCandidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function assertEd25519PublicKey(publicKey: string) {
  try {
    const key = createPublicKey(publicKey)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type')
  } catch (_error) {
    throw controlPlaneError('A valid Ed25519 public key is required', 400, 'public_key_invalid')
  }
}

function verifyDeviceSignature(publicKey: string | undefined, value: string, signature: string) {
  if (!publicKey) throw controlPlaneError('Environment has no device key', 401, 'proof_invalid')
  let valid = false
  try {
    valid = verifySignature(null, Buffer.from(value), createPublicKey(publicKey), Buffer.from(signature, 'base64url'))
  } catch (_error) {
    valid = false
  }
  if (!valid) throw controlPlaneError('Device signature is invalid', 401, 'proof_invalid')
}

function randomSecret(bytes = 32) { return randomBytes(bytes).toString('base64url') }
function sha256(value: string | Uint8Array) { return createHash('sha256').update(value).digest('hex') }
function safeArtifactName(value: string) {
  const name = value.trim()
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /[\u0000-\u001f]/.test(name)) {
    throw controlPlaneError('Artifact name is invalid', 400, 'artifact_name_invalid')
  }
  return name
}
function safeArtifactMediaType(value: string) {
  const mediaType = normalizeMediaType(value)
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mediaType)
    || ['application/x-msdownload', 'application/x-executable', 'application/x-sh'].includes(mediaType)) {
    throw controlPlaneError('Artifact media type is not allowed', 400, 'artifact_media_type_invalid')
  }
  return mediaType
}
function normalizeMediaType(value: string | undefined) { return (value ?? '').split(';', 1)[0]!.trim().toLowerCase() }
function scanArtifact(bytes: Uint8Array, mediaType: string): { clean: boolean; result: string } {
  const prefix = bytes.slice(0, Math.min(bytes.byteLength, 8_192))
  const text = new TextDecoder('utf-8', { fatal: false }).decode(prefix)
  if (text.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) return { clean: false, result: 'eicar_signature' }
  const executableMagic = (prefix[0] === 0x4d && prefix[1] === 0x5a)
    || (prefix[0] === 0x7f && prefix[1] === 0x45 && prefix[2] === 0x4c && prefix[3] === 0x46)
  if (executableMagic && !normalizeMediaType(mediaType).includes('wasm')) return { clean: false, result: 'executable_binary' }
  return { clean: true, result: 'signature_scan_clean' }
}
function verificationPhrase() {
  const bytes = randomBytes(3)
  return [...bytes].map((value) => PHRASE_WORDS[value % PHRASE_WORDS.length]).join('-')
}
function controlPlaneError(message: string, statusCode: number, code: string) {
  return new ConnectedAgentControlPlaneError(message, statusCode, code)
}
