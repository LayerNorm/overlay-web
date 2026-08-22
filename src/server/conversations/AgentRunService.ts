import 'server-only'

import {
  isActiveAgentRunStatus,
  type AgentRun,
  type AgentRunApproval,
  type AgentRunMetrics,
  type AgentRunTerminalError,
} from '@/shared/agents/agent-run'
import { buildAgentRunMetricsReport } from '@/shared/agents/agent-run-metrics'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ActConversationRepository } from './ActConversationRepository'
import type { ConversationCollaborationRepository } from './ConversationCollaborationRepository'

export class AgentRunService {
  constructor(private readonly repository: ActConversationRepository) {}

  async startChat(args: {
    conversationId?: Id<'conversations'>
    leaseExpiresAt: number
    modelId: string
    turnId: string
    userId: string
    userMessageId?: Id<'conversationMessages'>
    variantIndex?: number
  }): Promise<AgentRun | undefined> {
    if (!args.conversationId || !args.userMessageId) return undefined
    return await this.repository.startAgentRun({
      conversationId: args.conversationId,
      leaseExpiresAt: args.leaseExpiresAt,
      mode: 'chat',
      modelId: args.modelId,
      runner: 'tool_loop',
      turnId: args.turnId,
      userId: args.userId,
      userMessageId: args.userMessageId,
      variantIndex: args.variantIndex,
    }) ?? undefined
  }

  async startWork(args: {
    conversationId?: Id<'conversations'>
    modelId: string
    turnId: string
    userId: string
    userMessageId?: Id<'conversationMessages'>
    variantIndex?: number
  }): Promise<AgentRun | undefined> {
    if (!args.conversationId || !args.userMessageId) return undefined
    return await this.repository.startAgentRun({
      conversationId: args.conversationId,
      mode: 'work',
      modelId: args.modelId,
      runner: 'workflow',
      turnId: args.turnId,
      userId: args.userId,
      userMessageId: args.userMessageId,
      variantIndex: args.variantIndex,
    }) ?? undefined
  }

  /**
   * Opens a durable room agent turn. Unlike `startChat` / `startWork`, the run
   * and its reply row are created by the collaboration repository, because a
   * room turn is authored by an agent principal and authorized by room
   * membership rather than by conversation ownership.
   */
  async startRoomTurn(args: {
    actorUserId: string
    agentId: string
    agentPrincipalId: string
    clientNonce: string
    collaboration: Pick<ConversationCollaborationRepository, 'startAgentTurn'>
    conversationId: string
    modelId: string
    threadRootMessageId?: string
    turnId: string
    userMessageId: string
    workspaceId: string
  }): Promise<{ messageId: string; resumed: boolean; runId: string }> {
    return await args.collaboration.startAgentTurn({
      actorUserId: args.actorUserId,
      agentId: args.agentId,
      authorPrincipalId: args.agentPrincipalId,
      clientNonce: args.clientNonce,
      conversationId: args.conversationId,
      modelId: args.modelId,
      threadRootMessageId: args.threadRootMessageId,
      turnId: args.turnId,
      userMessageId: args.userMessageId,
      workspaceId: args.workspaceId,
    })
  }

  async complete(args: {
    content: string
    metrics?: Partial<AgentRunMetrics>
    parts: Array<Record<string, unknown>>
    routedModelId?: string
    runId: string
    tokens: { input: number; output: number }
    userId: string
  }): Promise<AgentRun | undefined> {
    return await this.repository.completeAgentRun(args) ?? undefined
  }

  async attachWorkflow(args: {
    runId: string
    userId: string
    workflowRunId: string
  }): Promise<AgentRun | undefined> {
    return await this.repository.attachAgentRunWorkflow(args) ?? undefined
  }

  async markRunning(args: {
    leaseExpiresAt: number
    runId?: string
    userId: string
  }): Promise<AgentRun | undefined> {
    if (!args.runId) return undefined
    return await this.repository.transitionAgentRun({
      leaseExpiresAt: args.leaseExpiresAt,
      runId: args.runId,
      status: 'running',
      userId: args.userId,
    }) ?? undefined
  }

  async waitForApproval(args: {
    approval: AgentRunApproval
    runId: string
    userId: string
  }): Promise<AgentRun | undefined> {
    return await this.repository.transitionAgentRun({
      ...args,
      status: 'waiting_for_approval',
    }) ?? undefined
  }

  async resumeAfterApproval(args: {
    runId: string
    userId: string
  }): Promise<AgentRun | undefined> {
    return await this.repository.transitionAgentRun({
      ...args,
      status: 'running',
    }) ?? undefined
  }

  async fail(args: {
    error: AgentRunTerminalError
    errorText: string
    runId?: string
    userId?: string
    metrics?: Partial<AgentRunMetrics>
  }): Promise<AgentRun | undefined> {
    if (!args.runId || !args.userId) return undefined
    return await this.repository.failAgentRun({
      error: args.error,
      errorText: args.errorText,
      metrics: args.metrics,
      runId: args.runId,
      userId: args.userId,
    }) ?? undefined
  }

  async recordMetrics(args: {
    metrics: Partial<AgentRunMetrics>
    runId?: string
    userId?: string
  }): Promise<AgentRun | undefined> {
    if (!args.runId || !args.userId) return undefined
    return await this.repository.recordAgentRunMetrics({
      metrics: args.metrics,
      runId: args.runId,
      userId: args.userId,
    }) ?? undefined
  }

  async metricsReport(args: {
    from: number
    limit?: number
    to: number
    userId: string
  }) {
    const limit = Math.min(3_000, Math.max(1, Math.floor(args.limit ?? 1_000)))
    const runs = await this.repository.listAgentRunsForMetrics({
      ...args,
      limit: limit + 1,
    })
    return buildAgentRunMetricsReport({
      from: args.from,
      runs: runs.slice(0, limit),
      to: args.to,
      truncated: runs.length > limit,
    })
  }

  async recordBrowserEvent(args: {
    conversationId: Id<'conversations'>
    event: 'browser_disconnected' | 'browser_reconnected'
    runId: string
    userId: string
  }): Promise<boolean> {
    const run = await this.repository.getLatestAgentRun({
      conversationId: args.conversationId,
      userId: args.userId,
    })
    if (!run || run.id !== args.runId) return false
    if (args.event === 'browser_disconnected' && !isActiveAgentRunStatus(run.status)) return false
    const now = Date.now()
    const metrics = args.event === 'browser_disconnected'
      ? { browserDisconnectedAt: run.metrics?.browserDisconnectedAt ?? now }
      : run.metrics?.browserDisconnectedAt === undefined
        ? {}
        : { browserReconnectedAt: now }
    await this.repository.recordAgentRunMetrics({ metrics, runId: run.id, userId: args.userId })
    return true
  }
}
