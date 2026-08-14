import 'server-only'

import type { AgentRun, AgentRunApproval, AgentRunTerminalError } from '@/shared/agents/agent-run'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ActConversationRepository } from './ActConversationRepository'

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
    }) ?? undefined
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
  }): Promise<AgentRun | undefined> {
    if (!args.runId || !args.userId) return undefined
    return await this.repository.failAgentRun({
      error: args.error,
      errorText: args.errorText,
      runId: args.runId,
      userId: args.userId,
    }) ?? undefined
  }
}
