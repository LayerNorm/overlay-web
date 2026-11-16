import { effectiveAgentEnvironmentStatus as sharedEffectiveStatus } from '@/shared/agents/environment-status'
import 'server-only'

import {
  createHash,
  createPublicKey,
  randomBytes,
  randomInt,
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
import {
  MAX_HOST_REQUEST_BYTES,
  canonicalEnrollmentProof,
  canonicalHostRequestProof,
  filesystemGrantSchema,
  hostRequestProofHeadersSchema,
  type EnvironmentCredentialResponse,
  type EnrollmentRequest,
  type HostCapabilities,
} from '@layernorm/overlay-agent-bridge-protocol'
import type { AuditService } from '@/server/admin'
import { getOverlayRuntimeConfig } from '@/server/config'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { ConnectedAgentRepository } from './ConnectedAgentRepository'
import type { ConnectedAgentPolicyEntitlements, ConnectedAgentPolicyLimits } from './ConnectedAgentPolicy'

/** How long after expiry a host may still renew its credential, e.g. after a Mac slept overnight. */
const EXPIRED_CREDENTIAL_RENEWAL_MS = 30 * 24 * 60 * 60_000
const ENROLLMENT_TTL_MS = 10 * 60_000
const PROOF_CHALLENGE_TTL_MS = 15 * 60_000
const CREDENTIAL_TTL_MS = 15 * 60_000
const REQUEST_CLOCK_SKEW_MS = 60_000
const PROOF_NONCE_TTL_MS = 2 * 60_000
export { AGENT_ENVIRONMENT_ONLINE_WINDOW_MS } from '@/shared/agents/environment-status'

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

export class ConnectedAgentControlPlaneService {
  constructor(private readonly dependencies: {
    audit: AuditService
    repository: ConnectedAgentRepository
    workspaces: WorkspaceService
    now?: () => number
    /** Whether this deployment lets members connect their own machines (This Mac). */
    isEnabled?: (workspaceId?: string) => boolean | Promise<boolean>
    policyLimits?: (input: { userId: string; workspaceId: string; entitlements?: ConnectedAgentPolicyEntitlements }) => Promise<ConnectedAgentPolicyLimits>
  }) {}

  async createEnrollmentSession(args: { actorUserId: string; workspaceId: string }) {
    await this.assertEnabled(args.workspaceId)
    const access = await this.requireManager(args.actorUserId, args.workspaceId)
    let maxEnvironments: number | undefined
    if (this.dependencies.policyLimits) {
      const [limits, usage] = await Promise.all([
        this.dependencies.policyLimits({ userId: args.actorUserId, workspaceId: args.workspaceId }),
        this.dependencies.repository.getWorkspacePolicyUsage({ workspaceId: args.workspaceId }),
      ])
      if (usage.environments >= limits.maxEnvironments) {
        throw controlPlaneError('This workspace has reached its connected-environment limit', 429, 'environment_limit_reached')
      }
      maxEnvironments = limits.maxEnvironments
    }
    const now = this.now()
    const code = randomSecret()
    const record = await this.dependencies.repository.createEnrollmentSession({
      id: randomUUID(),
      workspaceId: access.workspace.id,
      createdByUserId: args.actorUserId,
      codeHash: sha256(code),
      verificationPhrase: verificationPhrase(),
      status: 'created',
      ...(maxEnvironments === undefined ? {} : { maxEnvironments }),
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
    let result
    try {
      result = await this.dependencies.repository.redeemEnrollmentSession({
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
    } catch (error) {
      throw translatePolicyError(error)
    }
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
    await this.dependencies.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const environments = await this.dependencies.repository.listEnvironments({ workspaceId: args.workspaceId })
    const now = this.now()
    return await Promise.all(environments.map(async (storedEnvironment) => {
      const environment = {
        ...storedEnvironment,
        status: effectiveAgentEnvironmentStatus(storedEnvironment, now),
      }
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
    await this.assertEnabled(args.workspaceId)
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
    await this.assertEnabled(args.workspaceId)
    // The person who connected a Mac can change its folders (internal/develop/thread-folders.md); otherwise a manager.
    const access = await this.dependencies.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    if (!canManageWorkspace(access.membership.role)) {
      const own = (await this.dependencies.repository.listEnvironments({ workspaceId: args.workspaceId }))
        .some(entry => entry.id === args.environmentId && entry.approvedByUserId === args.actorUserId && entry.revokedAt === undefined)
      if (!own) throw controlPlaneError('Workspace owner or admin access is required', 403, 'workspace_manager_required')
    }
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

  async issueInitialCredential(args: {
    environmentId: string
    proofChallenge: string
    signature: string
  }): Promise<EnvironmentCredentialResponse> {
    const now = this.now()
    const pending = await this.dependencies.repository.getEnvironmentProofChallenge({
      environmentId: args.environmentId,
      now,
    })
    if (!pending) throw controlPlaneError('Environment is awaiting approval or its proof expired', 425, 'environment_pending')
    await this.assertEnabled(pending.environment.workspaceId)
    if (pending.environment.kind === 'overlay_cloud') {
      throw controlPlaneError('Hosted Overlay Cloud enrollment is retired', 410, 'hosted_runtime_retired')
    }
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
    // A Mac that slept past its 15-minute credential may still renew it: the refresh route alone accepts an expired,
    // unrevoked credential for 30 days, still behind the device-key signature and a single-use nonce, and renewing
    // revokes it. Every other route needs a live credential.
    const renewal = args.requiredMethod === 'agent:credentials:refresh'
    const expired = Boolean(credential && credential.expiresAt <= now
      && !(renewal && credential.expiresAt > now - EXPIRED_CREDENTIAL_RENEWAL_MS))
    if (!credential || credential.revokedAt || expired ||
      credential.audience !== AGENT_ENVIRONMENT_CREDENTIAL_AUDIENCE ||
      credential.environmentId !== args.environmentId ||
      !credential.methods.includes(args.requiredMethod)) {
      throw controlPlaneError('Environment credential is invalid or expired', 401, 'credential_invalid')
    }
    const environment = credential.environment !== undefined ? credential.environment : await this.dependencies.repository.getEnvironment({
      workspaceId: credential.workspaceId,
      environmentId: credential.environmentId,
    })
    if (!environment || !hasCredentialEnvironmentAuthority({ environment, credential })) {
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
      ...(renewal ? { expiredGraceMs: EXPIRED_CREDENTIAL_RENEWAL_MS } : {}),
    })
    if (!consumed) throw controlPlaneError('Device request proof was already used', 409, 'proof_replayed')
    return { credential, environment }
  }

  async refreshCredential(auth: HostAuthentication): Promise<EnvironmentCredentialResponse> {
    if (auth.environment.kind === 'overlay_cloud') {
      throw controlPlaneError('Hosted Overlay Cloud credential refresh is retired', 410, 'hosted_runtime_retired')
    }
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

  private async requireManager(userId: string, workspaceId: string) {
    const access = await this.dependencies.workspaces.resolveActiveWorkspace(userId, workspaceId)
    if (!canManageWorkspace(access.membership.role)) {
      throw controlPlaneError('Workspace owner or admin access is required', 403, 'workspace_manager_required')
    }
    return access
  }

  /** Connecting a machine follows the Computers feature: a connected Mac is a Computer. */
  private async assertEnabled(workspaceId?: string) {
    const enabled = this.dependencies.isEnabled
      ? await this.dependencies.isEnabled(workspaceId)
      : (await getOverlayRuntimeConfig()).features.computers === true
    if (!enabled) throw controlPlaneError('Connecting a computer is disabled', 404, 'feature_disabled')
  }

  private now() { return this.dependencies.now?.() ?? Date.now() }

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

export function effectiveAgentEnvironmentStatus(
  environment: Pick<AgentEnvironment, 'status' | 'lastSeenAt'>,
  now: number,
): AgentEnvironment['status'] {
  return sharedEffectiveStatus(environment, now)
}

function translatePolicyError(error: unknown) {
  if (error instanceof Error && error.message.includes('CONNECTED_AGENT_POLICY_LIMIT:')) {
    return controlPlaneError('Connected-agent plan limit exceeded', 429, 'connected_agent_policy_limit')
  }
  return error
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

function hasCredentialEnvironmentAuthority({ environment, credential }: {
  environment: AgentEnvironment; credential: AgentEnvironmentCredential
}): boolean {
  return environment.id === credential.environmentId && environment.workspaceId === credential.workspaceId
    && environment.status !== 'revoked' && Boolean(environment.approvedAt && environment.filesystemGrant)
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
function verificationPhrase() {
  return Array.from({length: 3}, () => PHRASE_WORDS[randomInt(PHRASE_WORDS.length)]).join('-')
}
function controlPlaneError(message: string, statusCode: number, code: string) {
  return new ConnectedAgentControlPlaneError(message, statusCode, code)
}
