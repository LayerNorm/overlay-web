import 'server-only'

import { createHash } from 'node:crypto'
import { createModelCallToUIChunkTransform } from '@ai-sdk/workflow'
import type { ToolSet } from 'ai'
import { after, NextResponse } from 'next/server'
import type { AgentRun } from '@/shared/agents/agent-run'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import type { AuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { convertToModelMessages, createUIMessageStreamResponse, type UIMessage, type UIMessageChunk } from '@/server/ai/sdk'
import { uploadFilePartsForModel } from '@/server/ai/file-upload'
import { createUiMessageMetadataTransform } from '@/server/chat/ui-message-metadata-transform'
import { drainWorkProgress } from '@/server/chat/work-progress-drain'
import { describePersonalChatWorkTools } from '@/server/conversations/personal-chat-work-tools'
import type { PersonalHarnessBudget } from '@/server/harness/personal-admission-policy'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import {
  PersonalHarnessAdmissionConflict,
  PersonalHarnessStartPending,
  personalHarnessAuthentication,
  startPersonalHarness,
} from '@/server/harness/personal-admission'
import type { PersonalHarnessWorkflowInput } from '@/server/harness/personal-workflow-input'

export function isPersonalHarnessRouteEligible(input: {
  authType: AuthenticatedAppUser['authType']
  automationExecution?: boolean
  automationMode?: boolean
}): boolean {
  return (input.authType === 'session' || input.authType === 'access-token' || input.authType === 'api-key')
    && input.automationExecution !== true
    && input.automationMode !== true
}

export function personalHarnessConversationClientId(input: {
  actorUserId: string
  workspaceId: string
  turnId: string
}): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([input.actorUserId, input.workspaceId, input.turnId]))
    .digest('hex')
    .slice(0, 32)
  return `personal-act-${digest}`
}

export async function startPersonalHarnessTurn(input: {
  agentRun: AgentRun
  auth: AuthenticatedAppUser
  budget?: PersonalHarnessBudget
  conversationId: string
  emitWebhook: boolean
  effectiveModelId: string
  goal: string
  hasDynamicApproval: boolean
  instructions: string
  messagesForModel: UIMessage[]
  paid: boolean
  principalId: string
  rawReasoning?: string
  requestId: string
  releaseConcurrency: () => void
  recordProgress: (content: string) => Promise<void>
  sourceCitations: SourceCitationMap
  signal?: AbortSignal
  tools: ToolSet
  toolingContext: PersonalHarnessWorkflowInput['context']
  workspaceId: string
}) {
  let released = false
  const releaseConcurrency = () => {
    if (released) return
    released = true
    input.releaseConcurrency()
  }
  const responseHeaders = () => {
    const headers = new Headers()
    headers.set('x-request-id', input.requestId)
    headers.set('x-overlay-agent-run-id', input.agentRun.id)
    headers.set('x-overlay-conversation-id', input.conversationId)
    return headers
  }

  try {
    const [, definitions] = await Promise.all([
      uploadFilePartsForModel(
        input.messagesForModel as Parameters<typeof uploadFilePartsForModel>[0],
        input.effectiveModelId,
      ),
      describePersonalChatWorkTools(input.tools, input.hasDynamicApproval),
    ])
    const workflow: PersonalHarnessWorkflowInput = {
      access: {
        actorUserId: input.auth.userId,
        runId: `personal:${input.agentRun.id}`,
        conversationId: input.conversationId,
        agentRunId: input.agentRun.id,
        workspaceId: input.workspaceId,
        principalId: input.principalId,
        authentication: personalHarnessAuthentication(input.auth),
      },
      context: input.toolingContext,
      definitions,
      instructions: input.instructions,
      messages: await convertToModelMessages(input.messagesForModel),
      settings: {
        maxOutputTokens: 8_192,
        ...(input.rawReasoning && input.rawReasoning !== 'provider-default'
          ? { reasoning: input.rawReasoning as NonNullable<PersonalHarnessWorkflowInput['settings']>['reasoning'] }
          : {}),
      },
      delivery: { emitWebhook: input.emitWebhook, sourceCitations: input.sourceCitations },
    }
    const workflowRun = await startPersonalHarness({
      workflow,
      agentRun: input.agentRun,
      paid: input.paid,
      goal: input.goal,
      budget: input.budget,
      onAdmitted: releaseConcurrency,
    })
    releaseConcurrency()
    if ('accepted' in workflowRun) {
      const repository = new ConvexHarnessRepository()
      let stopped = false
      const close = (controller: ReadableStreamDefaultController<UIMessageChunk>) => {
        try { controller.close() } catch (_error) { /* already cancelled */ }
      }
      const stream = new ReadableStream<UIMessageChunk>({
        start(controller) {
          const stop = () => {
            stopped = true
            close(controller)
          }
          if (input.signal?.aborted) stop()
          else input.signal?.addEventListener('abort', stop, { once: true })
          void (async () => {
            while (!stopped && !input.signal?.aborted) {
              try {
                const state = await repository.get({
                  actorUserId: input.auth.userId,
                  runId: workflowRun.runId,
                })
                if (!state || ['completed', 'failed', 'cancelled'].includes(state.status)) {
                  close(controller)
                  input.signal?.removeEventListener('abort', stop)
                  return
                }
              } catch (_error) {
                if (stopped) return
              }
              await new Promise(resolve => setTimeout(resolve, 250))
            }
          })().catch((_error) => close(controller))
        },
        cancel() {
          stopped = true
        },
      })
      const response = createUIMessageStreamResponse({ stream })
      const headers = responseHeaders()
      headers.set('x-overlay-harness-run-id', workflowRun.runId)
      response.headers.forEach((value, name) => headers.set(name, value))
      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      })
    }
    const stream = workflowRun.getReadable()
      .pipeThrough(createModelCallToUIChunkTransform())
      .pipeThrough(createUiMessageMetadataTransform(
        Object.keys(input.sourceCitations).length > 0
          ? { sourceCitations: input.sourceCitations }
          : undefined,
      ))
    const [clientChunks, progressChunks] = stream.tee()
    const response = createUIMessageStreamResponse({ stream: clientChunks })
    after(async () => {
      await drainWorkProgress(progressChunks, {
        publish: input.recordProgress,
        runId: input.agentRun.id,
      })
    })
    const headers = new Headers(response.headers)
    responseHeaders().forEach((value, name) => headers.set(name, value))
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    })
  } catch (error) {
    releaseConcurrency()
    const headers = responseHeaders()
    if (error instanceof PersonalHarnessAdmissionConflict) {
      return NextResponse.json({
        error: 'personal_harness_conflict',
        message: error.message,
        conversationId: input.conversationId,
        agentRunId: input.agentRun.id,
      }, { status: 409, headers })
    }
    if (error instanceof PersonalHarnessStartPending) {
      return NextResponse.json({
        error: 'personal_harness_start_pending',
        message: error.message,
        conversationId: input.conversationId,
        agentRunId: input.agentRun.id,
      }, { status: 503, headers })
    }
    throw error
  }
}
