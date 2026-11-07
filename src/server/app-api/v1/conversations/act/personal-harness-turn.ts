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
import { transcriptPartIdentity } from '@/shared/chat/transcript-part-identity'
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
      let stop = () => { stopped = true }
      const stream = new ReadableStream<UIMessageChunk>({
        start(controller) {
          stop = () => {
            stopped = true
            try { controller.close() } catch (_error) { /* already closed */ }
          }
          if (input.signal?.aborted) {
            stop()
            return
          }
          input.signal?.addEventListener('abort', stop, { once: true })
          controller.enqueue({ type: 'start', messageId: input.agentRun.assistantMessageId })
          controller.enqueue({
            type: 'message-metadata',
            messageMetadata: {
              harnessAccepted: {
                runId: workflowRun.runId,
                executionGeneration: workflowRun.executionGeneration,
                status: 'running',
              },
              ...(Object.keys(input.sourceCitations).length > 0 ? { sourceCitations: input.sourceCitations } : {}),
            },
          })
          void (async () => {
            let offset = 0
            let partId = ''
            let afterSequence = -1
            while (!stopped && !input.signal?.aborted) {
              const state = await repository.readPublicStreamState({
                actorUserId: input.auth.userId,
                runId: workflowRun.runId,
                afterSequence,
              })
              if (!state) {
                controller.enqueue({ type: 'error', errorText: 'The durable stream is unavailable.' })
                controller.close()
                return
              }
              for (const step of state.transcriptSteps) {
                if (partId) {
                  controller.enqueue({ type: 'text-end', id: partId })
                  controller.enqueue({ type: 'reset-step' })
                }
                partId = ''
                offset = 0
                controller.enqueue({ type: 'start-step' })
                const canonicalPartId = transcriptPartIdentity(
                  workflowRun.runId, step.receiptId, 0, step.executionGeneration,
                )
                if (step.persistence.content) {
                  controller.enqueue({ type: 'text-start', id: canonicalPartId })
                  controller.enqueue({ type: 'text-delta', id: canonicalPartId, delta: step.persistence.content })
                  controller.enqueue({ type: 'text-end', id: canonicalPartId })
                }
                controller.enqueue({
                  type: 'data-harness-transcript-step',
                  id: `${workflowRun.runId}:${step.sequence}`,
                  data: {
                    runId: workflowRun.runId,
                    executionGeneration: step.executionGeneration,
                    receiptId: step.receiptId,
                    sequence: step.sequence,
                    parts: step.persistence.parts,
                  },
                  transient: true,
                } as unknown as UIMessageChunk)
                controller.enqueue({ type: 'finish-step' })
                afterSequence = step.sequence
              }
              if (state.nextSequence !== null) afterSequence = Math.max(afterSequence, state.nextSequence)
              const snapshot = state.snapshot
              if (snapshot) {
                const nextPartId = transcriptPartIdentity(
                  snapshot.runId, snapshot.receiptId, 0, snapshot.executionGeneration,
                )
                if (nextPartId !== partId) {
                  if (partId) {
                    controller.enqueue({ type: 'text-end', id: partId })
                    controller.enqueue({ type: 'finish-step' })
                  }
                  partId = nextPartId
                  offset = 0
                  controller.enqueue({ type: 'start-step' })
                  controller.enqueue({ type: 'text-start', id: partId })
                }
                const text = [snapshot.text, snapshot.truncatedMarker].filter(Boolean).join('\n\n')
                if (text.length > offset) {
                  controller.enqueue({ type: 'text-delta', id: partId, delta: text.slice(offset) })
                  offset = text.length
                }
              }
              if (['completed', 'failed', 'cancelled'].includes(state.status)) {
                if (partId) {
                  controller.enqueue({ type: 'text-end', id: partId })
                  controller.enqueue({ type: 'finish-step' })
                }
                if (state.status === 'failed') {
                  controller.enqueue({ type: 'error', errorText: 'The durable run failed.' })
                }
                controller.enqueue({
                  type: 'finish',
                  finishReason: state.status === 'failed' ? 'error' : 'stop',
                  messageMetadata: {
                    harnessAccepted: {
                      runId: workflowRun.runId,
                      executionGeneration: state.executionGeneration,
                      status: state.status,
                    },
                    ...(Object.keys(input.sourceCitations).length > 0 ? { sourceCitations: input.sourceCitations } : {}),
                  },
                })
                controller.close()
                return
              }
              await new Promise(resolve => setTimeout(resolve, 150))
            }
          })().catch((_error) => {
            if (!stopped) {
              controller.enqueue({ type: 'error', errorText: 'The durable stream is unavailable.' })
              controller.close()
            }
          })
        },
        cancel() {
          stopped = true
          input.signal?.removeEventListener('abort', stop)
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
