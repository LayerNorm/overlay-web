import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  AutomationExecutionPayload,
  AutomationForUpdateNote,
  AutomationRepository,
  AutomationRunTarget,
} from './AutomationRepository'
import type { Id } from '../../../convex/_generated/dataModel'

export class ConvexAutomationRepository implements AutomationRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async listAutomations(args: {
    includeDeleted?: boolean
    projectId?: string
    userId: string
  }): Promise<unknown[]> {
    return await convex.query<unknown[]>('automations/automations:list', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async listRuns(args: {
    automationId: Id<'automations'>
    userId: string
  }): Promise<unknown[]> {
    return await convex.query<unknown[]>('automations/automations:listRuns', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async getAutomation(args: {
    automationId: Id<'automations'>
    userId: string
  }): Promise<AutomationForUpdateNote | null> {
    return await convex.query<AutomationForUpdateNote | null>('automations/automations:get', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async getAutomationRunTarget(args: {
    automationId: Id<'automations'>
    userId: string
  }): Promise<AutomationRunTarget | null> {
    return await convex.query<AutomationRunTarget | null>('automations/automations:get', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async getEntitlements(args: {
    userId: string
  }): Promise<{ planKind?: 'free' | 'paid' } | null> {
    return await convex.query<{ planKind?: 'free' | 'paid' } | null>('platform/usage:getEntitlementsByServer', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async createAutomation(args: Record<string, unknown> & {
    userId: string
  }): Promise<unknown> {
    return await convex.mutation('automations/automations:create', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async updateAutomation(args: Record<string, unknown> & {
    automationId: Id<'automations'>
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:update', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async pauseAutomation(args: {
    automationId: Id<'automations'>
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:pause', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async resumeAutomation(args: {
    automationId: Id<'automations'>
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:resume', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async removeAutomation(args: {
    automationId: Id<'automations'>
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:remove', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async removeConversation(args: {
    conversationId: Id<'conversations'>
    userId: string
  }): Promise<void> {
    await convex.mutation('chat/conversations:remove', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async appendAutomationUpdateNote(args: {
    automationId: Id<'automations'>
    content: string
    conversationId: Id<'conversations'>
    userId: string
  }): Promise<void> {
    await convex.mutation('chat/conversations:addMessage', {
      conversationId: args.conversationId,
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
    automationId: Id<'automations'>
    scheduledFor: number
    userId: string
  }): Promise<Id<'automationRuns'> | null> {
    return await convex.mutation<Id<'automationRuns'> | null>('automations/automations:createManualRun', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async markManualRunStarted(args: {
    conversationId?: Id<'conversations'>
    now: number
    runId: Id<'automationRuns'>
    turnId: string
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:markManualRunStarted', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async markManualRunCompleted(args: {
    conversationId: Id<'conversations'>
    now: number
    runId: Id<'automationRuns'>
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:markManualRunCompleted', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async markManualRunFailed(args: {
    error: string
    now: number
    runId: Id<'automationRuns'>
    userId: string
  }): Promise<void> {
    await convex.mutation('automations/automations:markManualRunFailed', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async getRunForExecution(args: {
    runId: Id<'automationRuns'>
  }): Promise<AutomationExecutionPayload | null> {
    return await convex.query<AutomationExecutionPayload | null>('automations/automations:getRunForExecutionByServer', {
      runId: args.runId,
      serverSecret: this.serverSecret,
    })
  }
}
