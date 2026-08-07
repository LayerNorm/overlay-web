import 'server-only'

import type { UIMessage } from 'ai'
import { getOverlayServerContext } from '@/server/bootstrap'
import { buildServiceAuthToken, getServiceAuthHeaderName } from '@/server/auth/service-auth'
import { getBaseUrl } from '@/server/web/app-url'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { parseMentionTokens } from '@/shared/knowledge/mention-tokens'
import type { Id } from '../../../convex/_generated/dataModel'

export type ScheduledAutomationTurn = {
  automationId?: string
  runId: string
  userId: string
  name: string
  description?: string
  instructions: string
  projectId?: string
  modelId?: string
  conversationId?: string
  turnId: string
  scheduledFor: number
  baseUrl?: string
}

const SCHEDULED_AUTOMATION_ACT_ABORT_TIMEOUT_MS = 720_000

async function settleScheduledAutomationTurn(params: {
  conversationId: string
  userId: string
  turnId: string
  status: 'completed' | 'error'
  fallbackText: string
}) {
  await getOverlayServerContext().appData.repositories.conversations
    .settleGeneratingMessagesForTurn({
      conversationId: params.conversationId as Id<'conversations'>,
      userId: params.userId,
      turnId: params.turnId,
      status: params.status,
      fallbackText: params.fallbackText,
    })
}

async function drainResponseBody(response: Response): Promise<void> {
  if (!response.body) return
  const reader = response.body.getReader()
  try {
    while (!(await reader.read()).done) {
      // Keep consuming the UI stream so the existing act route can finish and persist.
    }
  } finally {
    reader.releaseLock()
  }
}

function buildAutomationUserMessage(input: ScheduledAutomationTurn): string {
  const scheduledAt = new Date(input.scheduledFor).toISOString()
  return [
    `Execute saved automation now: ${input.name}`,
    input.description ? `Description: ${input.description}` : '',
    `Scheduled for: ${scheduledAt}`,
    input.automationId ? `Automation ID: ${input.automationId}` : '',
    '',
    'Current saved instructions to execute:',
    input.instructions,
  ].filter(Boolean).join('\n')
}

function buildAutomationSystemPrompt(input: ScheduledAutomationTurn): string {
  return [
    'You are running a scheduled automation for the user.',
    'Execute the stored automation instructions without asking clarifying questions.',
    'Do not create, draft, update, pause, delete, or propose a new automation. This run is already attached to an existing saved automation.',
    'If required auth, context, or tool access is missing, stop and write a concise failure summary.',
    'Only use tools that are clearly authorized by the stored automation and connected for this user.',
    'End with a concise summary of what was completed and what still needs attention.',
    '',
    `Automation name: ${input.name}`,
    input.description ? `Automation description: ${input.description}` : '',
  ].filter(Boolean).join('\n')
}

export async function runActTurnForScheduledAutomation(input: ScheduledAutomationTurn): Promise<{
  conversationId: string
}> {
  const title = `Automation: ${input.name}`
  const overlayContext = getOverlayServerContext()

  // Resolve the user's active workspace so we can pass it to both
  // createConversation and the act route. Without this, Convex's
  // createConversation binds the conversation to the user's personal
  // workspace, while the BFF's resolveActiveWorkspace may resolve a
  // different active workspace — causing assertResourceWorkspace to fail.
  const workspace = await overlayContext.workspaceService.resolveActiveWorkspace(input.userId)
  const workspaceId = workspace.workspace.id

  const conversationId = input.conversationId ?? await overlayContext
    .appData.repositories.conversations.createConversation({
      userId: input.userId,
      title,
      projectId: input.projectId,
      askModelIds: [input.modelId || DEFAULT_MODEL_ID],
      actModelId: input.modelId || DEFAULT_MODEL_ID,
      lastMode: 'act',
      isAutomation: true,
      workspaceId,
    })

  if (!conversationId) {
    throw new Error('Failed to create automation conversation')
  }

  const message: UIMessage = {
    id: input.turnId,
    role: 'user',
    parts: [{ type: 'text', text: buildAutomationUserMessage(input) }],
  }
  const path = '/api/v1/conversations/act'
  const serviceToken = await buildServiceAuthToken({
    userId: input.userId,
    method: 'POST',
    path,
  })
  const baseUrl = input.baseUrl || getBaseUrl()
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': `automation:${input.runId}:${input.turnId}`,
        [getServiceAuthHeaderName()]: serviceToken,
        'x-overlay-workspace-id': workspaceId,
      },
      body: JSON.stringify({
        messages: [message],
        systemPrompt: buildAutomationSystemPrompt(input),
        conversationId,
        turnId: input.turnId,
        modelId: input.modelId || DEFAULT_MODEL_ID,
        userId: input.userId,
        automationExecution: true,
        actAbortTimeoutMs: SCHEDULED_AUTOMATION_ACT_ABORT_TIMEOUT_MS,
        // Forward any @mention tokens embedded in the saved instructions so the act
        // route's mention-context resolver can inject the same lightweight metadata
        // that interactive chats use.
        mentions: parseMentionTokens(input.instructions)
          .map((m) => ({ type: m.type, id: m.id, name: m.name || m.id })),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch((_error) => '')
      throw new Error(errorText || `Act route failed with ${response.status}`)
    }

    await drainResponseBody(response)
    await settleScheduledAutomationTurn({
      conversationId,
      userId: input.userId,
      turnId: input.turnId,
      status: 'completed',
      fallbackText: 'Automation run finished, but no final assistant response was saved.',
    })
  } catch (error) {
    await settleScheduledAutomationTurn({
      conversationId,
      userId: input.userId,
      turnId: input.turnId,
      status: 'error',
      fallbackText: error instanceof Error
        ? `Automation run failed: ${error.message}`
        : 'Automation run failed before a final response was saved.',
    }).catch((_error) => null)
    throw error
  }
  return { conversationId }
}
