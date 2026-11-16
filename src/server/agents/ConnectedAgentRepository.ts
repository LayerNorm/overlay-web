import 'server-only'

import type {
  AgentEnrollmentSession, AgentEnvironment, AgentEnvironmentCredential, AgentEnvironmentEnrollmentView,
  AgentEnvironmentProofChallenge, AgentFilesystemGrant, AgentSandboxLease, AgentSandboxLeaseStatus,
} from '@overlay/workspace-contracts'

export type ConnectedAgentCreateEnvironment = Omit<AgentEnvironment, 'createdAt' | 'updatedAt'> & { now: number }
/** Older backends omit the snapshot; null means the credential has no matching environment. */
export type AgentEnvironmentCredentialLookup = AgentEnvironmentCredential & { environment?: AgentEnvironment | null }
export type ConnectedAgentCreateSandboxLease = Omit<AgentSandboxLease, 'createdAt' | 'updatedAt'> & { now: number }
export type ConnectedAgentUpdateSandboxLease = Partial<Pick<
  AgentSandboxLease,
  | 'status' | 'providerReference' | 'reservationId' | 'reservedUntil'
  | 'runtimeStartedAt' | 'runtimeEndedAt' | 'usage' | 'cleanupAttempts' | 'cleanupAfter'
  | 'nextMeterAt' | 'meterClaimToken' | 'meterClaimUntil'
>> & { workspaceId: string; leaseId: string; now: number }

export type ConnectedAgentOperationalAlert = {
  code:
    | 'approval_age'
    | 'cleanup_failure'
    | 'lease_expired'
    | 'offline_environment'
    | 'provider_spend'
    | 'stuck_command'
  workspaceId: string
  agentId?: string
  environmentId?: string
  runId?: string
  commandId?: string
  remoteSessionId?: string
  providerReference?: string
  reservationId?: string
  eventCursor?: number
  ageMs?: number
  providerCostUsd?: number
}

export type ConnectedAgentSandboxBilling = {
  baselineUsage: Record<string, unknown>
  leaseId: string
  provider: string
  providerReference: string
  resources: { diskGiB: number; memoryGiB: number; vcpus: number }
  startedAt: number
}

export type ConnectedAgentSandboxLeasePayer = {
  scope: 'personal' | 'workspace'
  billingAccountId?: string
  userId: string
  workspaceId?: string
  spendSubjectKind?: 'member' | 'programmatic'
  spendSubjectId?: string
}

export type ConnectedAgentSandboxMeterCharge = {
  costCents: number
  durationSeconds: number
  modelId: string
  providerCostUsd: number
  metadata: Record<string, unknown>
}

export type ConnectedAgentMeterSandboxLeaseResult =
  | {
    applied: true
    meterVersion: number
    remainingCents?: number
    /** The workspace now has under 2% of its budget left: stop the machine. */
    budgetLow?: boolean
    /** An admin's spend limit for the member or agent is used up: stop the machine. */
    spendLimitReached?: boolean
  }
  | { applied: false; reason: 'lease_missing' | 'lease_not_meterable' | 'lease_conflict' | 'insufficient_budget' | 'paid_plan_required'; remainingCents?: number }

export type ComputerMaintenanceClaim = { token: string; kind: 'provision' | 'wake' | 'stop' | 'delete' | 'idle'; expiresAt: number }
export type ComputerActivityClaim = { token: string; expiresAt: number }

export type RedeemEnrollmentResult = {
  enrollment: AgentEnrollmentSession
  environment: AgentEnvironment
  proofChallenge: AgentEnvironmentProofChallenge
}

/** Atomic persistence boundary shared by Convex and PostgreSQL connected-agent flows. */
export interface ConnectedAgentRepository {
  createEnrollmentSession(input: AgentEnrollmentSession): Promise<AgentEnrollmentSession>
  redeemEnrollmentSession(args: {
    codeHash: string
    now: number
    environment: ConnectedAgentCreateEnvironment
    proofChallenge: AgentEnvironmentProofChallenge
  }): Promise<RedeemEnrollmentResult | null>
  listEnvironments(args: { workspaceId: string }): Promise<AgentEnvironment[]>
  getWorkspacePolicyUsage(args: { workspaceId: string }): Promise<{
    activeArtifactBytes: number
    activeRuns: number
    environments: number
  }>
  getEnvironment(args: { workspaceId: string; environmentId: string }): Promise<AgentEnvironment | null>
  getEnvironmentEnrollment(args: {
    workspaceId: string
    environmentId: string
  }): Promise<AgentEnvironmentEnrollmentView | null>
  approveEnvironment(args: {
    workspaceId: string
    environmentId: string
    approvedByUserId: string
    filesystemGrant: AgentFilesystemGrant
    now: number
  }): Promise<AgentEnvironment | null>
  updateEnvironmentFilesystemGrant(args: {
    workspaceId: string
    environmentId: string
    filesystemGrant: AgentFilesystemGrant
    now: number
  }): Promise<AgentEnvironment | null>
  getEnvironmentProofChallenge(args: {
    environmentId: string
    now: number
  }): Promise<{ environment: AgentEnvironment; proofChallenge: AgentEnvironmentProofChallenge } | null>
  issueEnvironmentCredential(args: {
    workspaceId: string
    environmentId: string
    proofChallengeId: string
    proofChallengeHash: string
    credential: AgentEnvironmentCredential
    now: number
  }): Promise<AgentEnvironmentCredential | null>
  findEnvironmentCredential(args: { tokenHash: string }): Promise<AgentEnvironmentCredentialLookup | null>
  consumeEnvironmentProofNonce(args: {
    credentialId: string
    nonceHash: string
    expiresAt: number
    now: number
    /** Accept a credential that expired up to this long ago (a cloud host refreshing itself). */
    expiredGraceMs?: number
  }): Promise<boolean>
  rotateEnvironmentCredential(args: {
    currentCredentialId: string
    credential: AgentEnvironmentCredential
    now: number
  }): Promise<AgentEnvironmentCredential | null>
  heartbeatEnvironment(args: {
    workspaceId: string
    environmentId: string
    now: number
  }): Promise<AgentEnvironment | null>
  updateEnvironmentCapabilities(args: {
    workspaceId: string
    environmentId: string
    capabilities: Record<string, unknown>
    now: number
  }): Promise<AgentEnvironment | null>
  createSandboxLease(input: ConnectedAgentCreateSandboxLease): Promise<AgentSandboxLease>
  getSandboxLease(args: { workspaceId: string; leaseId: string }): Promise<AgentSandboxLease | null>
  getActiveSandboxLease(args: { workspaceId: string; environmentId: string }): Promise<AgentSandboxLease | null>
  listSandboxLeases(args: {
    statuses: AgentSandboxLeaseStatus[]
    cleanupBefore?: number
    limit?: number
  }): Promise<AgentSandboxLease[]>
  claimSandboxLeases?(args: {
    statuses: AgentSandboxLeaseStatus[]
    now: number
    limit: number
    claimToken: string
    claimUntil: number
  }): Promise<{ leases: AgentSandboxLease[]; deferred: boolean }>
  finishSandboxLeaseClaim?(args: {
    workspaceId: string
    leaseId: string
    claimToken: string
    now: number
    nextMeterAt: number
    cleanupAfter?: number | null
  }): Promise<boolean>
  claimComputerMaintenance?(args: {
    workspaceId: string
    leaseId: string
    kind: ComputerMaintenanceClaim['kind']
    token: string
    now: number
    expiresAt: number
    force?: boolean
    idleBefore?: number
    reconcileToken?: string
    recoveryProtocol?: 'computer-recovery-v1'
    expectedProviderReference?: string | null
    actorUserId?: string
    ownerType?: 'agent' | 'user'
    ownerId?: string
  }): Promise<ComputerMaintenanceClaim | null>
  transitionComputerLifecycle?(args: {
    workspaceId: string
    computerId: string
    leaseId: string
    token: string
    transition: 'wake_armed' | 'session_armed' | 'ready' | 'paused' | 'deleted' | 'failed' | 'cancelled'
    expectedProviderReference: string | null
    now: number
    reservedUntil?: number
    cleanupAfter?: number | null
    cleanupAttempts?: number
    activityToken?: string
    activityUserId?: string
    activityExpiresAt?: number
    allocationRetryable?: boolean
  }): Promise<boolean>
  releaseComputerMaintenance?(args: { workspaceId: string; leaseId: string; token: string; now: number }): Promise<boolean>
  claimComputerActivity?(args: {
    workspaceId: string
    leaseId: string
    token: string
    userId: string
    now: number
    expiresAt: number
  }): Promise<ComputerActivityClaim | null>
  releaseComputerActivity?(args: { workspaceId: string; leaseId: string; token: string; now: number }): Promise<boolean>
  prepareComputerAllocation?(args: {
    workspaceId: string
    leaseId: string
    allocationKey: string
    allocationRecipe: string
    maintenanceToken: string
    now: number
  }): Promise<{ requestedAt: number } | null>
  computerHasActiveRuns?(args: {
    workspaceId: string
    ownerType: string
    ownerId: string
    now: number
  }): Promise<boolean>
  updateSandboxLease(input: ConnectedAgentUpdateSandboxLease): Promise<AgentSandboxLease | null>
  patchSandboxLeaseUsage(args: {
    workspaceId: string
    leaseId: string
    patch: Record<string, unknown>
    now: number
    /** Starts the idle timer: the lease is checked for idleness this long from now (replacing any earlier timer). */
    idleCheckInMs?: number
  }): Promise<AgentSandboxLease | null>
  meterSandboxLease(args: {
    workspaceId: string
    leaseId: string
    now: number
    expectedMeterVersion: number
    meteredUsage: Record<string, unknown>
    meteredProviderReference?: string
    meteredAt: number
    payer?: ConnectedAgentSandboxLeasePayer
    charge?: ConnectedAgentSandboxMeterCharge
    providerEvidence?: { usage: Record<string, unknown>; stopped: boolean }
  }): Promise<ConnectedAgentMeterSandboxLeaseResult>
  stopSandboxLease(args: {
    workspaceId: string
    leaseId: string
    reason: string
    now: number
  }): Promise<AgentSandboxLease | null>
  revokeEnvironment(args: { workspaceId: string; environmentId: string; now: number }): Promise<boolean>
}
