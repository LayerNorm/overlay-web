import 'server-only'

import { callInternalApi, callInternalApiGet, toolAuthBody } from './internal-api'
import type { OverlayToolsOptions } from './types'
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
      { memoryId, content, type, importance, tags, ...toolAuthBody(options) },
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
      { memoryId, ...toolAuthBody(options) },
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
    const res = await callInternalApi(
      '/api/v1/automations',
      {
        ...input,
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
    const res = await callInternalApi(
      '/api/v1/automations',
      { ...input, ...toolAuthBody(options) },
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
