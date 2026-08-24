import type {
  AgentApprovalRequest,
  AgentApprovalResolution,
  AgentBinding,
  AgentEnrollmentSession,
  AgentEnvironment,
  AgentEnvironmentCredential,
  AgentEnvironmentEnrollmentView,
  AgentEnvironmentProofChallenge,
  AgentFilesystemGrant,
  AgentRemoteEvent,
  AgentRemoteSession,
  AgentRunCommand,
  AgentSandboxLease,
} from '@overlay/workspace-contracts'

type ApplyResult =
  | { accepted: true; acknowledgedSequence: number; duplicate: boolean }
  | { accepted: false; expectedSequence: number }

export interface ConnectedAgentContractRepository {
  createEnrollmentSession(input: AgentEnrollmentSession): Promise<AgentEnrollmentSession>
  redeemEnrollmentSession(args: {
    codeHash: string
    now: number
    environment: Omit<AgentEnvironment, 'createdAt' | 'updatedAt'> & { now: number }
    proofChallenge: AgentEnvironmentProofChallenge
  }): Promise<{ enrollment: AgentEnrollmentSession; environment: AgentEnvironment; proofChallenge: AgentEnvironmentProofChallenge } | null>
  listEnvironments(args: { workspaceId: string }): Promise<AgentEnvironment[]>
  getEnvironment(args: { workspaceId: string; environmentId: string }): Promise<AgentEnvironment | null>
  getEnvironmentEnrollment(args: { workspaceId: string; environmentId: string }): Promise<AgentEnvironmentEnrollmentView | null>
  approveEnvironment(args: { workspaceId: string; environmentId: string; approvedByUserId: string; filesystemGrant: AgentFilesystemGrant; now: number }): Promise<AgentEnvironment | null>
  updateEnvironmentFilesystemGrant(args: { workspaceId: string; environmentId: string; filesystemGrant: AgentFilesystemGrant; now: number }): Promise<AgentEnvironment | null>
  getEnvironmentProofChallenge(args: { environmentId: string; now: number }): Promise<{ environment: AgentEnvironment; proofChallenge: AgentEnvironmentProofChallenge } | null>
  issueEnvironmentCredential(args: { workspaceId: string; environmentId: string; proofChallengeId: string; proofChallengeHash: string; credential: AgentEnvironmentCredential; now: number }): Promise<AgentEnvironmentCredential | null>
  findEnvironmentCredential(args: { tokenHash: string }): Promise<AgentEnvironmentCredential | null>
  consumeEnvironmentProofNonce(args: { credentialId: string; nonceHash: string; expiresAt: number; now: number }): Promise<boolean>
  rotateEnvironmentCredential(args: { currentCredentialId: string; credential: AgentEnvironmentCredential; now: number }): Promise<AgentEnvironmentCredential | null>
  heartbeatEnvironment(args: { workspaceId: string; environmentId: string; now: number }): Promise<AgentEnvironment | null>
  updateEnvironmentCapabilities(args: { workspaceId: string; environmentId: string; capabilities: Record<string, unknown>; now: number }): Promise<AgentEnvironment | null>
  createEnvironment(input: Omit<AgentEnvironment, 'createdAt' | 'updatedAt'> & { now: number }): Promise<AgentEnvironment>
  createBinding(input: Omit<AgentBinding, 'createdAt' | 'updatedAt'> & { now: number }): Promise<AgentBinding>
  createRemoteSession(input: Omit<AgentRemoteSession, 'createdAt' | 'updatedAt'> & { now: number }): Promise<AgentRemoteSession>
  enqueueCommand(input: Omit<AgentRunCommand,
    'sequence' | 'status' | 'claimedAt' | 'claimExpiresAt' | 'acknowledgedAt' | 'createdAt' | 'updatedAt'
  > & { now: number }): Promise<AgentRunCommand>
  claimCommands(args: { workspaceId: string; environmentId: string; now: number; leaseMs: number; limit: number }): Promise<AgentRunCommand[]>
  acknowledgeCommand(args: { workspaceId: string; environmentId: string; commandId: string; now: number }): Promise<boolean>
  createApprovalRequest(input: AgentApprovalRequest): Promise<AgentApprovalRequest>
  resolveApprovalRequest(args: { workspaceId: string; approvalId: string; resolution: AgentApprovalResolution }): Promise<AgentApprovalRequest | null>
  createSandboxLease(input: Omit<AgentSandboxLease, 'createdAt' | 'updatedAt'> & { now: number }): Promise<AgentSandboxLease>
  updateSandboxLease(input: Partial<Pick<
    AgentSandboxLease,
    | 'status' | 'providerReference' | 'reservationId' | 'reservedUntil'
    | 'runtimeStartedAt' | 'runtimeEndedAt' | 'usage' | 'cleanupAttempts' | 'cleanupAfter'
  >> & { workspaceId: string; leaseId: string; now: number }): Promise<AgentSandboxLease | null>
  applyRemoteEvents(args: { workspaceId: string; environmentId: string; sessionId: string; events: AgentRemoteEvent[]; now: number }): Promise<ApplyResult>
  revokeEnvironment(args: { workspaceId: string; environmentId: string; now: number }): Promise<boolean>
  deleteWorkspaceData(args: { workspaceId: string }): Promise<void>
}

export type ConnectedAgentContractFixture = {
  repository: ConnectedAgentContractRepository
  prefix: string
  workspaceId: string
  otherWorkspaceId: string
  runId: string
  now?: number
}

/** Shared positive and negative provider contract used by Convex and PostgreSQL. */
export async function verifyConnectedAgentRepositoryContract(fixture: ConnectedAgentContractFixture): Promise<void> {
  const { repository, prefix, workspaceId, otherWorkspaceId, runId } = fixture
  const now = fixture.now ?? 1_800_000_000_000
  const environmentId = `${prefix}_environment`
  const otherEnvironmentId = `${prefix}_other_environment`
  const bindingId = `${prefix}_binding`
  const sessionId = `${prefix}_session`

  const enrollmentId = `${prefix}_enrollment`
  const enrolledEnvironmentId = `${prefix}_enrolled_environment`
  const challengeId = `${prefix}_challenge`
  const codeHash = `${prefix}_code_hash`
  await repository.createEnrollmentSession({
    id: enrollmentId,
    workspaceId,
    createdByUserId: `${prefix}_human`,
    codeHash,
    verificationPhrase: 'amber-river-sage',
    status: 'created',
    expiresAt: now + 60_000,
    createdAt: now,
    updatedAt: now,
  })
  await repository.createEnrollmentSession({
    id: `${enrollmentId}_expired`, workspaceId, createdByUserId: `${prefix}_human`,
    codeHash: `${codeHash}_expired`, verificationPhrase: 'expired-phrase-test', status: 'created',
    expiresAt: now - 1, createdAt: now - 10, updatedAt: now - 10,
  })
  equal(await repository.redeemEnrollmentSession({
    codeHash: `${codeHash}_expired`, now,
    environment: { id: `${enrolledEnvironmentId}_expired`, workspaceId: '', kind: 'local', name: 'Expired', status: 'pending', capabilities: {}, now },
    proofChallenge: { id: `${challengeId}_expired`, workspaceId: '', environmentId: `${enrolledEnvironmentId}_expired`, challengeHash: 'expired-hash', expiresAt: now + 60_000, createdAt: now },
  }), null, 'expired enrollment codes must fail closed')
  const redeemed = await repository.redeemEnrollmentSession({
    codeHash, now,
    environment: { id: enrolledEnvironmentId, workspaceId: '', kind: 'local', name: 'Enrolled host', status: 'pending', publicKey: 'test-public-key', hostVersion: '1.0.0', platform: 'test', capabilities: {}, now },
    proofChallenge: { id: challengeId, workspaceId: '', environmentId: enrolledEnvironmentId, challengeHash: `${prefix}_challenge_hash`, expiresAt: now + 60_000, createdAt: now },
  })
  equal(redeemed?.environment.workspaceId, workspaceId, 'redeemed environments must inherit workspace only from the code')
  equal(await repository.redeemEnrollmentSession({
    codeHash, now: now + 1,
    environment: { id: `${enrolledEnvironmentId}_replay`, workspaceId: otherWorkspaceId, kind: 'local', name: 'Replay', status: 'pending', capabilities: {}, now },
    proofChallenge: { id: `${challengeId}_replay`, workspaceId: otherWorkspaceId, environmentId: `${enrolledEnvironmentId}_replay`, challengeHash: 'replay-hash', expiresAt: now + 60_000, createdAt: now },
  }), null, 'enrollment code replay must be rejected')
  equal(await repository.getEnvironment({ workspaceId: otherWorkspaceId, environmentId: enrolledEnvironmentId }), null, 'foreign workspace must not read an enrolled environment')
  equal(await repository.approveEnvironment({ workspaceId: otherWorkspaceId, environmentId: enrolledEnvironmentId, approvedByUserId: 'foreign', filesystemGrant: { mode: 'selected_roots', roots: ['/foreign'] }, now: now + 2 }), null, 'foreign workspace must not approve an environment')
  const approved = await repository.approveEnvironment({
    workspaceId, environmentId: enrolledEnvironmentId, approvedByUserId: `${prefix}_human`,
    filesystemGrant: { mode: 'selected_roots', roots: ['/workspace/project'] }, now: now + 2,
  })
  equal(approved?.filesystemGrant?.mode, 'selected_roots', 'approval must persist an explicit filesystem grant')
  equal((await repository.getEnvironmentEnrollment({ workspaceId, environmentId: enrolledEnvironmentId }))?.verificationPhrase, 'amber-river-sage', 'browser enrollment view must retain the verification phrase')
  const pendingProof = await repository.getEnvironmentProofChallenge({ environmentId: enrolledEnvironmentId, now: now + 3 })
  equal(pendingProof?.proofChallenge.id, challengeId, 'approved environment must expose its unconsumed proof challenge')
  const credential: AgentEnvironmentCredential = {
    id: `${prefix}_credential`, workspaceId, environmentId: enrolledEnvironmentId,
    tokenHash: `${prefix}_token_hash`, audience: 'overlay-agent-control-plane',
    methods: ['agent:commands:poll', 'agent:events:write', 'agent:credentials:refresh'],
    tokenNonce: `${prefix}_token_nonce`, expiresAt: now + 120_000, createdAt: now + 3,
  }
  equal(await repository.issueEnvironmentCredential({ workspaceId, environmentId: enrolledEnvironmentId, proofChallengeId: challengeId, proofChallengeHash: 'wrong', credential, now: now + 3 }), null, 'forged proof challenge hashes must be rejected')
  equal((await repository.issueEnvironmentCredential({ workspaceId, environmentId: enrolledEnvironmentId, proofChallengeId: challengeId, proofChallengeHash: `${prefix}_challenge_hash`, credential, now: now + 3 }))?.id, credential.id, 'valid proof challenge must issue a scoped credential')
  equal(await repository.issueEnvironmentCredential({ workspaceId, environmentId: enrolledEnvironmentId, proofChallengeId: challengeId, proofChallengeHash: `${prefix}_challenge_hash`, credential: { ...credential, id: `${credential.id}_replay`, tokenHash: `${credential.tokenHash}_replay` }, now: now + 4 }), null, 'credential challenge replay must be rejected')
  equal((await repository.findEnvironmentCredential({ tokenHash: credential.tokenHash }))?.environmentId, enrolledEnvironmentId, 'credential hashes must resolve to the exact environment')
  equal(await repository.consumeEnvironmentProofNonce({ credentialId: credential.id, nonceHash: `${prefix}_request_nonce`, expiresAt: now + 10_000, now: now + 4 }), true, 'first signed request nonce must be consumed')
  equal(await repository.consumeEnvironmentProofNonce({ credentialId: credential.id, nonceHash: `${prefix}_request_nonce`, expiresAt: now + 10_000, now: now + 5 }), false, 'request nonce replay must be rejected')
  const rotatedCredential = { ...credential, id: `${credential.id}_rotated`, tokenHash: `${credential.tokenHash}_rotated`, tokenNonce: `${credential.tokenNonce}_rotated`, createdAt: now + 6 }
  equal(await repository.rotateEnvironmentCredential({ currentCredentialId: credential.id, credential: { ...rotatedCredential, workspaceId: otherWorkspaceId }, now: now + 6 }), null, 'credential rotation must not change workspace scope')
  equal((await repository.rotateEnvironmentCredential({ currentCredentialId: credential.id, credential: rotatedCredential, now: now + 6 }))?.id, rotatedCredential.id, 'credential rotation must revoke and replace the current credential')
  equal(await repository.updateEnvironmentFilesystemGrant({ workspaceId: otherWorkspaceId, environmentId: enrolledEnvironmentId, filesystemGrant: { mode: 'all_user_files' }, now: now + 7 }), null, 'foreign workspace must not widen filesystem scope')
  const refreshed = await repository.updateEnvironmentCapabilities({ workspaceId, environmentId: enrolledEnvironmentId, capabilities: { adapters: ['acp'] }, now: now + 8 })
  equal((refreshed?.capabilities.adapters as string[] | undefined)?.[0], 'acp', 'capability refresh must be environment-scoped')

  const environment = await repository.createEnvironment({
    id: environmentId,
    workspaceId,
    kind: 'local',
    name: 'Contract host',
    status: 'online',
    capabilities: { adapters: ['fake', 'acp'] },
    now,
  })
  equal(environment.workspaceId, workspaceId, 'environment must retain its workspace scope')

  await repository.createEnvironment({
    id: otherEnvironmentId,
    workspaceId: otherWorkspaceId,
    kind: 'vps',
    name: 'Foreign host',
    status: 'online',
    capabilities: {},
    now,
  })

  await rejects(
    () => repository.createBinding({
      id: `${prefix}_foreign_binding`,
      workspaceId,
      agentId: `${prefix}_agent`,
      environmentId: otherEnvironmentId,
      protocolAdapter: 'acp',
      adapterConfig: {},
      enabled: true,
      now,
    }),
    'a workspace must not bind an environment owned by another workspace',
  )

  const binding = await repository.createBinding({
    id: bindingId,
    workspaceId,
    agentId: `${prefix}_agent`,
    environmentId,
    protocolAdapter: 'acp',
    adapterConfig: {},
    enabled: true,
    now,
  })
  equal(binding.environmentId, environmentId, 'binding must retain its environment')

  await rejects(
    () => repository.createRemoteSession({
      id: `${prefix}_invalid_session`,
      workspaceId,
      environmentId,
      bindingId: `${prefix}_missing_binding`,
      runId,
      status: 'starting',
      commandCursor: 0,
      eventCursor: 0,
      capabilitySnapshot: {},
      now,
    }),
    'a remote session must require an enabled binding in the same environment',
  )

  const session = await repository.createRemoteSession({
    id: sessionId,
    workspaceId,
    environmentId,
    bindingId,
    runId,
    status: 'starting',
    commandCursor: 0,
    eventCursor: 0,
    capabilitySnapshot: { adapter: 'acp' },
    now,
  })
  equal(session.eventCursor, 0, 'new sessions must start at event cursor zero')

  await rejects(
    () => repository.enqueueCommand({
      id: `${prefix}_foreign_command`,
      workspaceId: otherWorkspaceId,
      environmentId,
      runId,
      type: 'start',
      payload: {},
      now,
    }),
    'a workspace must not enqueue onto another workspace environment',
  )
  await rejects(
    () => repository.enqueueCommand({
      id: `${prefix}_oversized_command`, workspaceId, environmentId, runId, type: 'start',
      payload: { text: 'x'.repeat(129 * 1024) }, now,
    }),
    'oversized commands must be rejected identically by every provider',
  )

  const startCommand = await repository.enqueueCommand({
    id: `${prefix}_start_command`,
    workspaceId,
    environmentId,
    runId,
    type: 'start',
    payload: { prompt: 'contract prompt' },
    now,
  })
  equal(startCommand.sequence, 1, 'first command sequence must be one')
  equal((await repository.claimCommands({ workspaceId: otherWorkspaceId, environmentId, now, leaseMs: 5_000, limit: 10 })).length, 0, 'foreign workspace must not claim commands')

  const firstClaim = await repository.claimCommands({ workspaceId, environmentId, now, leaseMs: 5_000, limit: 10 })
  equal(firstClaim.length, 1, 'owner workspace must claim its pending command')
  equal((await repository.claimCommands({ workspaceId, environmentId, now: now + 1, leaseMs: 5_000, limit: 10 })).length, 0, 'active command lease must prevent duplicate claim')
  equal((await repository.claimCommands({ workspaceId, environmentId, now: now + 5_001, leaseMs: 5_000, limit: 10 })).length, 1, 'expired command lease must be reclaimable')
  equal(await repository.acknowledgeCommand({ workspaceId: otherWorkspaceId, environmentId, commandId: startCommand.id, now: now + 5_002 }), false, 'foreign workspace must not acknowledge commands')
  equal(await repository.acknowledgeCommand({ workspaceId, environmentId, commandId: startCommand.id, now: now + 5_002 }), true, 'owner workspace must acknowledge claimed commands')
  equal(await repository.acknowledgeCommand({ workspaceId, environmentId, commandId: startCommand.id, now: now + 5_003 }), true, 'command acknowledgement must be idempotent')
  equal((await repository.claimCommands({ workspaceId, environmentId, now: now + 20_000, leaseMs: 5_000, limit: 10 })).length, 0, 'acknowledged commands must not be reclaimed')

  const events = [event(environmentId, runId, 1), event(environmentId, runId, 2)]
  await rejects(
    () => repository.applyRemoteEvents({
      workspaceId, environmentId, sessionId,
      events: [{ ...event(environmentId, runId, 1), payload: { text: 'x'.repeat(513 * 1024) } }],
      now: now + 9,
    }),
    'oversized event batches must be rejected identically by every provider',
  )
  deepEqual(await repository.applyRemoteEvents({ workspaceId, environmentId, sessionId, events, now: now + 10 }), {
    accepted: true,
    acknowledgedSequence: 2,
    duplicate: false,
  }, 'contiguous events must advance the cursor')
  deepEqual(await repository.applyRemoteEvents({ workspaceId, environmentId, sessionId, events, now: now + 11 }), {
    accepted: true,
    acknowledgedSequence: 2,
    duplicate: true,
  }, 'duplicate events must be acknowledged without reapplication')
  deepEqual(await repository.applyRemoteEvents({ workspaceId, environmentId, sessionId, events: [event(environmentId, runId, 4)], now: now + 12 }), {
    accepted: false,
    expectedSequence: 3,
  }, 'event gaps must return the next expected sequence')
  await rejects(
    () => repository.applyRemoteEvents({ workspaceId, environmentId, sessionId, events: [event(environmentId, runId, 3), event(environmentId, runId, 5)], now: now + 13 }),
    'non-contiguous event batches must fail',
  )
  await rejects(
    () => repository.applyRemoteEvents({ workspaceId, environmentId, sessionId, events: [event(environmentId, `${runId}_foreign`, 3)], now: now + 14 }),
    'event run scope must match its remote session',
  )
  await rejects(
    () => repository.applyRemoteEvents({ workspaceId: otherWorkspaceId, environmentId, sessionId, events: [event(environmentId, runId, 3)], now: now + 15 }),
    'a foreign workspace must not advance a session cursor',
  )

  const approval = await repository.createApprovalRequest({
    id: `${prefix}_approval`,
    workspaceId,
    runId,
    remoteSessionId: sessionId,
    requestKey: 'permission-1',
    prompt: 'Allow write?',
    options: ['allow_once', 'reject'],
    payload: { path: '/workspace/file.ts' },
    requestedAt: now + 20,
  })
  const repeatedApproval = await repository.createApprovalRequest({
    id: `${prefix}_approval_retry`, workspaceId: approval.workspaceId, runId: approval.runId,
    remoteSessionId: approval.remoteSessionId, requestKey: approval.requestKey,
    prompt: approval.prompt, options: approval.options, payload: approval.payload,
    requestedAt: approval.requestedAt, ...(approval.resolution ? { resolution: approval.resolution } : {}),
  })
  equal(repeatedApproval.id, approval.id, 'approval request retries must preserve the first immutable record')
  const resolution = { decision: 'allow_once', resolvedByPrincipalId: `${prefix}_human`, resolvedAt: now + 21 }
  equal((await repository.resolveApprovalRequest({ workspaceId: otherWorkspaceId, approvalId: approval.id, resolution })), null, 'foreign workspace must not resolve approval')
  deepEqual((await repository.resolveApprovalRequest({ workspaceId, approvalId: approval.id, resolution }))?.resolution, resolution, 'owner resolution must persist')
  deepEqual((await repository.resolveApprovalRequest({ workspaceId, approvalId: approval.id, resolution }))?.resolution, resolution, 'identical approval resolution must be idempotent')
  await rejects(
    () => repository.resolveApprovalRequest({
      workspaceId,
      approvalId: approval.id,
      resolution: { ...resolution, decision: 'reject' },
    }),
    'a resolved approval must be immutable',
  )

  const lease = await repository.createSandboxLease({
    id: `${prefix}_lease`,
    workspaceId,
    environmentId,
    runId,
    provider: 'contract-provider',
    status: 'reserved',
    reservedUntil: now + 60_000,
    usage: {},
    cleanupAttempts: 0,
    now,
  })
  equal(lease.status, 'reserved', 'sandbox lease must persist its initial lifecycle')
  equal(await repository.updateSandboxLease({ workspaceId: otherWorkspaceId, leaseId: lease.id, status: 'running', now: now + 30 }), null, 'foreign workspace must not update sandbox lease')
  equal((await repository.updateSandboxLease({
    workspaceId,
    leaseId: lease.id,
    status: 'running',
    providerReference: 'provider-lease-1',
    runtimeStartedAt: now + 30,
    now: now + 30,
  }))?.status, 'running', 'owner workspace must advance sandbox lease state')

  await repository.enqueueCommand({
    id: `${prefix}_cancelled_by_revoke`,
    workspaceId,
    environmentId,
    runId,
    type: 'cancel',
    payload: {},
    now: now + 40,
  })
  equal(await repository.revokeEnvironment({ workspaceId: otherWorkspaceId, environmentId, now: now + 41 }), false, 'foreign workspace must not revoke an environment')
  equal(await repository.revokeEnvironment({ workspaceId, environmentId, now: now + 41 }), true, 'owner workspace must revoke its environment')
  equal((await repository.claimCommands({ workspaceId, environmentId, now: now + 50_000, leaseMs: 5_000, limit: 10 })).length, 0, 'revocation must win over pending commands')
  await rejects(
    () => repository.createBinding({
      id: `${prefix}_revoked_binding`, workspaceId, agentId: `${prefix}_agent_2`, environmentId,
      protocolAdapter: 'acp', adapterConfig: {}, enabled: true, now: now + 42,
    }),
    'revoked environments must reject new bindings',
  )
  equal(await repository.revokeEnvironment({ workspaceId, environmentId: enrolledEnvironmentId, now: now + 43 }), true, 'owner workspace must revoke an enrolled environment')
  equal(await repository.consumeEnvironmentProofNonce({ credentialId: rotatedCredential.id, nonceHash: `${prefix}_after_revoke`, expiresAt: now + 60_000, now: now + 44 }), false, 'revocation must immediately invalidate active credentials')

  await repository.deleteWorkspaceData({ workspaceId })
  equal((await repository.claimCommands({ workspaceId, environmentId, now: now + 60_000, leaseMs: 5_000, limit: 10 })).length, 0, 'workspace deletion must remove connected-agent command state')
}

function event(environmentId: string, runId: string, sourceSequence: number): AgentRemoteEvent {
  return {
    protocolVersion: 1,
    eventId: `${runId}_event_${sourceSequence}`,
    environmentId,
    runId,
    sourceSequence,
    type: 'text_checkpoint',
    occurredAt: 1_800_000_000_000 + sourceSequence,
    payload: { text: `checkpoint ${sourceSequence}` },
  }
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!Object.is(actual, expected)) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`)
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(stable(actual)) !== JSON.stringify(stable(expected))) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stable(nested)]))
  }
  return value
}

async function rejects(operation: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await operation()
  } catch {
    return
  }
  throw new Error(`${message}: expected rejection`)
}
