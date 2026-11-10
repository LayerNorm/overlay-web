import { logger } from '@/server/observability/logger'
import { NextRequest } from 'next/server'
import { getBillingProgrammaticSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { ToolLoopAgent, isStepCount, tool, type ToolSet } from '@/server/ai/sdk'
import { z } from 'zod/v3'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import {
  buildInsufficientCreditsPayload,
  isPaidPlan,
} from '@/server/billing/billing-runtime'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { createNotebookTextEmitter } from '@/server/agent/notebook-agent-stream'
import {
  DEFAULT_MODEL_ID,
  isRetiredHostedModelId,
} from '@/shared/ai/gateway/model-types'
import { getInternalApiBaseUrl } from '@/server/web/app-url'
import { executeSearchKnowledge } from '@/server/tools/tools/overlay-executes'
import type { OverlayToolsOptions } from '@/server/tools/tools/types'
import type { NotebookEdit, NotebookAgentStreamEvent } from '@overlay/app-core'
import { NOTEBOOK_AGENT_PROMPT } from '@/server/agent/notebook-agent-prompts'
import { resolveMentionsContext } from '@/server/knowledge/mention-resolver'
import { summarizeErrorForLog } from '@/shared/security/safe-log'

export const maxDuration = 120

const MAX_NOTE_CHARS = 400_000

const MentionSchema = z.object({
  type: z.string(),
  id: z.string(),
  name: z.string(),
  fileIds: z.array(z.string()).optional(),
})

const BodySchema = z.object({
  noteContent: z.string(),
  noteTitle: z.string(),
  message: z.string().min(1).max(32_000),
  modelId: z.string().optional(),
  mode: z.enum(['ask', 'write']).optional(), // Deprecated: kept for backward compatibility
  accessToken: z.string().optional(),
  userId: z.string().optional(),
  mentions: z.array(MentionSchema).optional(),
})

function createNotebookTools(params: {
  frozenNoteLines: string
  noteTitle: string
  emit: (e: NotebookAgentStreamEvent) => void
  toolOptions: OverlayToolsOptions
  createEditId: () => string
}): ToolSet {
  const { frozenNoteLines, noteTitle, emit, toolOptions, createEditId } = params
  const tools: ToolSet = {}

  tools.search_knowledge = tool({
    description:
      "Search the user's saved knowledge: indexed files and memories. Uses hybrid semantic + keyword retrieval. Call when you need facts that are not already in the note text.",
    inputSchema: z.object({
      query: z.string().describe('Search query: keywords or a short natural-language question'),
      sourceKind: z
        .enum(['file', 'memory'])
        .optional()
        .describe('Limit to files only or memories only (omit to search both)'),
    }),
    execute: async (input) => {
      emit({
        type: 'tool_call',
        tool: 'search_knowledge',
        toolInput: input as Record<string, unknown>,
      })
      return executeSearchKnowledge(toolOptions, input)
    },
  })

  tools.read_note = tool({
    description: 'Read note title and content with line numbers.',
    inputSchema: z.object({}),
    execute: async () => {
      emit({ type: 'tool_call', tool: 'read_note', toolInput: {} })
      const title = noteTitle || 'Untitled'
      const lines = frozenNoteLines.split('\n')
      const numbered = lines.map((line, index) => `${index + 1}: ${line}`).join('\n')
      return {
        title,
        lineCount: lines.length,
        content: numbered,
        isEmpty: lines.length === 0 || (lines.length === 1 && lines[0].trim() === ''),
      }
    },
  })

  // Always include propose_edit - the LLM decides when to use it based on user intent
  tools.propose_edit = tool({
    description:
      'Propose replacing a line range with new content. User can accept/reject each edit. Only use this when the user explicitly asks to modify the note.',
    inputSchema: z.object({
      description: z.string().describe('Short edit label'),
      start_line: z.number().describe('First line to replace (1-based)'),
      end_line: z.number().describe('Last line to replace (1-based, inclusive)'),
      new_content: z.string().describe('Replacement content; empty string deletes lines'),
    }),
    execute: async ({ description, start_line, end_line, new_content }) => {
      emit({
        type: 'tool_call',
        tool: 'propose_edit',
        toolInput: {
          description,
          start_line,
          end_line,
          new_content:
            new_content.length > 8000
              ? `${new_content.slice(0, 8000)}\n[truncated in log]`
              : new_content,
        },
      })
      const lines = frozenNoteLines.split('\n')
      const startLine = Math.max(1, Math.round(start_line))
      const endLine = Math.max(startLine, Math.round(end_line))
      const originalLines = lines.slice(startLine - 1, endLine)
      const newLines = new_content === '' ? [] : new_content.split('\n')

      const edit: NotebookEdit = {
        id: createEditId(),
        description,
        startLine,
        endLine,
        originalLines,
        newLines,
      }

      emit({ type: 'edit_proposal', edit })

      return {
        success: true as const,
        editId: edit.id,
        message: `Edit proposed (lines ${startLine}-${endLine})`,
      }
    },
  })

  tools.finish = tool({
    description: 'Signal notebook task completion with a summary.',
    inputSchema: z.object({
      summary: z.string().describe('One sentence summary'),
    }),
    execute: async ({ summary }) => {
      emit({ type: 'tool_call', tool: 'finish', toolInput: { summary } })
      if (summary.trim()) {
        emit({ type: 'text', text: summary })
      }
      return { success: true as const, summary }
    },
  })

  return tools
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  let bodyRaw: unknown
  try {
    bodyRaw = await request.json()
  } catch (_error) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = BodySchema.safeParse(bodyRaw)
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid request', details: parsed.error.format() }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { noteContent: rawNoteContent, noteTitle, message, modelId, mentions: rawMentions } = parsed.data

  const { auth } = context

  const userId = auth.userId
  const workspaceId = context.workspace.workspace.id
  const mentionedAgent = rawMentions?.find((mention) => mention.type === 'agent')
  const programmaticSubjectId = getBillingProgrammaticSubjectId(
    context,
    mentionedAgent ? `agent:${mentionedAgent.id}` : undefined,
  )
  const serverContext = getOverlayServerContext()
  const generationUsagePolicy = serverContext.generationUsagePolicy
  const serverSecret = getInternalApiSecret()
  const entitlements = await generationUsagePolicy.getEntitlements({ programmaticSubjectId, userId, workspaceId })
  if (!entitlements) {
    return new Response(
      JSON.stringify({
        error: 'Unauthorized',
        message: 'Could not verify subscription. Try signing out and back in.',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const requestedModelId = (modelId?.trim() && modelId.trim()) || DEFAULT_MODEL_ID
  const effectiveModelId = requestedModelId
  if (isRetiredHostedModelId(effectiveModelId)) {
    return new Response(JSON.stringify({
      error: 'model_retired', message: 'This hosted model is retired. Select a paid model to continue.',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })
  }
  if (!isPaidPlan(entitlements)) {
    return new Response(JSON.stringify(buildInsufficientCreditsPayload(entitlements, 'Fund this workspace to run a model.')),
      { status: 402, headers: { 'Content-Type': 'application/json' } })
  }
  // The only spending check: refuse when the workspace has under 2% left (after a top-up). Each step of the
  // loop is charged its actual cost as it ends; the loop stops once the workspace drops under 2%.
  const budgetCheck = await generationUsagePolicy.ensureBudgetNotLow({
    userId,
    entitlements,
    kind: 'agent',
    modelId: effectiveModelId,
    operationId: 'agent.notebook',
    programmaticSubjectId,
    workspaceId,
  })
  if (!budgetCheck.ok) {
    return new Response(
      JSON.stringify({ ...budgetCheck.payload, error: budgetCheck.code }),
      { status: budgetCheck.status, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const refreshedEntitlements = await generationUsagePolicy.getEntitlements({ programmaticSubjectId, userId, workspaceId })
  if (!refreshedEntitlements) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized', message: 'Could not refresh subscription state.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const authorizedModelIds = await resolveAuthorizedModelIds({ entitlements: refreshedEntitlements })
  if (!authorizedModelIds.chat.has(effectiveModelId)) {
    return new Response(
      JSON.stringify({
        error: 'model_not_allowed',
        message: `Model ${effectiveModelId} is not allowed by the server model policy.`,
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const frozenNoteLines =
    rawNoteContent.length > MAX_NOTE_CHARS
      ? `${rawNoteContent.slice(0, MAX_NOTE_CHARS)}\n[Note truncated for agent context]`
      : rawNoteContent

  const forwardCookie = request.headers.get('cookie') ?? undefined
  const toolOptions: OverlayToolsOptions = {
    userId,
    accessToken: auth.accessToken,
    baseUrl: getInternalApiBaseUrl(request),
    forwardCookie,
  }

  const encoder = new TextEncoder()
  let editSeq = 0
  const createEditId = () => `edit-${Date.now()}-${editSeq++}`

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (evt: NotebookAgentStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(evt)}\n`))
      }

      try {
        emit({ type: 'thinking', thinking: 'Analyzing note...' })
        const model = await getLanguageModel(effectiveModelId, auth.accessToken, userId, { workspaceId })
        const mentionsContext = await resolveMentionsContext(rawMentions, {
          userId,
          serverSecret,
        })
        const instructions = NOTEBOOK_AGENT_PROMPT + mentionsContext
        const emitText = createNotebookTextEmitter((text) => {
          emit({ type: 'text', text })
        })
        const tools = createNotebookTools({
          frozenNoteLines,
          noteTitle,
          emit,
          toolOptions,
          createEditId,
        })

        let stopForBudget = false
        const agent = new ToolLoopAgent({
          model,
          instructions,
          tools,
          // The workspace budget stops real spending; the step count only ends a runaway tool loop.
          stopWhen: [isStepCount(200), () => stopForBudget],
          onStepEnd: async ({ text, usage }) => {
            emitText(text)
            const charged = await chargeNotebookStep({
              generationUsagePolicy, modelId: effectiveModelId, programmaticSubjectId, usage, userId, workspaceId,
            })
            if (charged.stop) stopForBudget = true
          },
        })

        const prompt =
          `Note content:\n\n${frozenNoteLines || '(empty note)'}\n\n---\n\nUser request: ${message}`

        const result = await agent.generate({ prompt })

        emitText(result.text)
        if (stopForBudget) {
          emit({ type: 'error', error: 'Stopped: less than 2% of the workspace budget is left.' })
        }

        emit({ type: 'done' })
	      } catch (err) {
	        const msg = err instanceof Error ? err.message : String(err)
	        logger.error('[notebook-agent]', summarizeErrorForLog(err))
	        emit({ type: 'error', error: msg })
        emit({ type: 'done' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Charges one finished step its actual cost. The loop stops when the workspace is now under 2%, or when the
 * step cannot be priced (it could not be charged).
 */
async function chargeNotebookStep(args: {
  generationUsagePolicy: ReturnType<typeof getOverlayServerContext>['generationUsagePolicy']
  modelId: string
  programmaticSubjectId?: string
  usage: { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number } } | undefined
  userId: string
  workspaceId: string
}): Promise<{ stop: boolean }> {
  const inputTokens = args.usage?.inputTokens ?? 0
  const outputTokens = args.usage?.outputTokens ?? 0
  const cachedTokens = args.usage?.inputTokenDetails?.cacheReadTokens ?? 0
  if (inputTokens <= 0 && outputTokens <= 0) return { stop: false }
  const providerCostUsd = await calculateLanguageModelTokenCostOrNull(args.modelId, inputTokens, cachedTokens, outputTokens)
  if (providerCostUsd === null) {
    logger.error('[notebook-agent] Missing pricing for a finished step; stopping', { modelId: args.modelId })
    return { stop: true }
  }
  try {
    const { budgetLow } = await args.generationUsagePolicy.charge({
      operationId: `notebook_${globalThis.crypto.randomUUID()}`,
      programmaticSubjectId: args.programmaticSubjectId,
      providerCostUsd,
      usage: { kind: 'agent', modelId: args.modelId, inputTokens, outputTokens, cachedTokens },
      userId: args.userId,
      workspaceId: args.workspaceId,
    })
    return { stop: budgetLow }
  } catch (err) {
    logger.error('[notebook-agent] Failed to record usage:', summarizeErrorForLog(err))
    return { stop: true }
  }
}
