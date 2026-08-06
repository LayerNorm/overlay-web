import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  AutomationRecord,
  AutomationExecutionPayload,
  AutomationForUpdateNote,
  AutomationRepository,
  AutomationRunTarget,
  CreateAutomationInput,
  UpdateAutomationInput,
} from './AutomationRepository'
import type { AutomationRunSummary } from '@overlay/app-core'
import type { Id } from '../../../convex/_generated/dataModel'

export class ConvexAutomationRepository implements AutomationRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async listAutomations(args: {
    includeDeleted?: boolean
    projectId?: string
    userId: string
  }): Promise<AutomationRecord[]> {
    return await convex.query<AutomationRecord[]>('automations/automations:list', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async listRuns(args: {
    automationId: string
    userId: string
  }): Promise<AutomationRunSummary[]> {
    return await convex.query<AutomationRunSummary[]>('automations/automations:listRuns', {
      ...args,
      automationId: args.automationId as Id<'automations'>,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async getAutomation(args: {
    automationId: string
    userId: string
  }): Promise<AutomationForUpdateNote | null> {
    return await convex.query<AutomationForUpdateNote | null>('automations/automations:get', {
      ...args,
      automationId: args.automationId as Id<'automations'>,
      serverSecret: this.serverSecret,
    })
  }

  async getAutomationRunTarget(args: {
    automationId: string
    userId: string
  }): Promise<AutomationRunTarget | null> {
    return await convex.query<AutomationRunTarget | null>('automations/automations:get', {
      ...args,
      automationId: args.automationId as Id<'automations'>,
      serverSecret: this.serverSecret,
    })
  }

  async createAutomation(args: CreateAutomationInput): Promise<string> {
    const id = await convex.mutation<string>('automations/automations:create', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!id) throw new Error('Convex automation create returned no id')
    return id
  }

  async updateAutomation(args: UpdateAutomationInput): Promise<void> {
    await convex.mutation('automations/automations:update', {
      ...args,
      automationId: args.automationId as Id<'automations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async attachSourceConversation(args: {
    automationId: string
    conversationId: string
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:attachSourceConversationByServer', {
      automationId: args.automationId as Id<'automations'>,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
      userId: args.userId,
    }, { throwOnError: true })
  }

  async pauseAutomation(args: {
    automationId: string
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:pause', {
      ...args,
      automationId: args.automationId as Id<'automations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async resumeAutomation(args: {
    automationId: string
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:resume', {
      ...args,
      automationId: args.automationId as Id<'automations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async removeAutomation(args: {
    automationId: string
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:remove', {
      ...args,
      automationId: args.automationId as Id<'automations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async requestRunCancellation(args: { runId: string; userId: string }): Promise<boolean> {
    const result = await convex.mutation<{ cancelled: boolean }>(
      'automations/automations:requestRunCancellationByServer',
      {
        ...args,
        runId: args.runId as Id<'automationRuns'>,
        serverSecret: this.serverSecret,
      },
      { throwOnError: true },
    )
    return result?.cancelled ?? false
  }

  async requestActiveRunCancellation(args: {
    automationId: string
    userId: string
  }): Promise<number> {
    const result = await convex.mutation<{ cancelled: number }>(
      'automations/automations:requestActiveRunCancellationByServer',
      {
        ...args,
        automationId: args.automationId as Id<'automations'>,
        serverSecret: this.serverSecret,
      },
      { throwOnError: true },
    )
    return result?.cancelled ?? 0
  }

  async retryRun(args: { runId: string; userId: string }): Promise<string | null> {
    const result = await convex.mutation<{ runId: Id<'automationRuns'> | null }>(
      'automations/automations:retryRunByServer',
      {
        ...args,
        runId: args.runId as Id<'automationRuns'>,
        serverSecret: this.serverSecret,
      },
      { throwOnError: true },
    )
    return result?.runId ?? null
  }

  async removeConversation(args: {
    conversationId: string
    userId: string
  }): Promise<void> {
    await convex.mutation('chat/conversations:remove', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async appendAutomationUpdateNote(args: {
    automationId: string
    content: string
    conversationId: string
    userId: string
  }): Promise<void> {
    await convex.mutation('chat/conversations:addMessage', {
      conversationId: args.conversationId as Id<'conversations'>,
      userId: args.userId,
      serverSecret: this.serverSecret,
      turnId: `automation-update-${args.automationId}-${Date.now()}`,
      role: 'assistant',
      mode: 'act',
      content: args.content,
      contentType: 'text',
      parts: [{ type: 'text', text: args.content }],
    }, { throwOnError: true })
  }

  async createManualRun(args: {
    automationId: string
    scheduledFor: number
    userId: string
  }): Promise<string | null> {
    return await convex.mutation<string | null>('automations/automations:createManualRun', {
      ...args,
      automationId: args.automationId as Id<'automations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async markManualRunStarted(args: {
    conversationId?: string
    now: number
    runId: string
    turnId: string
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:markManualRunStarted', {
      ...args,
      conversationId: (args.conversationId || undefined) as Id<'conversations'> | undefined,
      runId: args.runId as Id<'automationRuns'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async markManualRunCompleted(args: {
    conversationId?: string
    now: number
    runId: string
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:markManualRunCompleted', {
      ...args,
      // Guard against empty strings — Convex's v.optional(v.id()) rejects them.
      conversationId: (args.conversationId || undefined) as Id<'conversations'> | undefined,
      runId: args.runId as Id<'automationRuns'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async markManualRunFailed(args: {
    error: string
    now: number
    runId: string
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:markManualRunFailed', {
      ...args,
      runId: args.runId as Id<'automationRuns'>,
      serverSecret: this.serverSecret,
    })
  }

  async getRunForExecution(args: {
    runId: string
  }): Promise<AutomationExecutionPayload | null> {
    return await convex.query<AutomationExecutionPayload | null>('automations/automations:getRunForExecutionByServer', {
      runId: args.runId as Id<'automationRuns'>,
      serverSecret: this.serverSecret,
    })
  }

  async updateRunWorkflowRunId(args: {
    runId: string
    workflowRunId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:updateRunWorkflowRunIdByServer', {
      runId: args.runId as Id<'automationRuns'>,
      serverSecret: this.serverSecret,
      workflowRunId: args.workflowRunId,
    }, { throwOnError: true })
  }

  async updateSchedulerWorkflowRunId(args: {
    automationId: string
    schedulerWorkflowRunId: string | null
  }): Promise<void> {
    await convex.mutation('automations/automations:updateSchedulerWorkflowRunIdByServer', {
      automationId: args.automationId as Id<'automations'>,
      serverSecret: this.serverSecret,
      schedulerWorkflowRunId: args.schedulerWorkflowRunId,
    }, { throwOnError: true })
  }
}
