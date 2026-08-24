import type {
  AgentApprovalRequest,
  AgentApprovalResolution,
  AgentBinding,
  AgentEnvironment,
  AgentRemoteEvent,
  AgentRemoteSession,
  AgentRunCommand,
  AgentSandboxLease,
} from '@overlay/workspace-contracts'

type ApplyResult =
  | { accepted: true; acknowledgedSequence: number; duplicate: boolean }
  | { accepted: false; expectedSequence: number }

export interface ConnectedAgentContractRepository {
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
