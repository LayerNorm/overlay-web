import type { AgentRunResource } from '@overlay/api-client'
import { appJson, appRequest, appXhrStreamSse } from './appApi'
import { mobileOverlayAppClient } from './overlayClient'
import { updateChatTitle } from './chatStorage'
import type { ChatMentionItem } from './chatTypes'

// ---------------------------------------------------------------------------
// Conversation lifecycle: rename / archive / unarchive / delete / share.
// Mirrors web `ChatInlinePanel` + `ExportMenu` semantics over the same BFF
// endpoints — archive/delete are participant-state or scoped deletes, never
// raw conversation deletes for shared threads.
// ---------------------------------------------------------------------------

export type ConversationLifecycleScope = 'self' | 'everyone'

export async function archiveConversation(
  conversationId: string,
  scope: ConversationLifecycleScope = 'self',
): Promise<void> {
  await mobileOverlayAppClient.conversations.updateParticipantState(conversationId, {
    archived: true,
    archiveScope: scope,
  })
}

export async function unarchiveConversation(conversationId: string): Promise<void> {
  await mobileOverlayAppClient.conversations.updateParticipantState(conversationId, {
    archived: false,
  })
}

export async function deleteConversation(
  conversationId: string,
  scope: ConversationLifecycleScope = 'self',
): Promise<void> {
  const res = await mobileOverlayAppClient.conversations.deleteResponse({ conversationId, scope })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Could not delete conversation')
  }
}

export async function renameConversation(conversationId: string, title: string): Promise<void> {
  await updateChatTitle(conversationId, title)
}

export type ConversationShareVisibility = 'private' | 'public'

export interface ConversationShareState {
  visibility: ConversationShareVisibility
  token?: string
  url: string | null
}

export async function setConversationShareVisibility(
  conversationId: string,
  visibility: ConversationShareVisibility,
): Promise<ConversationShareState> {
  const res = await appRequest('/api/v1/conversations/share', {
    method: 'PATCH',
    json: { conversationId, visibility },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Could not update sharing')
  }
  return (await res.json()) as ConversationShareState
}

// ---------------------------------------------------------------------------
// Agent run lifecycle — the server runs each act turn as an AgentRunResource;
// `currentRun` is the single source of truth for status + approval requests.
// ---------------------------------------------------------------------------

export async function fetchCurrentRun(conversationId: string): Promise<AgentRunResource | null> {
  const { run } = await mobileOverlayAppClient.conversations.currentRun(conversationId)
  return run
}

export async function submitRunApproval(input: {
  conversationId: string
  agentRunId: string
  token: string
  approved: boolean
}): Promise<void> {
  await mobileOverlayAppClient.conversations.submitRunApproval(input)
}

// ---------------------------------------------------------------------------
// Chat suggestions — `GET /api/v1/chat-suggestions` → `{ prompts, stale }`.
// ---------------------------------------------------------------------------

export async function fetchChatSuggestions(): Promise<string[]> {
  const res = await appRequest('/api/v1/chat-suggestions')
  if (!res.ok) return []
  const data = (await res.json().catch(() => ({}))) as { prompts?: string[] }
  return Array.isArray(data.prompts) ? data.prompts.filter((p) => typeof p === 'string' && p.trim()) : []
}

// ---------------------------------------------------------------------------
// Mention suggestions are deferred until native subscriptions are available.
// ---------------------------------------------------------------------------


export async function searchMentions(query: string): Promise<ChatMentionItem[]> {
  // Convex-native in Phase 1
  return []
}

// ---------------------------------------------------------------------------
// Media generation — image is a plain JSON POST; video streams SSE progress
// events ending in `completed`/`failed`. Mirrors web `chatMediaGeneration.ts`.
// ---------------------------------------------------------------------------

export interface GeneratedMediaResult {
  url?: string
  modelUsed?: string
  outputId?: string
}

export async function generateImage(input: {
  prompt: string
  modelId: string
  conversationId?: string
  temporaryChat?: boolean
  turnId: string
  imageUrl?: string
}): Promise<GeneratedMediaResult> {
  const res = await appRequest('/api/v1/generate-image', {
    method: 'POST',
    json: {
      prompt: input.prompt,
      modelId: input.modelId,
      ...(input.temporaryChat ? { temporaryChat: true } : { conversationId: input.conversationId }),
      turnId: input.turnId,
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    },
    // Generations can run minutes; `0` disables the default 10s request timeout.
    timeoutMs: 0,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    throw new Error(err.message || err.error || 'Image generation failed')
  }
  return (await res.json()) as GeneratedMediaResult
}

type VideoStreamEvent = {
  type: string
  url?: string
  modelUsed?: string
  outputId?: string
  error?: string
}

export async function generateVideo(input: {
  prompt: string
  modelId: string
  conversationId?: string
  temporaryChat?: boolean
  turnId: string
  imageUrl?: string
}): Promise<GeneratedMediaResult> {
  let final: GeneratedMediaResult | null = null
  let failure: string | null = null
  for await (const evt of appXhrStreamSse<VideoStreamEvent>('/api/v1/generate-video', {
    method: 'POST',
    json: {
      prompt: input.prompt,
      modelId: input.modelId,
      ...(input.temporaryChat ? { temporaryChat: true } : { conversationId: input.conversationId }),
      turnId: input.turnId,
      videoSubMode: input.imageUrl ? 'image-to-video' : 'text-to-video',
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    },
  })) {
    if (evt.type === 'completed') {
      final = { url: evt.url, modelUsed: evt.modelUsed, outputId: evt.outputId }
    } else if (evt.type === 'failed') {
      failure = evt.error || 'Video generation failed'
    }
  }
  if (final?.url) return final
  throw new Error(failure || 'Video generation failed')
}
