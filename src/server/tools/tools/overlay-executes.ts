import 'server-only'
import { roomListScope } from './room-scope'

import type { SandboxInstance } from '@overlay/sandbox-runtime'
import { agentGatewayExecEnv } from '@/server/ai/agent-gateway/env'
import { machineForAgent, touchEnvironmentMachine } from '@/server/agents/environment-machine'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  ComputerDesktopDriverError,
  openUrl as openComputerUrl,
  runBrowserAction as runComputerBrowserAction,
  runComputerDriverCommand,
  run as runComputerDesktopCommand,
} from '@/server/computers/ComputerDesktopDriver'
import {
  ComputerServiceError,
  type ComputerActor,
} from '@/server/computers/ComputerService'
import type { Computer, ComputerOwnerType } from '@overlay/workspace-contracts/computers'
import { callInternalApi, callInternalApiGet, toolAuthBody } from './internal-api'
import type { OverlayToolsOptions } from './types'
import { toolRequiresApproval } from '@overlay/tools-core/policy'

/**
 * Memory writes carry an explicit owner when an agent is driving the turn, so
 * the agent's memory accrues to the agent rather than to whoever summoned it.
 * Omitted entirely for a human turn, which leaves the route on its default of
 * the authenticated user.
 */
function memoryOwnerBody(options: OverlayToolsOptions): { memoryOwnerId?: string } {
  return options.memoryOwnerId && options.memoryOwnerId !== options.userId
    ? { memoryOwnerId: options.memoryOwnerId }
    : {}
}

/** In a room others can read, searches return only what the workspace shares. */
function roomSearchBody(options: OverlayToolsOptions): { workspaceOnly?: true } {
  return options.sharedRoom ? { workspaceOnly: true } : {}
}
import { buildAutomationDraftFromTurn, type AutomationScheduleDraft } from '@/features/automations/lib/automation-drafts'
import { buildSkillDraftFromTurn } from '@/features/automations/lib/skill-drafts'
import { unwrapPaginatedData } from '@/shared/api/pagination'
import {
  GENERATED_UI_VERSION,
  generatedUiDraftContainsCode,
  normalizeGeneratedUiData,
} from '@overlay/chat-core/generated-ui'

export async function executeSearchKnowledge(
  options: OverlayToolsOptions,
  input: { query: string; sourceKind?: 'file' | 'memory' },
) {
  const { query, sourceKind } = input
  if (options.memoryEnabled === false && sourceKind === 'memory') {
    return { success: false, error: 'Memory is off for this chat turn.' }
  }
  try {
    const res = await callInternalApi(
      '/api/v1/knowledge/search',
      {
        query,
        sourceKind: options.memoryEnabled === false ? 'file' : sourceKind,
        ...roomSearchBody(options),
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Search failed' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Search failed' }
    }
    const data = (await res.json()) as { chunks?: Array<Record<string, unknown>> }
    return { success: true, chunks: data.chunks ?? [] }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Search failed',
    }
  }
}

function generatedUiId(kind: string, payload: unknown): string {
  const raw = JSON.stringify(payload)
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0
  }
  return `${kind.replace(/[^a-z0-9]+/gi, '-')}-${Math.abs(hash).toString(36)}`
}

export async function executePresentGeneratedUi(
  _options: OverlayToolsOptions,
  input: Record<string, unknown>,
) {
  if (generatedUiDraftContainsCode(input)) {
    return {
      success: false,
      error: 'Code must be returned in a fenced Markdown code block, not a generated UI draft.',
    }
  }
  const id = typeof input.id === 'string' && input.id.trim()
    ? input.id.trim()
    : undefined
  const generatedUi = normalizeGeneratedUiData({
    ...input,
    version: GENERATED_UI_VERSION,
  })
  if (!generatedUi) {
    return { success: false, error: 'Invalid generated UI payload.' }
  }
  return {
    success: true,
    id: id ?? generatedUiId(generatedUi.kind, generatedUi),
    generatedUi,
  }
}

export async function executeSearchInFiles(
  options: OverlayToolsOptions,
  input: { fileIds: string[]; query: string },
) {
  const { fileIds, query } = input
  try {
    const res = await callInternalApi(
      '/api/v1/files/search-text',
      {
        fileIds,
        query,
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Search failed' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Search in files failed' }
    }
    const data = (await res.json()) as {
      success?: boolean
      matches?: Array<Record<string, unknown>>
      truncated?: boolean
    }
    return {
      success: true as const,
      matches: data.matches ?? [],
      truncated: Boolean(data.truncated),
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Search in files failed',
    }
  }
}

export async function executeSaveMemory(
  options: OverlayToolsOptions,
  input: {
    content: string
    source?: 'chat' | 'note' | 'manual'
    type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
    importance?: number
    tags?: string[]
  },
) {
  const { content, source, type, importance, tags } = input
  try {
    const res = await callInternalApi(
      '/api/v1/memory',
      {
        content,
        source: source ?? 'chat',
        type,
        importance,
        conversationId: options.conversationId,
        turnId: options.turnId,
        tags,
        ...memoryOwnerBody(options),
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Failed to save' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Failed to save memory' }
    }
    const data = (await res.json()) as { id?: string }
    return { success: true, memoryId: data.id }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to save memory',
    }
  }
}

export async function executeSearchMemory(
  options: OverlayToolsOptions,
  input: { query: string },
) {
  if (options.memoryEnabled === false) {
    return { success: false, error: 'Memory is off for this turn.' }
  }
  const query = input.query?.trim()
  if (!query) return { success: false, error: 'A query is required to search memory.' }
  try {
    const res = await callInternalApi(
      '/api/v1/knowledge/search',
      {
        query,
        sourceKind: 'memory',
        ...roomSearchBody(options),
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Memory search failed' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Memory search failed' }
    }
    const data = (await res.json()) as { chunks?: Array<Record<string, unknown>> }
    const memories = (data.chunks ?? []).map((chunk) => ({
      content: chunk.text,
      memoryId: chunk.sourceId,
      title: chunk.title,
    }))
    return {
      success: true,
      memories,
      ...(memories.length === 0
        ? { note: 'No memories matched. Nothing has been remembered about this yet.' }
        : {}),
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Memory search failed',
    }
  }
}

/**
 * Verbatim transcript layer: raw messages indexed under sourceKind 'message'.
 * Chunks carry a `YYYY-MM-DD · Speaker` title, so each hit is citation-ready
 * (when it was said, who said it) without a second lookup.
 */
export async function executeSearchMessages(
  options: OverlayToolsOptions,
  input: { query: string },
) {
  if (options.memoryEnabled === false) {
    return { success: false, error: 'Memory is off for this turn.' }
  }
  const query = input.query?.trim()
  if (!query) return { success: false, error: 'A query is required to search messages.' }
  try {
    const res = await callInternalApi(
      '/api/v1/knowledge/search',
      {
        query,
        sourceKind: 'message',
        ...roomSearchBody(options),
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Message search failed' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Message search failed' }
    }
    const data = (await res.json()) as { chunks?: Array<Record<string, unknown>> }
    const messages = (data.chunks ?? []).map((chunk) => ({
      content: chunk.text,
      messageId: chunk.sourceId,
      title: chunk.title,
    }))
    return {
      success: true,
      messages,
      ...(messages.length === 0
        ? { note: 'No past messages matched. Try search_memory for distilled facts, or a different phrasing.' }
        : {}),
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Message search failed',
    }
  }
}

export async function executeSaveMemoryBatch(
  options: OverlayToolsOptions,
  input: {
    memories: Array<{
      content: string
      type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
      importance?: number
      tags?: string[]
    }>
    source?: 'chat' | 'note' | 'manual'
  },
) {
  try {
    const { memories, source } = input
    if (!Array.isArray(memories) || memories.length === 0) {
      return {
        success: false,
        results: [],
        saved: 0,
        failed: 0,
        error: 'No memories provided',
      }
    }

    const bounded = memories
      .slice(0, 10)
      .filter((memory) => typeof memory.content === 'string' && memory.content.trim())
    const results = await Promise.all(
      bounded.map((memory) => executeSaveMemory(options, { ...memory, source })),
    )
    const successCount = results.filter((r) => r.success).length
    return {
      success: successCount > 0,
      results,
      saved: successCount,
      failed: results.length - successCount,
      ...(successCount === 0
        ? { error: results.find((r) => r.error)?.error ?? 'Failed to save memories' }
        : {}),
    }
  } catch (err) {
    return {
      success: false,
      results: [],
      saved: 0,
      failed: Array.isArray(input.memories) ? Math.min(input.memories.length, 10) : 0,
      error: err instanceof Error ? err.message : 'Failed to save memories',
    }
  }
}

export async function executeUpdateMemory(
  options: OverlayToolsOptions,
  input: {
    memoryId: string
    content: string
    type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
    importance?: number
    tags?: string[]
  },
) {
  const { memoryId, content, type, importance, tags } = input
  try {
    const res = await callInternalApi(
      '/api/v1/memory',
      { memoryId, content, type, importance, tags, ...memoryOwnerBody(options), ...toolAuthBody(options) },
      options.accessToken,
      options.baseUrl,
      { method: 'PATCH', forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Failed to update' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Failed to update memory' }
    }
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update memory',
    }
  }
}

export async function executeDeleteMemory(options: OverlayToolsOptions, input: { memoryId: string }) {
  const { memoryId } = input
  try {
    const res = await callInternalApi(
      '/api/v1/memory',
      { memoryId, ...memoryOwnerBody(options), ...toolAuthBody(options) },
      options.accessToken,
      options.baseUrl,
      { method: 'DELETE', forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Failed to delete' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Failed to delete memory' }
    }
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete memory',
    }
  }
}

export async function executeListSkills(
  options: OverlayToolsOptions,
  input: { query?: string; scope?: 'personal' | 'workspace' },
) {
  try {
    const res = await callInternalApiGet(
      `/api/v1/skills?limit=100${roomListScope(options, input.scope) ? `&view=${roomListScope(options, input.scope)}` : ''}`,
      options.accessToken,
      options.baseUrl,
      options.forwardCookie,
      options.serverSecret,
      options.userId,
      options.workspaceId,
    )
    if (!res.ok) {
      return { success: false, error: 'Failed to fetch skills' }
    }
    const skills = unwrapPaginatedData<{
      _id: string
      name: string
      description?: string
      instructions: string
      enabled?: boolean
    }>(await res.json())
    const enabledSkills = skills.filter((s) => s.enabled !== false)
    if (input.query) {
      const q = input.query.toLowerCase()
      const filtered = enabledSkills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description ?? '').toLowerCase().includes(q) ||
          s.instructions.toLowerCase().includes(q),
      )
      return { success: true, skills: filtered }
    }
    return { success: true, skills: enabledSkills }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to list skills',
    }
  }
}

export async function executeListAutomations(
  options: OverlayToolsOptions,
  input: { query?: string; scope?: 'personal' | 'workspace' },
) {
  try {
    const res = await callInternalApiGet(
      `/api/v1/automations?limit=100${roomListScope(options, input.scope) ? `&view=${roomListScope(options, input.scope)}` : ''}`,
      options.accessToken,
      options.baseUrl,
      options.forwardCookie,
      options.serverSecret,
      options.userId,
      options.workspaceId,
    )
    if (!res.ok) {
      return { success: false, error: 'Failed to fetch automations' }
    }
    const automations = unwrapPaginatedData<{
      _id: string
      name: string
      description?: string
      instructions: string
      enabled: boolean
      schedule?: Record<string, unknown>
      nextRunAt?: number
      lastRunAt?: number
      lastError?: string
    }>(await res.json())
    if (input.query) {
      const q = input.query.toLowerCase()
      return {
        success: true,
        automations: automations.filter(
          (automation) =>
            automation.name.toLowerCase().includes(q) ||
            (automation.description ?? '').toLowerCase().includes(q) ||
            automation.instructions.toLowerCase().includes(q),
        ),
      }
    }
    return { success: true, automations }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to list automations',
    }
  }
}

export async function executeDraftAutomationFromChat(
  _options: OverlayToolsOptions,
  input: {
    userText: string
    assistantText?: string
    reason?: string
    timezone?: string
  },
) {
  try {
    return {
      success: true,
      draft: buildAutomationDraftFromTurn(input),
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to draft automation',
    }
  }
}

/**
 * Normalize a schedule input that may have been stringified by the LLM.
 * If the input is a string, parse it as JSON. If it's already an object,
 * return it as-is. If parsing fails, return the original value so the
 * downstream validation can produce a meaningful error.
 */
function normalizeScheduleInput(schedule: unknown): unknown {
  if (typeof schedule === 'string') {
    try {
      return JSON.parse(schedule)
    } catch (_error) {
      // Hand the raw value back so schedule validation reports the real problem.
      return schedule
    }
  }
  return schedule
}

export async function executeCreateAutomation(
  options: OverlayToolsOptions,
  input: {
    name: string
    description: string
    instructions: string
    schedule: AutomationScheduleDraft
    timezone?: string
    enabled?: boolean
    modelId?: string
    graphSource?: string
    sourceConversationId?: string
  },
) {
  try {
    const automationId = options.automationId?.trim()
    // Defensive: LLMs sometimes stringify the schedule object instead of
    // passing it as a JSON object. Parse it back to an object if needed.
    const schedule = normalizeScheduleInput(input.schedule)
    const res = await callInternalApi(
      '/api/v1/automations',
      {
        ...input,
        schedule,
        ...(automationId ? { automationId } : {}),
        sourceConversationId: input.sourceConversationId ?? options.conversationId,
        enabled: input.enabled ?? true,
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      {
        ...(automationId ? { method: 'PATCH' as const } : {}),
        forwardCookie: options.forwardCookie,
      },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Failed to create automation' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Failed to create automation' }
    }
    const data = (await res.json()) as { id?: string }
    return { success: true, automationId: automationId ?? data.id }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create automation',
    }
  }
}

export async function executeUpdateAutomation(
  options: OverlayToolsOptions,
  input: {
    automationId: string
    name?: string
    description?: string
    instructions?: string
    schedule?: AutomationScheduleDraft
    timezone?: string
    enabled?: boolean
    modelId?: string
  },
) {
  try {
    const schedule = input.schedule ? normalizeScheduleInput(input.schedule) : input.schedule
    const res = await callInternalApi(
      '/api/v1/automations',
      // Auth fields first: `toolAuthBody` carries the *running* automation's id (undefined in chat), which would
      // otherwise overwrite the automation being changed.
      { ...toolAuthBody(options), ...input, schedule },
      options.accessToken,
      options.baseUrl,
      { method: 'PATCH', forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Failed to update automation' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Failed to update automation' }
    }
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update automation',
    }
  }
}

export async function executePauseAutomation(options: OverlayToolsOptions, input: { automationId: string }) {
  try {
    const res = await callInternalApi(
      '/api/v1/automations',
      { ...toolAuthBody(options), automationId: input.automationId, action: 'pause' },
      options.accessToken,
      options.baseUrl,
      { method: 'PATCH', forwardCookie: options.forwardCookie },
    )
    if (!res.ok) return { success: false, error: 'Failed to pause automation' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to pause automation' }
  }
}

export async function executeCreateAgent(
  options: OverlayToolsOptions,
  input: {
    name: string
    description?: string
    instructions: string
    modelId?: string
    avatarColor?: string
    avatarShape?: string
    visibility?: string
  },
) {
  try {
    const res = await callInternalApi(
      '/api/v1/agents',
      { ...input, ...toolAuthBody(options) },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Failed to create agent' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Failed to create agent' }
    }
    const data = (await res.json()) as { agent?: { id?: string; name?: string } }
    return { success: true, agentId: data.agent?.id, name: data.agent?.name }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create agent',
    }
  }
}

export async function executeUpdateAgent(
  options: OverlayToolsOptions,
  input: {
    agentId: string
    name?: string
    description?: string
    instructions?: string
    modelId?: string
    avatarColor?: string
    avatarShape?: string
    visibility?: string
  },
) {
  try {
    const { agentId, ...patch } = input
    const res = await callInternalApi(
      `/api/v1/agents/${encodeURIComponent(agentId)}`,
      { ...patch, ...toolAuthBody(options) },
      options.accessToken,
      options.baseUrl,
      { method: 'PATCH', forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ error: 'Failed to update agent' }))
      return { success: false, error: (err as { error?: string }).error ?? 'Failed to update agent' }
    }
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update agent',
    }
  }
}

export async function executeDeleteAutomation(options: OverlayToolsOptions, input: { automationId: string }) {
  try {
    const res = await callInternalApi(
      '/api/v1/automations',
      { ...toolAuthBody(options), automationId: input.automationId },
      options.accessToken,
      options.baseUrl,
      { method: 'DELETE', forwardCookie: options.forwardCookie },
    )
    if (!res.ok) return { success: false, error: 'Failed to delete automation' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete automation' }
  }
}

export async function executeGenerateImage(
  options: OverlayToolsOptions,
  input: {
    prompt: string
    modelId?: string
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3'
    referenceImageUrl?: string
  },
) {
  const { prompt, modelId, aspectRatio, referenceImageUrl } = input
  try {
    const res = await callInternalApi(
      '/api/v1/generate-image',
      {
        prompt,
        modelId,
        aspectRatio,
        imageUrl: referenceImageUrl,
        conversationId: options.conversationId,
        turnId: options.turnId,
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ message: 'Unknown error' }))
      return {
        success: false,
        error: (err as { message?: string }).message ?? 'Image generation failed',
      }
    }
    const data = (await res.json()) as { outputId?: string; url?: string; modelUsed?: string }
    return {
      success: true,
      outputId: data.outputId,
      modelUsed: data.modelUsed,
      message: `Image generated successfully with ${data.modelUsed}. OutputId: ${data.outputId}`,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Image generation failed',
    }
  }
}

export async function executeGenerateVideo(
  options: OverlayToolsOptions,
  input: {
    prompt: string
    modelId?: string
    aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3'
    duration?: number
    videoSubMode?: string
    imageUrl?: string
    referenceVideoUrl?: string
  },
) {
  const { prompt, modelId, aspectRatio, duration, videoSubMode, imageUrl, referenceVideoUrl } = input
  try {
    const res = await callInternalApi(
      '/api/v1/generate-video',
      {
        prompt,
        modelId,
        aspectRatio,
        duration,
        videoSubMode,
        imageUrl: imageUrl ?? referenceVideoUrl,
        conversationId: options.conversationId,
        turnId: options.turnId,
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )

    if (!res.ok) {
      const err = await res.json().catch((_error) => ({ message: 'Unknown error' }))
      return {
        success: false,
        status: 'failed',
        error: (err as { message?: string }).message ?? 'Video generation failed',
      }
    }

    const reader = res.body?.getReader()
    if (!reader) {
      return { success: false, status: 'failed', error: 'No response stream' }
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let outputId: string | null = null
    let finalResult: Record<string, unknown> | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6)) as Record<string, unknown>
          if (event.type === 'started') {
            outputId = event.outputId as string
          } else if (event.type === 'completed') {
            finalResult = event
          } else if (event.type === 'failed') {
            return {
              success: false,
              status: 'failed',
              outputId: outputId ?? (event.outputId as string),
              error: event.error,
            }
          }
        } catch (_error) {
          // ignore malformed SSE lines
        }
      }
    }

    if (finalResult) {
      return {
        success: true,
        status: 'completed',
        outputId: finalResult.outputId,
        modelUsed: finalResult.modelUsed,
        message: `Video generated successfully with ${finalResult.modelUsed}. OutputId: ${finalResult.outputId}`,
      }
    }

    return {
      success: true,
      status: 'pending',
      outputId,
      message: `Video generation started (outputId: ${outputId}). It will appear in the Outputs tab when complete.`,
    }
  } catch (err) {
    return {
      success: false,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Video generation failed',
    }
  }
}

export async function executeDraftSkillFromChat(
  _options: OverlayToolsOptions,
  input: {
    userText: string
    assistantText?: string
    reason?: string
  },
) {
  try {
    return {
      success: true,
      draft: buildSkillDraftFromTurn(input),
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to draft skill',
    }
  }
}


/**
 * Computer tools resolve the executing owner's bound computer through
 * `ComputerService` — never a model-supplied computer id — and let the
 * service apply its owner/agent-creator access rules.
 */
const COMPUTER_EXEC_MAX_OUTPUT_CHARS = 40_000
const COMPUTER_READ_MAX_BYTES = 256 * 1024
const COMPUTER_EXEC_TIMEOUT_DEFAULT_MS = 60_000
const COMPUTER_EXEC_TIMEOUT_MAX_MS = 300_000
const COMPUTER_TERMINAL_ENV_TTL_MS = 30 * 60 * 1000

function truncateOutput(value: string): { text: string; truncated: boolean } {
  if (value.length <= COMPUTER_EXEC_MAX_OUTPUT_CHARS) {
    return { text: value, truncated: false }
  }
  return { text: value.slice(0, COMPUTER_EXEC_MAX_OUTPUT_CHARS), truncated: true }
}

function computerErrorResult(err: unknown, fallback: string) {
  if (err instanceof ComputerServiceError) {
    return { success: false as const, error: err.message, code: err.code }
  }
  if (err instanceof Error && err.message === 'COMPUTER_MAINTENANCE_IN_PROGRESS') {
    return {
      success: false as const,
      error: 'computer_busy',
      message: 'The Computer is busy with another action. Wait a moment and try again.',
    }
  }
  if (err instanceof ComputerDesktopDriverError) {
    return {
      success: false as const,
      error: err.message,
      code: err.code,
      ...(err.missing.length ? { missing: err.missing } : {}),
      ...(err.detail ? { detail: err.detail } : {}),
    }
  }
  return { success: false as const, error: err instanceof Error ? err.message : fallback }
}

async function computerInstanceFor(
  options: OverlayToolsOptions,
): Promise<
  | {
      ok: true
      computer: Pick<Computer, 'id' | 'name' | 'controlledByUserId'>
      operate<T>(
        operation: (instance: SandboxInstance, computer: Pick<Computer, 'controlledByUserId'>) => Promise<T>,
        actionDeadlineMs?: number,
      ): Promise<T>
    }
  | { ok: false; error: string }
> {
  if (!options.workspaceId) {
    return { ok: false, error: 'Computers need a workspace context.' }
  }
  const ownerType: ComputerOwnerType = options.agentId ? 'agent' : 'user'
  const ownerId = options.agentId ?? options.userId
  try {
    const { computerService, workspaceService } = getOverlayServerContext()
    // Resolve the delegating human's principal so agent-owned computers apply
    // the creator-only access rule rather than failing closed.
    const access = (await workspaceService.listForUser(options.userId))
      .find((entry) => entry.workspace.id === options.workspaceId)
    if (!access) return { ok: false, error: 'You do not have access to this workspace.' }
    const actor: ComputerActor = {
      userId: options.userId,
      workspaceId: access.workspace.id,
      principalId: access?.principal.id,
      workspaceRole: access?.membership.role === 'owner' ? 'owner' : 'member',
    }
    const computer = await computerService.getForOwner({
      actor,
      workspaceId: options.workspaceId,
      ownerType,
      ownerId,
    })
    return {
      ok: true,
      computer,
      operate: (operation, actionDeadlineMs) => computerService.withOwnerOperation({
        actor, workspaceId: options.workspaceId!, ownerType, ownerId,
        actionDeadlineMs,
        operation: (current, instance) => operation(instance, current),
      }),
    }
  } catch (err) {
    // An agent bound to an Overlay Cloud environment already has a machine —
    // its environment sandbox. Fall back to it before reporting "no computer"
    // so env-bound agents get machine tools without a second box.
    if (err instanceof ComputerServiceError && err.code === 'not_found' && options.agentId) {
      const machine = await machineForAgent({
        workspaceId: options.workspaceId,
        agentId: options.agentId,
      }).catch((_error) => null)
      if (machine) {
        await touchEnvironmentMachine(machine)
        return {
          ok: true,
          computer: { id: `env:${machine.environment.id}`, name: machine.environment.name },
          operate: async (operation) => await operation(machine.instance, { controlledByUserId: undefined }),
        }
      }
    }
    // An unbound owner is terminal — every computer tool hits it, so tell the
    // model to stop retrying and ask the user to bind one instead of looping.
    if (err instanceof ComputerServiceError && err.code === 'not_found') {
      return {
        ok: false,
        error:
          'No computer is bound to this owner — do not retry other computer tools. ' +
          'Ask the user to enable a computer for this agent in the agent editor (Computer toggle).',
      }
    }
    return { ok: false, error: computerErrorResult(err, 'Computer unavailable').error ?? 'Computer unavailable' }
  }
}

export async function executeComputerExec(
  options: OverlayToolsOptions,
  input: { command: string; cwd?: string; timeoutMs?: number },
) {
  const resolved = await computerInstanceFor(options)
  if (!resolved.ok) return { success: false, error: resolved.error }
  try {
    const timeoutMs = Math.min(
      Math.max(input.timeoutMs ?? COMPUTER_EXEC_TIMEOUT_DEFAULT_MS, 5_000),
      COMPUTER_EXEC_TIMEOUT_MAX_MS,
    )
    const result = await resolved.operate(async (instance) => {
      const handle = await instance.runCommand({
        command: input.command,
        cwd: input.cwd,
        environment: agentGatewayExecEnv({
          workspaceId: options.workspaceId!,
          userId: options.userId,
          agentId: options.agentId,
          ttlMs: timeoutMs + 60_000,
        }),
        timeoutMs,
      })
      return await handle.wait()
    }, timeoutMs)
    const stdout = truncateOutput(result.stdout)
    const stderr = truncateOutput(result.stderr)
    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
      durationMs: result.endedAt - result.startedAt,
      computerId: resolved.computer.id,
      computerName: resolved.computer.name,
    }
  } catch (err) {
    return computerErrorResult(err, 'Computer command failed')
  }
}

export async function executeComputerReadFile(
  options: OverlayToolsOptions,
  input: { path: string },
) {
  const resolved = await computerInstanceFor(options)
  if (!resolved.ok) return { success: false, error: resolved.error }
  try {
    const bytes = await resolved.operate((instance) => instance.readFile(input.path))
    if (bytes === null) {
      return { success: false, error: `No file at ${input.path}` }
    }
    const sliced = bytes.length > COMPUTER_READ_MAX_BYTES
      ? bytes.subarray(0, COMPUTER_READ_MAX_BYTES)
      : bytes
    return {
      success: true,
      path: input.path,
      contents: new TextDecoder().decode(sliced),
      bytes: bytes.length,
      truncated: bytes.length > COMPUTER_READ_MAX_BYTES,
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Computer file read failed')
  }
}

export async function executeComputerWriteFile(
  options: OverlayToolsOptions,
  input: { path: string; contents: string },
) {
  const resolved = await computerInstanceFor(options)
  if (!resolved.ok) return { success: false, error: resolved.error }
  try {
    const bytes = new TextEncoder().encode(input.contents)
    await resolved.operate((instance) => instance.writeFiles([{ path: input.path, contents: bytes }]))
    return {
      success: true,
      path: input.path,
      bytes: bytes.length,
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Computer file write failed')
  }
}

export async function executeComputerListFiles(
  options: OverlayToolsOptions,
  input: { path?: string },
) {
  const resolved = await computerInstanceFor(options)
  if (!resolved.ok) return { success: false, error: resolved.error }
  try {
    const path = input.path ?? '/home/user'
    const entries = await resolved.operate((instance) => instance.listFiles(path))
    return {
      success: true,
      path,
      entries: entries.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        size: entry.size,
      })),
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Computer file listing failed')
  }
}

export async function executeComputerOpenUrl(
  options: OverlayToolsOptions,
  input: { url: string },
) {
  const resolved = await computerInstanceFor(options)
  if (!resolved.ok) return { success: false, error: resolved.error }
  try {
    const result = await executeComputerActionWithTakeover(
      resolved.computer.controlledByUserId,
      'computer_open_url',
      input,
      () => resolved.operate(
        (instance, current) => executeComputerActionWithTakeover(
          current.controlledByUserId,
          'computer_open_url',
          input,
          () => openComputerUrl(instance, input.url),
        ),
        120_000,
      ),
    )
    if (isComputerUserInControlResult(result)) return result
    return {
      success: true,
      opened: input.url,
      openedWith: result.openedWith,
      note: result.openedWith === 'browser'
        ? 'Opened in the persistent browser on the visible desktop. The user can watch it live via Open desktop.'
        : 'Opened with the desktop URL handler because the browser driver is unavailable. The user can watch it live via Open desktop.',
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Failed to open the URL on the computer')
  }
}

export async function executeComputerScreenshot(options: OverlayToolsOptions) {
  const resolved = await computerInstanceFor(options)
  if (!resolved.ok) return { success: false as const, error: resolved.error }
  try {
    const result = await executeComputerActionWithTakeover(
      resolved.computer.controlledByUserId,
      'computer_screenshot',
      {},
      () => resolved.operate(
        (instance) => runComputerDesktopCommand(instance, 'screenshot'),
        120_000,
      ),
    )
    if (isComputerUserInControlResult(result)) return result
    if (
      typeof result.width !== 'number'
      || typeof result.height !== 'number'
      || !(result.image instanceof Uint8Array)
    ) {
      throw new ComputerDesktopDriverError('desktop_driver_failed', 'The screenshot was incomplete.')
    }
    return {
      success: true as const,
      width: result.width,
      height: result.height,
      image: result.image,
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Failed to capture the computer screenshot')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type ComputerInputAction =
  | { action: 'click'; x: number; y: number; button?: 'left' | 'middle' | 'right'; count?: number; confirm?: boolean }
  | { action: 'double_click'; x: number; y: number; confirm?: boolean }
  | { action: 'right_click'; x: number; y: number; confirm?: boolean }
  | { action: 'move'; x: number; y: number }
  | { action: 'drag'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { action: 'type'; text: string }
  | { action: 'key'; keys: string }
  | { action: 'scroll'; x?: number; y?: number; direction: 'up' | 'down' | 'left' | 'right'; amount: number }
  | { action: 'wait'; ms: number }

export type ComputerBrowserAction =
  | { action: 'navigate'; url: string }
  | { action: 'back' }
  | { action: 'forward' }
  | { action: 'reload' }
  | { action: 'snapshot' }
  | { action: 'click'; ref: string; confirm?: boolean }
  | { action: 'type'; ref: string; text: string; submit?: boolean }
  | { action: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount: number }
  | { action: 'press'; keys: 'Enter' | 'Tab' | 'Escape' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'PageDown' }
  | { action: 'tabs' }
  | { action: 'switch_tab'; index: number }
  | { action: 'new_tab'; url: string }

export type ComputerTerminalAction =
  | { action: 'start'; command: string; cwd?: string }
  | { action: 'read'; id: string; offset?: number; maxBytes?: number }
  | { action: 'cancel'; id: string; signal?: 'INT' | 'TERM' | 'KILL' }
  | { action: 'list' }

const COMPUTER_ACTION_APPROVAL_MESSAGE =
  'This Computer action needs your approval. Switch this chat to Work mode, or ask the user to do it in Open desktop.'

const COMPUTER_USER_IN_CONTROL_RESULT = {
  success: false as const,
  error: 'user_in_control' as const,
  message: 'The user has taken control of this Computer. Wait for them to hand it back, then take a new screenshot or snapshot before continuing.',
}

type ComputerControlTool = 'computer_input' | 'computer_browser' | 'computer_open_url' | 'computer_screenshot'

function computerActionBlockedByTakeover(toolName: ComputerControlTool, input: unknown): boolean {
  if (toolName === 'computer_open_url') return true
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const action = (input as { action?: unknown }).action
  if (toolName === 'computer_input') return action !== 'wait'
  if (toolName === 'computer_browser') return action !== 'snapshot' && action !== 'tabs'
  return false
}

export async function executeComputerActionWithTakeover<T>(
  controlledByUserId: string | undefined,
  toolName: ComputerControlTool,
  input: unknown,
  operate: () => Promise<T>,
): Promise<T | typeof COMPUTER_USER_IN_CONTROL_RESULT> {
  if (controlledByUserId && computerActionBlockedByTakeover(toolName, input)) {
    return COMPUTER_USER_IN_CONTROL_RESULT
  }
  return await operate()
}

function isComputerUserInControlResult(
  value: unknown,
): value is typeof COMPUTER_USER_IN_CONTROL_RESULT {
  return typeof value === 'object' && value !== null && 'error' in value && value.error === 'user_in_control'
}

export async function executeComputerActionWithApproval<T>(
  options: Pick<OverlayToolsOptions, 'approvalMode' | 'computerApprovalContext'>,
  toolName: 'computer_input' | 'computer_browser' | 'computer_exec' | 'computer_terminal',
  input: unknown,
  operate: () => Promise<T>,
): Promise<T | { success: false; error: 'approval_required'; message: string }> {
  if (
    options.computerApprovalContext !== 'work'
    && toolRequiresApproval(toolName, input, { approvalMode: options.approvalMode })
  ) {
    return {
      success: false,
      error: 'approval_required',
      message: COMPUTER_ACTION_APPROVAL_MESSAGE,
    }
  }
  return await operate()
}

export async function executeComputerBrowser(
  options: OverlayToolsOptions,
  input: ComputerBrowserAction,
) {
  const resolved = await computerInstanceFor(options)
  if (!resolved.ok) return { success: false as const, error: resolved.error }
  const { action, ...args } = input
  try {
    const output = await executeComputerActionWithTakeover(
      resolved.computer.controlledByUserId,
      'computer_browser',
      input,
      () => resolved.operate(
        (instance, current) => executeComputerActionWithTakeover(
          current.controlledByUserId,
          'computer_browser',
          input,
          () => runComputerBrowserAction(instance, action, args),
        ),
        120_000,
      ),
    )
    if (isComputerUserInControlResult(output)) return output
    if (output.result.success === false) return output.result
    return {
      success: true as const,
      action,
      result: output.result,
      text: output.text,
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Browser action failed')
  }
}

export async function executeComputerInput(
  options: OverlayToolsOptions,
  input: ComputerInputAction,
) {
  const resolved = await computerInstanceFor(options)
  if (!resolved.ok) return { success: false as const, error: resolved.error }
  const { action, ...inputArgs } = input
  const command = action === 'double_click' || action === 'right_click' ? 'click' : action
  const args: Record<string, unknown> = { ...inputArgs }
  if (action === 'double_click') args.count = 2
  if (action === 'right_click') args.button = 'right'
  try {
    const result = await executeComputerActionWithTakeover(
      resolved.computer.controlledByUserId,
      'computer_input',
      input,
      () => resolved.operate(
        (instance, current) => executeComputerActionWithTakeover(
          current.controlledByUserId,
          'computer_input',
          input,
          () => runComputerDesktopCommand(instance, command, args),
        ),
        120_000,
      ),
    )
    if (isComputerUserInControlResult(result)) return result
    if (isRecord(result) && result.success === false) return result
    if (isRecord(result) && isRecord(result.result) && result.result.success === false) {
      return result.result
    }
    return { success: true as const, acknowledgement: `${action.replace('_', ' ')} completed.` }
  } catch (err) {
    return computerErrorResult(err, 'Computer input failed')
  }
}

export async function executeComputerTerminal(
  options: OverlayToolsOptions,
  input: ComputerTerminalAction,
) {
  const resolved = await computerInstanceFor(options)
  if (!resolved.ok) return { success: false as const, error: resolved.error }
  const { action, ...args } = input
  const environment = action === 'start'
    ? agentGatewayExecEnv({
        workspaceId: options.workspaceId!,
        userId: options.userId,
        agentId: options.agentId,
        ttlMs: COMPUTER_TERMINAL_ENV_TTL_MS,
      })
    : undefined
  try {
    const result = await resolved.operate(
      (instance) => runComputerDriverCommand(
        instance,
        `terminal_${action}`,
        args,
        { requireDesktop: false, environment },
      ),
      45_000,
    )
    return { success: true as const, action, ...result, computerId: resolved.computer.id }
  } catch (err) {
    return computerErrorResult(err, 'Terminal session action failed')
  }
}

/**
 * Agents asking agents. Every call goes through one internal route that works out, from the database, which turn
 * is asking and under what lineage; nothing about the chain is taken from the model.
 */
async function callAgentAsks(options: OverlayToolsOptions, body: Record<string, unknown>) {
  try {
    const res = await callInternalApi(
      '/api/v1/agent-asks',
      {
        ...body,
        ...toolAuthBody(options),
        callerAgentId: options.agentId,
        callerConversationId: options.conversationId,
        callerTurnId: options.turnId,
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    const data = await res.json().catch((_error) => ({ error: 'The request failed.' })) as Record<string, unknown>
    if (!res.ok) return { success: false, error: typeof data.error === 'string' ? data.error : 'The request failed.' }
    return { success: true, ...data }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'The request failed.' }
  }
}

export function executeListAgents(options: OverlayToolsOptions) {
  return callAgentAsks(options, { action: 'list' })
}

export function executeAskAgent(options: OverlayToolsOptions, input: { agent: string; message: string; wait?: boolean }) {
  return callAgentAsks(options, { action: 'ask', agent: input.agent, message: input.message, wait: input.wait !== false })
}

export function executeReadAgentReply(options: OverlayToolsOptions, input: { conversationId: string; turnId: string }) {
  return callAgentAsks(options, { action: 'read', conversationId: input.conversationId, turnId: input.turnId })
}

export function executePostMessage(options: OverlayToolsOptions, input: { conversationId: string; text: string; mentions?: string[] }) {
  return callAgentAsks(options, { action: 'post', conversationId: input.conversationId, text: input.text, mentions: input.mentions ?? [] })
}
