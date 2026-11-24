import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  LOCAL_TOOL_POLL_WAIT_MAX_MS,
  MAX_LOCAL_TOOL_CALLS_PER_POLL,
  OVERLAY_AGENT_PROTOCOL_VERSION,
  localToolRequestSchema,
  localToolResultSchema,
  localToolsCapabilitySchema,
  type LocalToolCall,
  type LocalToolOutcome,
  type LocalToolRequest,
  type LocalToolsCapability,
} from '@layernorm/overlay-agent-bridge-protocol'
import type { AgentEnvironment } from '@overlay/workspace-contracts'
import { effectiveAgentEnvironmentStatus } from '@/shared/agents/environment-status'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

/** A user's own machine, connected through its Agent Host, usable as a Computer. */
export type LocalComputer = {
  environmentId: string
  workspaceId: string
  name: string
  ownerUserId: string
  capability: LocalToolsCapability
  /** The folders the machine's owner approved; absent means all of the user's files. */
  roots?: string[]
}

/** Why the user's Mac can't take computer tools right now. */
export type LocalComputerUnavailableReason =
  | { kind: 'offline'; name: string; lastSeenAt?: number }
  | { kind: 'computer_control_off'; name: string }
  | { kind: 'not_set_up' }

export class LocalComputerError extends Error {
  constructor(readonly code: string, message: string, readonly missing: string[] = [], readonly detail?: Record<string, unknown>) {
    super(message)
    this.name = 'LocalComputerError'
  }
}

export interface LocalToolCallRepository {
  enqueue(input: {
    callId: string; workspaceId: string; environmentId: string; requestedByUserId: string; agentId?: string
    toolName: string; request: LocalToolRequest; deadlineAt: number; now: number
  }): Promise<void>
  claim(input: { workspaceId: string; environmentId: string; limit: number; now: number }): Promise<Array<Omit<LocalToolCall, 'protocolVersion'>>>
  complete(input: { workspaceId: string; environmentId: string; callId: string; outcome: LocalToolOutcome; now: number }): Promise<{ accepted: boolean }>
  get(input: { workspaceId: string; callId: string }): Promise<{ status: string; outcome?: LocalToolOutcome } | null>
  expire(input: { workspaceId: string; callId: string; now: number }): Promise<{ status: string; outcome?: LocalToolOutcome } | null>
}

const PREFIX = 'agents/localToolCalls'
const call = <T>(kind: 'query' | 'mutation', name: string, args: Record<string, unknown>) =>
  convex[kind]<T>(`${PREFIX}:${name}`, { ...args, serverSecret: getInternalApiSecret() }, { throwOnError: true }) as Promise<T>

export class ConvexLocalToolCallRepository implements LocalToolCallRepository {
  async enqueue(input: Parameters<LocalToolCallRepository['enqueue']>[0]) { await call('mutation', 'enqueueByServer', input) }
  claim(input: Parameters<LocalToolCallRepository['claim']>[0]) { return call<Array<Omit<LocalToolCall, 'protocolVersion'>>>('mutation', 'claimByServer', input) }
  complete(input: Parameters<LocalToolCallRepository['complete']>[0]) { return call<{ accepted: boolean }>('mutation', 'completeByServer', input) }
  get(input: Parameters<LocalToolCallRepository['get']>[0]) { return call<{ status: string; outcome?: LocalToolOutcome } | null>('query', 'getByServer', input) }
  expire(input: Parameters<LocalToolCallRepository['expire']>[0]) { return call<{ status: string; outcome?: LocalToolOutcome } | null>('mutation', 'expireByServer', input) }
}

const WAIT_INTERVAL_MS = 150
const HOST_POLL_INTERVAL_MS = 250
/** Time for the request to reach the Mac and the answer to come back, on top of the action itself. */
const DELIVERY_ALLOWANCE_MS = 25_000

export function localToolsCapabilityOf(environment: Pick<AgentEnvironment, 'capabilities'>): LocalToolsCapability | null {
  const parsed = localToolsCapabilitySchema.safeParse((environment.capabilities as { localTools?: unknown } | undefined)?.localTools)
  return parsed.success ? parsed.data : null
}

export class LocalComputerService {
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly dependencies: {
    repository: LocalToolCallRepository
    listEnvironments: (input: { workspaceId: string }) => Promise<AgentEnvironment[]>
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  }) {
    this.now = dependencies.now ?? Date.now
    this.sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  /**
   * The user's own connected machine in this workspace that serves local tools,
   * most recently seen first. Only the person who approved the machine can use it.
   */
  async findForUser(input: { workspaceId: string; userId: string; includeOffline?: boolean; environmentId?: string }): Promise<LocalComputer | null> {
    const now = this.now()
    const candidates = (await this.dependencies.listEnvironments({ workspaceId: input.workspaceId }))
      .filter((environment) => environment.kind === 'local'
        && environment.approvedByUserId === input.userId
        && environment.revokedAt === undefined && environment.status !== 'revoked' && environment.status !== 'pending'
        && (input.environmentId === undefined || environment.id === input.environmentId)
        && (input.includeOffline || effectiveAgentEnvironmentStatus(environment, now) === 'online')
        && localToolsCapabilityOf(environment) !== null)
      .sort((left, right) => (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0))
    const environment = candidates[0]
    if (!environment) return null
    return {
      environmentId: environment.id, workspaceId: environment.workspaceId, name: environment.name,
      ownerUserId: input.userId, capability: localToolsCapabilityOf(environment)!,
      ...(environment.filesystemGrant?.mode === 'selected_roots' ? { roots: [...environment.filesystemGrant.roots] } : {}),
    }
  }

  /**
   * Why `findForUser` found no usable Mac, so the agent can tell the user what to change
   * instead of a bare "not connected". Considers only the user's own, unrevoked machines.
   */
  async unavailableReason(input: { workspaceId: string; userId: string }): Promise<LocalComputerUnavailableReason> {
    const now = this.now()
    const mine = (await this.dependencies.listEnvironments({ workspaceId: input.workspaceId }))
      .filter((environment) => environment.kind === 'local'
        && environment.approvedByUserId === input.userId
        && environment.revokedAt === undefined && environment.status !== 'revoked' && environment.status !== 'pending')
      .sort((left, right) => (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0))
    const withTools = mine.find((environment) => localToolsCapabilityOf(environment) !== null)
    if (withTools && effectiveAgentEnvironmentStatus(withTools, now) !== 'online') {
      return { kind: 'offline', name: withTools.name, ...(withTools.lastSeenAt ? { lastSeenAt: withTools.lastSeenAt } : {}) }
    }
    const online = mine.find((environment) => effectiveAgentEnvironmentStatus(environment, now) === 'online')
    if (online) return { kind: 'computer_control_off', name: online.name }
    return { kind: 'not_set_up' }
  }

  /** Sends one tool call to the machine and waits for its answer. */
  async execute(input: {
    computer: LocalComputer
    userId: string
    agentId?: string
    toolName: string
    request: LocalToolRequest
    actionTimeoutMs: number
  }): Promise<Record<string, unknown>> {
    const request = localToolRequestSchema.parse(input.request)
    const callId = `ltc_${randomUUID()}`
    const now = this.now()
    const deadlineAt = now + Math.min(input.actionTimeoutMs + DELIVERY_ALLOWANCE_MS, 5 * 60_000)
    await this.dependencies.repository.enqueue({
      callId, workspaceId: input.computer.workspaceId, environmentId: input.computer.environmentId,
      requestedByUserId: input.userId, ...(input.agentId ? { agentId: input.agentId } : {}),
      toolName: input.toolName, request, deadlineAt, now,
    })
    let state: { status: string; outcome?: LocalToolOutcome } | null = null
    while (this.now() < deadlineAt) {
      await this.sleep(WAIT_INTERVAL_MS)
      state = await this.dependencies.repository.get({ workspaceId: input.computer.workspaceId, callId })
      if (state?.status === 'completed' || state?.status === 'expired') break
    }
    if (state?.status !== 'completed') {
      state = await this.dependencies.repository.expire({ workspaceId: input.computer.workspaceId, callId, now: this.now() })
    }
    if (state?.status !== 'completed' || !state.outcome) {
      throw new LocalComputerError('local_computer_unreachable',
        `${input.computer.name} did not answer in time. It may be asleep, offline or busy; ask the user to check that Overlay is running on it.`)
    }
    if (!state.outcome.ok) {
      const error = state.outcome.error
      throw new LocalComputerError(error.code, error.message, error.missing ?? [], error.detail)
    }
    return state.outcome.result
  }

  /** Host long-poll: waits up to `waitMs` for calls addressed to this machine. */
  async pollForHost(input: { workspaceId: string; environmentId: string; waitMs: number; signal?: AbortSignal }): Promise<LocalToolCall[]> {
    const until = this.now() + Math.min(Math.max(input.waitMs, 0), LOCAL_TOOL_POLL_WAIT_MAX_MS)
    for (;;) {
      const claimed = await this.dependencies.repository.claim({
        workspaceId: input.workspaceId, environmentId: input.environmentId, limit: MAX_LOCAL_TOOL_CALLS_PER_POLL, now: this.now(),
      })
      if (claimed.length > 0 || this.now() >= until || input.signal?.aborted) {
        return claimed.map((item) => ({ ...item, protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION }))
      }
      await this.sleep(HOST_POLL_INTERVAL_MS)
    }
  }

  async submitFromHost(input: { workspaceId: string; environmentId: string; body: unknown }): Promise<{ accepted: boolean }> {
    const result = localToolResultSchema.parse(input.body)
    return await this.dependencies.repository.complete({
      workspaceId: input.workspaceId, environmentId: input.environmentId, callId: result.callId, outcome: result.outcome, now: this.now(),
    })
  }
}
