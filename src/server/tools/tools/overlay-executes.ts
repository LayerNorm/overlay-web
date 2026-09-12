import 'server-only'

import type { SandboxInstance } from '@overlay/sandbox-runtime'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  ComputerServiceError,
  type ComputerActor,
} from '@/server/computers/ComputerService'
import type { Computer, ComputerOwnerType } from '@overlay/workspace-contracts/computers'
import { callInternalApi, callInternalApiGet, toolAuthBody } from './internal-api'
import type { OverlayToolsOptions } from './types'

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
        projectId: options.projectId,
        sourceKind: options.memoryEnabled === false ? 'file' : sourceKind,
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
        projectId: options.projectId,
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
        projectId: options.projectId,
        sourceKind: 'memory',
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
  input: { query?: string },
) {
  try {
    const res = await callInternalApiGet(
      '/api/v1/skills?limit=100',
      options.accessToken,
      options.baseUrl,
      options.forwardCookie,
      options.serverSecret,
      options.userId,
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
  input: { query?: string },
) {
  try {
    const res = await callInternalApiGet(
      '/api/v1/automations?limit=100',
      options.accessToken,
      options.baseUrl,
      options.forwardCookie,
      options.serverSecret,
      options.userId,
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
    projectId?: string
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
        projectId: input.projectId ?? options.projectId,
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
      { ...input, schedule, ...toolAuthBody(options) },
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
      { automationId: input.automationId, action: 'pause', ...toolAuthBody(options) },
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
      { automationId: input.automationId, ...toolAuthBody(options) },
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

export async function executeRunDaytonaSandbox(
  options: OverlayToolsOptions,
  input: {
    task: string
    runtime: 'node' | 'python'
    command: string
    code?: string
    inputFileIds?: string[]
    expectedOutputs: string[]
  },
) {
  const { task, runtime, command, code, inputFileIds, expectedOutputs } = input

  try {
    const res = await callInternalApi(
      '/api/v1/daytona/run',
      {
        task,
        runtime,
        command,
        code,
        inputFileIds,
        expectedOutputs,
        conversationId: options.conversationId,
        turnId: options.turnId,
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )

    const data = (await res.json().catch((_error) => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return {
        success: false,
        exitCode: data.exitCode,
        stdout: data.stdout,
        stderr: data.stderr,
        artifacts: data.artifacts,
        missingExpectedOutputs: data.missingExpectedOutputs,
        error:
          (typeof data.message === 'string' && data.message) ||
          (typeof data.error === 'string' && data.error) ||
          'Daytona sandbox run failed',
      }
    }

    return {
      success: Boolean(data.success),
      exitCode: data.exitCode,
      stdout: data.stdout,
      stderr: data.stderr,
      artifacts: data.artifacts,
      missingExpectedOutputs: data.missingExpectedOutputs,
      uploadedFiles: data.uploadedFiles,
      message:
        typeof data.message === 'string'
          ? data.message
          : 'Daytona sandbox run completed.',
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Daytona sandbox run failed',
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

function truncateOutput(value: string): { text: string; truncated: boolean } {
  if (value.length <= COMPUTER_EXEC_MAX_OUTPUT_CHARS) {
    return { text: value, truncated: false }
  }
  return { text: value.slice(0, COMPUTER_EXEC_MAX_OUTPUT_CHARS), truncated: true }
}

function computerErrorResult(err: unknown, fallback: string) {
  if (err instanceof ComputerServiceError) {
    return { success: false, error: err.message, code: err.code }
  }
  return { success: false, error: err instanceof Error ? err.message : fallback }
}

async function computerInstanceFor(
  options: OverlayToolsOptions,
): Promise<
  | { ok: true; computer: Computer; instance: SandboxInstance }
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
    const actor: ComputerActor = {
      userId: options.userId,
      principalId: access?.principal.id,
      workspaceRole: access?.membership.role === 'owner' ? 'owner' : 'member',
    }
    const { computer, instance } = await computerService.instanceForOwner({
      actor,
      workspaceId: options.workspaceId,
      ownerType,
      ownerId,
    })
    return { ok: true, computer, instance }
  } catch (err) {
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
    const handle = await resolved.instance.runCommand({
      command: input.command,
      cwd: input.cwd,
      timeoutMs,
    })
    const result = await handle.wait()
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
    const bytes = await resolved.instance.readFile(input.path)
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
    await resolved.instance.writeFiles([{ path: input.path, contents: bytes }])
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
    const entries = await resolved.instance.listFiles(path)
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
  if (!resolved.instance.capabilities.desktop) {
    return { success: false, error: 'This computer has no desktop to open URLs on.' }
  }
  try {
    // The bearer ticket is never returned to the transcript — the user can
    // watch through their own "Open desktop" surface. runCommand executes
    // outside the desktop session, so DISPLAY is set explicitly.
    const handle = await resolved.instance.runCommand({
      command: 'xdg-open',
      args: [input.url],
      environment: { DISPLAY: ':0' },
      timeoutMs: 15_000,
    })
    const result = await handle.wait()
    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `xdg-open failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim() || 'no output'}`,
      }
    }
    return {
      success: true,
      opened: input.url,
      note: 'The URL opened on the computer’s desktop. The user can watch it live via Open desktop in Settings or the agent editor.',
      computerId: resolved.computer.id,
    }
  } catch (err) {
    return computerErrorResult(err, 'Failed to open the URL on the computer')
  }
}
