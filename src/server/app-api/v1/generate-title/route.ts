import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getBillingProgrammaticSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { generateText } from '@/server/ai/sdk'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { fallbackChatTitle, sanitizeChatTitle } from '@/shared/chat/chat-title'
import { isPaidPlan, type Entitlements } from '@overlay/billing'
import { extractTitle } from './extract-title'
import { runTitleAttempts } from './title-attempts'
import { buildTitleRequest } from './title-request'

const TITLE_MODEL_ID = 'z-ai/glm-5.3-flash'
const FALLBACK_TITLE = 'New Chat'
const MAX_OUTPUT_TOKENS = 2048

const TITLE_INSTRUCTIONS =
  'You write short chat titles. Reply with the title only: 3 to 6 words, natural title case, ' +
  'no surrounding quotes, no trailing punctuation, no preamble. Capture the actual topic, not the first words.'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = (await request.json().catch((_error) => ({}))) as { text?: string }
    const { text } = body
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text required' }, { status: 400 })
    }

    const { auth } = context
    const workspaceId = context.workspace.workspace.id
    const programmaticSubjectId = getBillingProgrammaticSubjectId(context)
    const { chatUsagePolicy } = getOverlayServerContext()

    const entitlements = await chatUsagePolicy.getEntitlements({
      programmaticSubjectId,
      userId: auth.userId,
      workspaceId,
    })
    const fallback = fallbackChatTitle(text)
    if (!entitlements || !isPaidPlan(entitlements)) return NextResponse.json({ title: fallback })

    const { prompt, estimatedInputTokens } = buildTitleRequest(text, TITLE_INSTRUCTIONS)

    const outcome = await runTitleAttempts(
      (abortSignal) => generateTitleWithModel({
        abortSignal,
        chatUsagePolicy,
        context,
        entitlements,
        estimatedInputTokens,
        programmaticSubjectId,
        prompt,
        workspaceId,
      }),
      {
        maxAttempts: 1,
        budgetMs: 12_000,
        signal: request.signal,
        onError: (error) => logger.warn('[ChatTitle][server] Title model failed', {
          modelId: TITLE_MODEL_ID,
          error,
        }),
      },
    )

    return NextResponse.json({ title: outcome.title ?? fallback })
  } catch (error) {
    logger.error('[ChatTitle][server] Failed to generate title', error)
    return NextResponse.json({ error: 'Failed to generate title' }, { status: 500 })
  }
}

async function generateTitleWithModel({
  abortSignal,
  chatUsagePolicy,
  context,
  entitlements,
  estimatedInputTokens,
  programmaticSubjectId,
  prompt,
  workspaceId,
}: {
  abortSignal: AbortSignal
  chatUsagePolicy: ReturnType<typeof getOverlayServerContext>['chatUsagePolicy']
  context: AppApiRouteContext
  entitlements: Entitlements
  estimatedInputTokens: number
  programmaticSubjectId?: string
  prompt: string
  workspaceId: string
}): Promise<string | null> {
  const { auth } = context
  const modelId = TITLE_MODEL_ID
  const check = await chatUsagePolicy.ensureBudgetNotLow({
    entitlements,
    modelId,
    operationId: 'chat.generate-title',
    programmaticSubjectId,
    userId: auth.userId,
    workspaceId,
  })
  if (!check.ok) return null

  abortSignal.throwIfAborted()
  const languageModel = await getLanguageModel(modelId, auth.accessToken, auth.userId, { workspaceId })
  abortSignal.throwIfAborted()
  // A failed call charges nothing.
  const result = await generateText({
    abortSignal,
    model: languageModel,
    instructions: TITLE_INSTRUCTIONS,
    temperature: 0.2,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    prompt,
  })

  const sanitizedTitle = sanitizeChatTitle(extractTitle(result.text ?? ''), FALLBACK_TITLE)
  if (sanitizedTitle === FALLBACK_TITLE) {
    logger.warn('[ChatTitle][server] Model returned an empty title', {
      stopCause: result.finishReason,
      modelId,
      thinkingChars: result.reasoningText?.length ?? 0,
      textLength: result.text?.length ?? 0,
    })
  }

  const usage = result.usage as { inputTokens?: number; outputTokens?: number } | undefined
  await chatUsagePolicy.recordFinishedUsage({
    inputTokens: usage?.inputTokens ?? estimatedInputTokens,
    modelId,
    operationId: `chat.generate-title:${globalThis.crypto.randomUUID()}`,
    outputTokens: usage?.outputTokens ?? MAX_OUTPUT_TOKENS,
    programmaticSubjectId,
    userId: auth.userId,
    workspaceId,
  }).catch((error) => logger.error('[ChatTitle][server] Failed to record usage', error))

  return sanitizedTitle === FALLBACK_TITLE ? null : sanitizedTitle
}
