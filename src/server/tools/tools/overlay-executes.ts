import 'server-only'
import { roomListScope } from './room-scope'

import type { SandboxInstance } from '@overlay/sandbox-runtime'
import { agentGatewayExecEnv } from '@/server/ai/agent-gateway/env'
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
import { NEW_AGENT_DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { callInternalApi, callInternalApiGet, toolAuthBody } from './internal-api'
import type { OverlayToolsOptions } from './types'
import { toolRequiresApproval } from '@overlay/tools-core/policy'
import { publishComputerFile } from '@/server/files/computer-publication'
import { LocalComputerError } from '@/server/computers/local/LocalComputerService'
import { LocalHostSandboxInstance, isLocalHostSandboxInstance } from '@/server/computers/local/LocalHostSandboxInstance'
import type { ComputerTarget } from './types'
import {
  computerContentSha,
  computerGlobArgs,
  computerGrepArgs,
  parseComputerGlobOutput,
  parseComputerGrepOutput,
  ripgrepFailed,
  sliceComputerLines,
  type ComputerGlobInput,
  type ComputerGrepInput,
} from './computer-file-tools'
import { applyComputerEdits, unifiedComputerDiff, type ComputerEdit } from './computer-edit'
import { ComputerPatchError, computerPatchPaths, parseComputerPatch, planComputerPatch } from './computer-patch'

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
import { buildAutomationDraftFromTurn } from '@/features/automations/lib/automation-drafts'
import type { AutomationSchedule } from '@overlay/app-core'
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
    return {
      success: false,
      code: 'tool_validation_failure',
      error: 'Invalid generated UI payload.',
      issues: [{ path: 'generatedUi', code: 'normalization_failed', message: 'The payload could not be normalized to an allowed generated UI card.' }],
      hint: 'Correct the generated UI fields and retry. For a question, ask it in plain text and call harness_report_blocker to create a durable wait.',
    }
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

type SavedAutomationRecord = { name?: string; title?: string; enabled?: boolean }

async function savedAutomation(
  options: OverlayToolsOptions,
  automationId: string | undefined,
  record: SavedAutomationRecord | undefined,
  fallback: { name?: string; enabled?: boolean },
) {
  let persisted = record
  if (!persisted && automationId) {
    try {
      const params = new URLSearchParams({ automationId })
      const res = await callInternalApiGet(
        `/api/v1/automations?${params}`,
        options.accessToken,
        options.baseUrl,
        options.forwardCookie,
        options.serverSecret,
        options.userId,
        options.workspaceId,
      )
      if (res.ok) persisted = await res.json() as SavedAutomationRecord
    } catch (_error) {
      persisted = undefined
    }
  }
  const name = persisted?.name ?? persisted?.title ?? fallback.name
  const enabled = typeof persisted?.enabled === 'boolean' ? persisted.enabled : fallback.enabled
  return {
    ...(name !== undefined ? { name } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
  }
}

export async function executeCreateAutomation(
  options: OverlayToolsOptions,
  input: {
    name: string
    description: string
    instructions: string
    schedule: AutomationSchedule
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
        ...(automationId ? {} : { byAgent: true }),
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
    const data = (await res.json()) as { id?: string; automation?: SavedAutomationRecord }
    const id = automationId ?? data.id
    return {
      success: true,
      automationId: id,
      saved: await savedAutomation(options, id, data.automation, {
        name: input.name,
        enabled: input.enabled ?? true,
      }),
    }
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
    schedule?: AutomationSchedule
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
    const data = await res.json().catch((_error) => null) as { automation?: SavedAutomationRecord } | null
    return {
      success: true,
      saved: await savedAutomation(options, input.automationId, data?.automation, {
        name: input.name,
        enabled: input.enabled,
      }),
    }
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
    const data = await res.json().catch((_error) => null) as { automation?: SavedAutomationRecord } | null
    return {
      success: true,
      saved: await savedAutomation(options, input.automationId, data?.automation, { enabled: false }),
    }
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
      { ...input, modelId: input.modelId ?? NEW_AGENT_DEFAULT_MODEL_ID, ...toolAuthBody(options) },
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

/** Generated outputs are `files` rows; the id and content URL let chat render a file card. */
function generatedFileFields(outputId: unknown): { fileId?: string; url?: string } {
  if (typeof outputId !== 'string' || !outputId) return {}
  return { fileId: outputId, url: `/api/v1/files/${encodeURIComponent(outputId)}/content` }
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
      ...generatedFileFields(data.outputId),
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
        ...generatedFileFields(finalResult.outputId),
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
  if (err instanceof LocalComputerError) {
    return {
      success: false as const,
      error: err.message,
      code: err.code,
      ...(err.missing.length ? { missing: err.missing } : {}),
    }
  }
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

const LOCAL_TARGET_UNAVAILABLE =
  "The user's computer is not connected to Overlay right now. Do not retry with target \"local\". "
  + 'Ask the user to open the Overlay desktop app on their computer (Settings → Desktop → This computer), or use the cloud Computer.'

const PINNED_MAC_UNAVAILABLE =
  'This thread runs on a computer that is offline, or that belongs to someone else. Do not retry computer tools. '
  + 'Tell the user: open Overlay on that computer, or start a new thread in the cloud. '
  + 'Only the person who connected a computer can run a thread on it.'

/** Resolves the user's own Mac for computer tools, or why it cannot be used for this turn. */
async function localComputerFor(options: OverlayToolsOptions, toolName: string) {
  if (!options.workspaceId) return { ok: false as const, error: 'Computers need a workspace context.' }
  if (options.computerApprovalContext === 'automation') {
    return { ok: false as const, error: "Automations cannot use the user's computer. Use the cloud Computer instead." }
  }
  const service = getOverlayServerContext().localComputerService
  if (!service) return { ok: false as const, error: LOCAL_TARGET_UNAVAILABLE }
  const computer = await service.findForUser({
    workspaceId: options.workspaceId, userId: options.userId,
    ...(options.localEnvironmentId ? { environmentId: options.localEnvironmentId } : {}),
  })
  if (!computer) {
    return { ok: false as const, error: options.localEnvironmentId ? PINNED_MAC_UNAVAILABLE : LOCAL_TARGET_UNAVAILABLE }
  }
  const instance = new LocalHostSandboxInstance(computer, service, {
    userId: options.userId, ...(options.agentId ? { agentId: options.agentId } : {}), toolName,
  })
  return {
    ok: true as const,
    computer: { id: `local:${computer.environmentId}`, name: computer.name, controlledByUserId: undefined, location: 'local' as const },
    // The person at the Mac is always in control of it; there is no takeover state to re-read.
    operate: <T>(operation: (instance: SandboxInstance, current: Pick<Computer, 'controlledByUserId'>) => Promise<T>) =>
      operation(instance, { controlledByUserId: undefined }),
  }
}

/**
 * Resolves the computer a tool call runs on. An explicit target wins, then the
 * turn's default; with neither, the cloud Computer is used when one is bound
 * and the user's own Mac otherwise.
 */
export async function computerInstanceFor(
  options: OverlayToolsOptions,
  selection: { target?: ComputerTarget; toolName?: string } = {},
): ReturnType<typeof cloudComputerInstanceFor> {
  const target = selection.target ?? options.computerTarget
  const toolName = selection.toolName ?? 'computer'
  if (target === 'local') return await localComputerFor(options, toolName)
  const cloud = await cloudComputerInstanceFor(options)
  if (cloud.ok || target === 'cloud' || !cloud.unbound) return cloud
  const local = await localComputerFor(options, toolName)
  return local.ok ? local : cloud
}

async function cloudComputerInstanceFor(
  options: OverlayToolsOptions,
): Promise<
  | {
      ok: true
      computer: Pick<Computer, 'id' | 'name' | 'controlledByUserId'> & { location?: 'cloud' | 'local' }
      operate<T>(
        operation: (instance: SandboxInstance, computer: Pick<Computer, 'controlledByUserId'>) => Promise<T>,
        actionDeadlineMs?: number,
      ): Promise<T>
    }
  | { ok: false; error: string; unbound?: boolean }
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
    // An unbound owner is terminal — every computer tool hits it, so tell the
    // model to stop retrying and ask the user to bind one instead of looping.
    if (err instanceof ComputerServiceError && err.code === 'not_found') {
      return {
        ok: false,
        unbound: true,
        error:
          'No computer is bound to this owner and the user\'s own computer is not connected — do not retry other computer tools. ' +
          'Ask the user to enable a computer for this agent in the agent editor (Computer toggle), or to open the Overlay desktop app on their computer.',
      }
    }
    return { ok: false, error: computerErrorResult(err, 'Computer unavailable').error ?? 'Computer unavailable' }
  }
}

export async function executeComputerPublishFile(
  options: OverlayToolsOptions,
  input: {
    sourcePath: string
    name: string
    artifactId: string
    mimeType: string
    parentId?: string
    scope: 'personal' | 'workspace'
    target?: ComputerTarget
  },
) {
  const { target, ...publication } = input
  return await publishComputerFile({
    request: { ...publication, scope: roomListScope(options, publication.scope) ?? publication.scope },
    authority: options.artifactPublicationAuthority,
    userId: options.userId,
    workspaceId: options.workspaceId,
    resolveComputer: () => computerInstanceFor(options, { target, toolName: 'computer_publish_file' }),
  })
}

export async function executeComputerExec(
  options: OverlayToolsOptions,
  input: { command: string; cwd?: string; timeoutMs?: number; target?: ComputerTarget },
) {
  const resolved = await computerInstanceFor(options, { target: input.target, toolName: 'computer_exec' })
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
  input: { path: string; offset?: number; limit?: number; target?: ComputerTarget },
) {
  const resolved = await computerInstanceFor(options, { target: input.target, toolName: 'computer_read_file' })
  if (!resolved.ok) return { success: false, error: resolved.error }
  try {
    const bytes = await resolved.operate((instance) => instance.readFile(input.path))
    if (bytes === null) {
      return { success: false, error: `No file at ${input.path}` }
    }
    const sha = computerContentSha(bytes)
    // Bytes past the read cap are dropped before line slicing; the note says so instead of failing.
    const capped = bytes.length > COMPUTER_READ_MAX_BYTES
    const text = new TextDecoder().decode(capped ? bytes.subarray(0, COMPUTER_READ_MAX_BYTES) : bytes)
    const slice = sliceComputerLines(text, { offset: input.offset, limit: input.limit })
    const notes = [
      slice.note,
      capped ? `File is ${bytes.length} bytes; only the first ${COMPUTER_READ_MAX_BYTES} bytes were read, so line counts are partial.` : undefined,
    ].filter(Boolean)
    return {
      success: true,
      path: input.path,
      contents: slice.content,
      startLine: slice.startLine,
      endLine: slice.endLine,
      totalLines: slice.totalLines,
      sha,
      bytes: bytes.length,
      truncated: slice.truncated || capped,
      ...(notes.length ? { note: notes.join(' ') } : {}),
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Computer file read failed')
  }
}

const COMPUTER_SEARCH_TIMEOUT_MS = 30_000

async function runRipgrep(
  options: OverlayToolsOptions,
  toolName: 'computer_grep' | 'computer_glob',
  target: ComputerTarget | undefined,
  buildArgs: (root: string) => string[],
) {
  const resolved = await computerInstanceFor(options, { target, toolName })
  if (!resolved.ok) return { ok: false as const, result: { success: false, error: resolved.error } }
  try {
    const result = await resolved.operate(async (instance) => {
      const root = await instance.workingDirectory()
      const handle = await instance.runCommand({ command: 'rg', args: buildArgs(root), timeoutMs: COMPUTER_SEARCH_TIMEOUT_MS })
      return await handle.wait()
    }, COMPUTER_SEARCH_TIMEOUT_MS)
    if (result.exitCode === 127 || /rg: (command )?not found/.test(result.stderr)) {
      return { ok: false as const, result: { success: false, error: 'ripgrep (rg) is not installed on this computer. Install it, or use computer_exec with grep/find.' } }
    }
    if (ripgrepFailed(result.exitCode)) {
      return { ok: false as const, result: { success: false, error: truncateOutput(result.stderr.trim() || `rg exited with ${result.exitCode}`).text } }
    }
    return { ok: true as const, stdout: result.stdout, computerId: resolved.computer.id }
  } catch (err) {
    return { ok: false as const, result: computerErrorResult(err, 'Computer search failed') }
  }
}

export async function executeComputerGrep(options: OverlayToolsOptions, input: ComputerGrepInput & { target?: ComputerTarget }) {
  const { target, ...search } = input
  const run = await runRipgrep(options, 'computer_grep', target, root => computerGrepArgs(search, root))
  if (!run.ok) return run.result
  return { success: true, pattern: search.pattern, ...parseComputerGrepOutput(run.stdout, search), computerId: run.computerId }
}

export async function executeComputerGlob(options: OverlayToolsOptions, input: ComputerGlobInput & { target?: ComputerTarget }) {
  const { target, ...search } = input
  const run = await runRipgrep(options, 'computer_glob', target, root => computerGlobArgs(search, root))
  if (!run.ok) return run.result
  return { success: true, pattern: search.pattern, ...parseComputerGlobOutput(run.stdout, search), computerId: run.computerId }
}

/** Old files larger than this are rewritten without line counts. */
const COMPUTER_DIFF_MAX_BYTES = 1024 * 1024

function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines
}

function countLines(text: string): number {
  return splitLines(text).length
}

/**
 * Lines added and removed between two versions, counted as a multiset difference. It matches a diff's counts for
 * ordinary edits; moved lines count as unchanged.
 */
export function lineChanges(before: string, after: string): { linesAdded: number; linesRemoved: number } {
  const remaining = new Map<string, number>()
  for (const line of splitLines(before)) remaining.set(line, (remaining.get(line) ?? 0) + 1)
  let linesAdded = 0
  for (const line of splitLines(after)) {
    const left = remaining.get(line) ?? 0
    if (left > 0) remaining.set(line, left - 1)
    else linesAdded++
  }
  let linesRemoved = 0
  for (const left of remaining.values()) linesRemoved += left
  return { linesAdded, linesRemoved }
}

export async function executeComputerWriteFile(
  options: OverlayToolsOptions,
  input: { path: string; contents: string; target?: ComputerTarget },
) {
  const resolved = await computerInstanceFor(options, { target: input.target, toolName: 'computer_write_file' })
  if (!resolved.ok) return { success: false, error: resolved.error }
  try {
    const bytes = new TextEncoder().encode(input.contents)
    const previous = await resolved.operate(async (instance) => {
      // Read the old text first so the row can say "Created" or "Edited +a −b". A failed read only drops the counts.
      const before = await instance.readFile(input.path).catch((_error) => undefined)
      await instance.writeFiles([{ path: input.path, contents: bytes }])
      return before
    })
    const changes = previous === undefined ? {}
      : previous === null ? { created: true, linesAdded: countLines(input.contents), linesRemoved: 0 }
        : previous.length <= COMPUTER_DIFF_MAX_BYTES
          ? { created: false, ...lineChanges(new TextDecoder().decode(previous), input.contents) }
          : { created: false }
    return {
      success: true,
      path: input.path,
      bytes: bytes.length,
      ...changes,
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Computer file write failed')
  }
}

/** Files larger than this are refused by computer_edit_file; rewrite them with computer_exec instead. */
const COMPUTER_EDIT_MAX_BYTES = 2 * 1024 * 1024

export async function executeComputerEditFile(
  options: OverlayToolsOptions,
  input: { path: string; edits: ComputerEdit[]; expected_sha?: string; target?: ComputerTarget },
) {
  const resolved = await computerInstanceFor(options, { target: input.target, toolName: 'computer_edit_file' })
  if (!resolved.ok) return { success: false, error: resolved.error }
  try {
    const outcome = await resolved.operate(async (instance) => {
      const bytes = await instance.readFile(input.path)
      if (bytes === null) {
        return { success: false as const, code: 'not_found', error: `No file at ${input.path}. Use computer_write_file to create it.` }
      }
      if (bytes.length > COMPUTER_EDIT_MAX_BYTES) {
        return { success: false as const, code: 'too_large', error: `${input.path} is ${bytes.length} bytes; computer_edit_file handles files up to ${COMPUTER_EDIT_MAX_BYTES} bytes.` }
      }
      const sha = computerContentSha(bytes)
      if (input.expected_sha && input.expected_sha !== sha) {
        return {
          success: false as const, code: 'stale', currentSha: sha,
          error: `${input.path} changed since you read it (expected sha ${input.expected_sha}, now ${sha}). Nothing was written. Re-read the file and redo the edit.`,
        }
      }
      const before = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      const applied = applyComputerEdits(before, input.edits)
      if (!applied.ok) {
        return { success: false as const, code: applied.code, editIndex: applied.editIndex, error: `${applied.message} Nothing was written.`, sha }
      }
      // Re-check right before writing so a change made while we computed the edit is never overwritten.
      const latest = await instance.readFile(input.path)
      if (latest === null || computerContentSha(latest) !== sha) {
        return { success: false as const, code: 'stale', error: `${input.path} changed while the edit was being applied. Nothing was written. Re-read and retry.` }
      }
      const written = new TextEncoder().encode(applied.text)
      await instance.writeFiles([{ path: input.path, contents: written }])
      return { success: true as const, before, after: applied.text, replacements: applied.replacements, sha: computerContentSha(written) }
    })
    if (!outcome.success) return outcome
    const { diff, linesAdded, linesRemoved, truncated } = unifiedComputerDiff(input.path, outcome.before, outcome.after)
    return {
      success: true,
      path: input.path,
      created: false,
      replacements: outcome.replacements,
      linesAdded,
      linesRemoved,
      diff,
      ...(truncated ? { diffTruncated: true } : {}),
      sha: outcome.sha,
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Computer file edit failed')
  }
}

const COMPUTER_PATCH_MAX_FILES = 50

export async function executeComputerApplyPatch(
  options: OverlayToolsOptions,
  input: { patch: string; target?: ComputerTarget },
) {
  let operations
  try {
    operations = parseComputerPatch(input.patch)
  } catch (err) {
    if (err instanceof ComputerPatchError) return { success: false, code: 'invalid_patch', error: `${err.message} Nothing was written.` }
    throw err
  }
  const paths = computerPatchPaths(operations)
  if (paths.some(path => !path.startsWith('/'))) {
    return { success: false, code: 'invalid_patch', error: 'Patch paths must be absolute. Nothing was written.' }
  }
  if (paths.length > COMPUTER_PATCH_MAX_FILES) {
    return { success: false, code: 'invalid_patch', error: `A patch can touch at most ${COMPUTER_PATCH_MAX_FILES} files. Nothing was written.` }
  }
  const resolved = await computerInstanceFor(options, { target: input.target, toolName: 'computer_apply_patch' })
  if (!resolved.ok) return { success: false, error: resolved.error }
  try {
    const outcome = await resolved.operate(async (instance) => {
      const decoder = new TextDecoder()
      const load = async () => new Map(await Promise.all(paths.map(async (path) => {
        const bytes = await instance.readFile(path)
        return [path, bytes === null ? null : decoder.decode(bytes)] as const
      })))
      const files = await load()
      let changes
      try {
        changes = planComputerPatch(operations, files)
      } catch (err) {
        if (err instanceof ComputerPatchError) return { success: false as const, code: 'patch_failed', error: `${err.message} Nothing was written.` }
        throw err
      }
      // Nothing changed on disk between planning and writing, or the patch is refused.
      const latest = await load()
      for (const path of paths) {
        if (latest.get(path) !== files.get(path)) {
          return { success: false as const, code: 'stale', error: `${path} changed while the patch was being applied. Nothing was written. Re-read and retry.` }
        }
      }
      const encoder = new TextEncoder()
      const writes = changes.flatMap(change => change.kind === 'add' ? [{ path: change.path, contents: encoder.encode(change.after) }]
        : change.kind === 'update' ? [{ path: change.moveTo ?? change.path, contents: encoder.encode(change.after) }] : [])
      if (writes.length) await instance.writeFiles(writes)
      const removals = changes.flatMap(change => change.kind === 'delete' ? [change.path] : change.kind === 'update' && change.moveTo ? [change.path] : [])
      if (removals.length) {
        const result = await (await instance.runCommand({ command: 'rm', args: ['-f', '--', ...removals], timeoutMs: 15_000 })).wait()
        if (result.exitCode !== 0) {
          return { success: false as const, code: 'partial', error: `Files were written, but removing ${removals.join(', ')} failed: ${result.stderr.trim().slice(0, 300)}` }
        }
      }
      return { success: true as const, changes }
    })
    if (!outcome.success) return outcome
    const files = outcome.changes.map((change) => {
      const before = change.kind === 'add' ? '' : change.before
      const after = change.kind === 'delete' ? '' : change.after
      const { diff, linesAdded, linesRemoved, truncated } = unifiedComputerDiff(change.kind === 'update' && change.moveTo ? change.moveTo : change.path, before, after)
      return {
        action: change.kind,
        path: change.path,
        ...(change.kind === 'update' && change.moveTo ? { movedTo: change.moveTo } : {}),
        linesAdded,
        linesRemoved,
        diff,
        ...(truncated ? { diffTruncated: true } : {}),
        ...(change.kind === 'delete' ? {} : { sha: computerContentSha(after) }),
      }
    })
    return {
      success: true,
      files,
      linesAdded: files.reduce((sum, file) => sum + file.linesAdded, 0),
      linesRemoved: files.reduce((sum, file) => sum + file.linesRemoved, 0),
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Computer patch failed')
  }
}

export async function executeComputerListFiles(
  options: OverlayToolsOptions,
  input: { path?: string; target?: ComputerTarget },
) {
  const resolved = await computerInstanceFor(options, { target: input.target, toolName: 'computer_list_files' })
  if (!resolved.ok) return { success: false, error: resolved.error }
  try {
    let path = input.path ?? '/home/user'
    const entries = await resolved.operate((instance) => {
      if (!input.path && isLocalHostSandboxInstance(instance)) path = instance.homeDirectory
      return instance.listFiles(path)
    })
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
  input: { url: string; target?: ComputerTarget },
) {
  const resolved = await computerInstanceFor(options, { target: input.target, toolName: 'computer_open_url' })
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
      note: resolved.computer.location === 'local'
        ? `Opened on ${resolved.computer.name}, the user's own computer.`
        : result.openedWith === 'browser'
        ? 'Opened in the persistent browser on the visible desktop. The user can watch it live via Open desktop.'
        : 'Opened with the desktop URL handler because the browser driver is unavailable. The user can watch it live via Open desktop.',
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Failed to open the URL on the computer')
  }
}

export async function executeComputerScreenshot(options: OverlayToolsOptions, input: { target?: ComputerTarget } = {}) {
  const resolved = await computerInstanceFor(options, { target: input.target, toolName: 'computer_screenshot' })
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
      mediaType: result.mediaType === 'image/jpeg' ? 'image/jpeg' as const : 'image/png' as const,
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
  "This action needs approval. Review it in personal chat with a connected Computer, or set this agent's Permissions to Auto."

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
  input: ComputerBrowserAction & { target?: ComputerTarget },
) {
  const resolved = await computerInstanceFor(options, { target: input.target, toolName: 'computer_browser' })
  if (!resolved.ok) return { success: false as const, error: resolved.error }
  const { action, target: _target, ...args } = input
  void _target
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
  input: ComputerInputAction & { target?: ComputerTarget },
) {
  const resolved = await computerInstanceFor(options, { target: input.target, toolName: 'computer_input' })
  if (!resolved.ok) return { success: false as const, error: resolved.error }
  const { action, target: _target, ...inputArgs } = input
  void _target
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
  input: ComputerTerminalAction & { target?: ComputerTarget },
) {
  const resolved = await computerInstanceFor(options, { target: input.target, toolName: 'computer_terminal' })
  if (!resolved.ok) return { success: false as const, error: resolved.error }
  const { action, target: _target, ...args } = input
  void _target
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

export function executeAskAgent(options: OverlayToolsOptions, input: { agent: string; message: string; wait?: boolean; assignmentId?: string; expectedAttemptId?: string }) {
  return callAgentAsks(options, { action: 'ask', agent: input.agent, message: input.message, wait: input.wait !== false,
    assignmentId: input.assignmentId, expectedAttemptId: input.expectedAttemptId })
}

export function executeReadAgentReply(options: OverlayToolsOptions, input: { conversationId: string; turnId: string }) {
  return callAgentAsks(options, { action: 'read', conversationId: input.conversationId, turnId: input.turnId })
}

export function executePostMessage(options: OverlayToolsOptions, input: { conversationId: string; text: string; mentions?: string[] }) {
  return callAgentAsks(options, { action: 'post', conversationId: input.conversationId, text: input.text, mentions: input.mentions ?? [] })
}
