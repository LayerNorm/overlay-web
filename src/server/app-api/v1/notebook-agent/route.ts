import { logger } from '@/server/observability/logger'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { ToolLoopAgent, stepCountIs, tool, type ToolSet } from '@/server/ai/sdk'
import { z } from 'zod'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getLanguageModel } from '@/server/ai/model-runtime'
import {
  billableBudgetCentsFromProviderUsd,
  buildInsufficientCreditsPayload,
  ensureBudgetAvailable,
  finalizeProviderBudgetReservation,
  getBudgetTotals,
  isPaidPlan,
  markProviderBudgetReconcile,
  releaseProviderBudgetReservation,
  reserveProviderBudget,
} from '@/server/billing/billing-runtime'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { isPremiumModel } from '@/server/ai/pricing'
import { createNotebookTextEmitter } from '@/server/agent/notebook-agent-stream'
import {
  DEFAULT_MODEL_ID,
  isFreeTierChatModelId,
  resolveFreeTierChatModelId,
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
  projectId: z.string().optional(),
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

  const { noteContent: rawNoteContent, noteTitle, message, modelId, projectId, mentions: rawMentions } = parsed.data

  const { auth } = context

  const userId = auth.userId
  const serverContext = getOverlayServerContext()
  const generationUsagePolicy = serverContext.generationUsagePolicy
  const serverSecret = getInternalApiSecret()
  const entitlements = await generationUsagePolicy.getEntitlements({ userId })
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
  const effectiveModelId = resolveFreeTierChatModelId(requestedModelId) ?? requestedModelId

  if (!isPaidPlan(entitlements)) {
    if (!isFreeTierChatModelId(effectiveModelId)) {
      return new Response(
        JSON.stringify({
          error: 'premium_model_not_allowed',
          message:
            'Free tier is limited to free models. Upgrade to a paid plan to use premium models.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      )
    }
  } else {
    const budget = getBudgetTotals(entitlements)
    if (budget.remainingCents <= 0 && isPremiumModel(effectiveModelId)) {
      const autoTopUp = await ensureBudgetAvailable({
        userId,
        entitlements,
        minimumRequiredCents: 1,
      })
      if (autoTopUp.remainingCents <= 0) {
        return new Response(
          JSON.stringify(buildInsufficientCreditsPayload(entitlements, 'No budget remaining. Please top up your account.')),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        )
      }
    }
  }

  const refreshedEntitlements = await generationUsagePolicy.getEntitlements({ userId })
  if (!refreshedEntitlements) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized', message: 'Could not refresh subscription state.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (isPaidPlan(refreshedEntitlements) && isPremiumModel(effectiveModelId)) {
    const refreshedBudget = getBudgetTotals(refreshedEntitlements)
    if (refreshedBudget.remainingCents <= 0) {
      return new Response(
        JSON.stringify(
          buildInsufficientCreditsPayload(refreshedEntitlements, 'No budget remaining. Please top up your account.'),
        ),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      )
    }
  }

  const frozenNoteLines =
    rawNoteContent.length > MAX_NOTE_CHARS
      ? `${rawNoteContent.slice(0, MAX_NOTE_CHARS)}\n[Note truncated for agent context]`
      : rawNoteContent

  let budgetReservationId: string | null = null
  if (isPaidPlan(refreshedEntitlements) && isPremiumModel(effectiveModelId)) {
    const estimatedInputTokens = Math.ceil((frozenNoteLines.length + message.length + NOTEBOOK_AGENT_PROMPT.length) / 4) + 2_000
    const maxOutputTokens = 8_192
    const estimatedProviderCostUsd = await calculateLanguageModelTokenCostOrNull(
      effectiveModelId,
      estimatedInputTokens,
      0,
      maxOutputTokens,
    )
    if (estimatedProviderCostUsd === null) {
      return new Response(
        JSON.stringify({ error: 'pricing_missing', message: `Model ${effectiveModelId} is not priced for production use.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const reservation = await reserveProviderBudget({
      userId,
      entitlements: refreshedEntitlements,
      providerCostUsd: estimatedProviderCostUsd,
      kind: 'agent',
      modelId: effectiveModelId,
    })
    if (!reservation.ok) {
      return new Response(
        JSON.stringify({ ...reservation.payload, error: reservation.code }),
        { status: reservation.status, headers: { 'Content-Type': 'application/json' } },
      )
    }
    budgetReservationId = reservation.reservationId
  }

  const forwardCookie = request.headers.get('cookie') ?? undefined
  const toolOptions: OverlayToolsOptions = {
    userId,
    accessToken: auth.accessToken,
    baseUrl: getInternalApiBaseUrl(request),
    forwardCookie,
    projectId,
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
        const model = await getLanguageModel(effectiveModelId, auth.accessToken)
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

        const agent = new ToolLoopAgent({
          model,
          instructions,
          tools,
          stopWhen: stepCountIs(20),
          onStepFinish: async ({ text }) => {
            emitText(text)
          },
        })

        const prompt =
          `Note content:\n\n${frozenNoteLines || '(empty note)'}\n\n---\n\nUser request: ${message}`

        const result = await agent.generate({ prompt })

        emitText(result.text)

	        const totalUsage = result.totalUsage
	        const totalInputTokens = totalUsage?.inputTokens ?? 0
	        const totalOutputTokens = totalUsage?.outputTokens ?? 0
	        const cachedTokens = totalUsage?.inputTokenDetails?.cacheReadTokens ?? 0
	        const providerCostUsd = await calculateLanguageModelTokenCostOrNull(
	          effectiveModelId,
	          totalInputTokens,
	          cachedTokens,
	          totalOutputTokens,
	        )
	        if (providerCostUsd === null) {
	          if (budgetReservationId) {
	            await markProviderBudgetReconcile({
	              userId,
	              reservationId: budgetReservationId,
	              errorMessage: `pricing_missing:${effectiveModelId}`,
	            }).catch((_error) => undefined)
	            budgetReservationId = null
	          }
	          throw new Error(`pricing_missing:${effectiveModelId}`)
	        }
	        const costCents = billableBudgetCentsFromProviderUsd(providerCostUsd)

	        if (costCents > 0 || totalInputTokens > 0 || totalOutputTokens > 0) {
	          try {
	            const events = [
	              {
	                type: 'agent' as const,
	                modelId: effectiveModelId,
	                inputTokens: totalInputTokens,
	                outputTokens: totalOutputTokens,
	                cachedTokens,
	                cost: costCents,
	                timestamp: Date.now(),
	              },
	            ]
	            if (budgetReservationId) {
	              await finalizeProviderBudgetReservation({
	                userId,
	                reservationId: budgetReservationId,
	                actualProviderCostUsd: providerCostUsd,
	                events,
	              })
	              budgetReservationId = null
	            } else {
	              await serverContext.appData.repositories.usage.recordBatch({
	                events: events.map((event) => ({
	                  cachedTokens: event.cachedTokens,
	                  costCents: event.cost,
	                  inputTokens: event.inputTokens,
	                  kind: event.type,
	                  modelId: event.modelId,
	                  occurredAt: event.timestamp,
	                  outputTokens: event.outputTokens,
	                  providerCostUsd,
	                })),
	                operationId: `notebook_${globalThis.crypto.randomUUID()}`,
	                userId,
	              })
	            }
	          } catch (err) {
	            logger.error('[notebook-agent] Failed to record usage:', summarizeErrorForLog(err))
	            if (budgetReservationId) {
	              await markProviderBudgetReconcile({
	                userId,
	                reservationId: budgetReservationId,
	                errorMessage: summarizeErrorForLog(err),
	              }).catch((_error) => undefined)
	              budgetReservationId = null
	            }
	          }
	        }

        emit({ type: 'done' })
	      } catch (err) {
	        const msg = err instanceof Error ? err.message : String(err)
	        logger.error('[notebook-agent]', summarizeErrorForLog(err))
	        if (budgetReservationId) {
	          await releaseProviderBudgetReservation({
	            userId,
	            reservationId: budgetReservationId,
	            reason: summarizeErrorForLog(err),
	          }).catch((_error) => undefined)
	          budgetReservationId = null
	        }
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
