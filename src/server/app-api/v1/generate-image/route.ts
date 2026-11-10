import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getBillingProgrammaticSubjectId, getTrustedAutomationBillingSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { handleRouteError } from '@/server/app-api/route-errors'
import { readValidatedJson } from '@/server/app-api/validated-input'
import { generateImage } from '@/server/ai/sdk'
import { getOverlayServerContext } from '@/server/bootstrap'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { outputService } from '@/server/outputs/http'
import { getGatewayImageModel } from '@/server/ai/model-runtime'
import { IMAGE_MODELS } from '@/shared/ai/gateway/model-data'
import { calculateImageModelCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { uploadBuffer, keyForOutput } from '@/server/storage/object-store'
import { checkGlobalR2Budget, R2GlobalBudgetError } from '@/server/storage/r2-budget'
import { deleteObject } from '@/server/storage/object-store'
import { GenerateImageRequest } from '@/shared/schemas/chat'
import {
  billableBudgetCentsFromProviderUsd,
  getBudgetTotals,
  isPaidPlan,
} from '@/server/billing/billing-runtime'

// Whether a model can be charged at all. It is not an estimate of what a call will cost.
const PRICED_PROBE_USAGE = { inputTokens: 0, outputTokens: 0 }

export const maxDuration = 120

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const bodyResult = await readValidatedJson(request, context, GenerateImageRequest)
    if (!bodyResult.ok) return bodyResult.response
    const { prompt, modelId, aspectRatio, conversationId, turnId, imageUrl, temporaryChat } = bodyResult.data

    const { auth } = context
    const workspaceId = context.workspace.workspace.id
    const programmaticSubjectId = getBillingProgrammaticSubjectId(context, getTrustedAutomationBillingSubjectId(context))


    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    const { generationUsagePolicy } = getOverlayServerContext()

    // ── Subscription enforcement ──────────────────────────────────────────────
    const entitlements = await generationUsagePolicy.getEntitlements({ programmaticSubjectId, userId: auth.userId, workspaceId })

    if (!entitlements) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Could not verify subscription. Try signing out and back in.' },
        { status: 401 },
      )
    }

    let currentEntitlements = entitlements
    const budget = getBudgetTotals(currentEntitlements)
    const usedPct = budget.totalCents > 0 ? ((budget.usedCents / budget.totalCents) * 100).toFixed(2) : '0.00'
    logger.info(`[GenerateImage] 📊 Entitlements: tier=${currentEntitlements.tier} | used=${budget.usedCents}¢ / ${budget.totalCents}¢ (${usedPct}% used, $${(budget.remainingCents / 100).toFixed(4)} remaining) | userId=${auth.userId}`)
    if (!isPaidPlan(currentEntitlements)) {
      return NextResponse.json(
        { error: 'generation_not_allowed', message: 'Image generation requires a paid plan.' },
        { status: 403 }
      )
    }
    const authorizedModelIds = await resolveAuthorizedModelIds({ entitlements: currentEntitlements })
    if ((currentEntitlements.overlayStorageBytesUsed ?? 0) >= (currentEntitlements.overlayStorageBytesLimit ?? 0)) {
      return NextResponse.json(
        { error: 'storage_limit_exceeded', message: 'Overlay storage limit reached. Delete files or outputs, or upgrade your plan.' },
        { status: 403 },
      )
    }

    // ── Build reference image for editing (if provided) ──────────────────────
    // Accept data URLs (base64) or plain https URLs
    const referenceImage: string | undefined = imageUrl || undefined

    // ── Model selection: when user picks a model, use only that model ─────────
    // Fall back through all models only when no model is specified
    if (modelId && !authorizedModelIds.image.has(modelId)) {
      return NextResponse.json(
        {
          error: 'model_not_allowed',
          message: `Image model ${modelId} is not allowed by the server model policy.`,
        },
        { status: 403 },
      )
    }
    const priorityList = modelId
      ? [modelId]
      : IMAGE_MODELS.map((m) => m.id).filter((candidateId) =>
          authorizedModelIds.image.has(candidateId),
        )
    const pricedEntries = await Promise.all(
      priorityList.map(async (candidateId) =>
        [candidateId, await calculateImageModelCostOrNull(candidateId, PRICED_PROBE_USAGE) !== null] as const),
    )
    const pricedPriorityList = generationUsagePolicy.mode === 'unlimited'
      ? priorityList
      : pricedEntries.filter(([, priced]) => priced).map(([candidateId]) => candidateId)
    if (pricedPriorityList.length === 0) {
      return NextResponse.json(
        { error: 'pricing_missing', message: 'Image generation is temporarily unavailable because model pricing is missing.' },
        { status: 400 },
      )
    }
    if (modelId && pricedPriorityList[0] !== modelId) {
      return NextResponse.json(
        { error: 'pricing_missing', message: `Image model ${modelId} is not priced for production use.` },
        { status: 400 },
      )
    }

    const check = await generationUsagePolicy.ensureBudgetNotLow({
      userId: auth.userId,
      entitlements: currentEntitlements,
      kind: 'generation',
      modelId: modelId ?? 'image-fallback',
      operationId: 'media.generate-image',
      programmaticSubjectId,
      workspaceId,
    })
    if (!check.ok) {
      return NextResponse.json({ ...check.payload, error: check.code }, { status: check.status })
    }
    currentEntitlements = check.entitlements

    let lastError: Error | null = null
    let usedModelId: string | null = null
    let imageBase64: string | null = null
    let imageUsage: { inputTokens: number | undefined; outputTokens: number | undefined } | null = null

    for (const tryModelId of pricedPriorityList) {
      try {
        const imageModel = await getGatewayImageModel(tryModelId, auth.accessToken || undefined)

        // Use the AI SDK prompt-with-images format for image editing
        // When no reference image is provided, pass a plain string prompt
        const finalPrompt = referenceImage
          ? { text: prompt.trim(), images: [referenceImage] }
          : prompt.trim()
        const result = await generateImage({
          model: imageModel,
          prompt: finalPrompt,
          aspectRatio: (aspectRatio as `${number}:${number}` | undefined) ?? '1:1',
        })
        imageBase64 = result.image.base64
        imageUsage = result.usage
        usedModelId = tryModelId
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        logger.error(`[GenerateImage] Model ${tryModelId} failed:`, lastError.message)
        continue
      }
    }

    // A failed generation charges nothing.
    if (!imageBase64 || !usedModelId) {
      const errMsg = lastError?.message ?? 'Unknown error'
      logger.error('[GenerateImage] Generation failed. Last error:', errMsg)
      return NextResponse.json(
        { error: 'generation_failed', message: `Image generation failed: ${errMsg}` },
        { status: 500 }
      )
    }

    // Charged its actual cost once the image is delivered; an image that cannot be delivered charges nothing.
    const finalModelId = usedModelId
    const chargeDeliveredImage = async () => {
      const costDollars = await calculateImageModelCostOrNull(finalModelId, imageUsage ?? undefined)
      if (costDollars === null) {
        logger.error(`[GenerateImage] No price for the finished image from ${finalModelId}; nothing was charged`)
        return
      }
      logger.info(`[GenerateImage] Cost: model=${finalModelId} | provider=$${costDollars.toFixed(4)} billed=${billableBudgetCentsFromProviderUsd(costDollars)}c`)
      await generationUsagePolicy.charge({
        userId: auth.userId,
        workspaceId,
        programmaticSubjectId,
        operationId: `media.generate-image:${globalThis.crypto.randomUUID()}`,
        providerCostUsd: costDollars,
        usage: {
          kind: 'generation',
          modelId: finalModelId,
          inputTokens: imageUsage?.inputTokens ?? 0,
          outputTokens: imageUsage?.outputTokens ?? 0,
          cachedTokens: 0,
        },
      }).catch((recordError) => logger.error('[GenerateImage] Failed to record usage:', recordError))
    }

    const dataUrl = `data:image/png;base64,${imageBase64}`
    if (temporaryChat === true) {
      await chargeDeliveredImage()
      return NextResponse.json({ outputId: null, url: dataUrl, modelUsed: finalModelId, temporary: true })
    }

    // ── Upload to R2 & save output record ────────────────────────────────────
    let outputId: string | null = null
    let uploadedR2Key: string | null = null
    try {
      const imageBuffer = Buffer.from(imageBase64!, 'base64')
      if ((currentEntitlements.overlayStorageBytesUsed ?? 0) + imageBuffer.length > (currentEntitlements.overlayStorageBytesLimit ?? 0)) {
        return NextResponse.json(
          { error: 'storage_limit_exceeded', message: 'Not enough Overlay storage remaining for this image.' },
          { status: 403 },
        )
      }
      const fileName = `overlay-image-${Date.now()}.png`
      outputId = await outputService.create({
          userId: auth.userId,
          workspaceId: context.workspace.workspace.id,
          type: 'image',
          source: 'image_generation',
          status: 'pending',
          prompt: prompt.trim(),
          modelId: finalModelId,
          fileName,
          mimeType: 'image/png',
          ...(conversationId ? { conversationId } : {}),
          ...(turnId ? { turnId } : {}),
      })

      if (!outputId) {
        throw new Error('Output record was not created.')
      }
      const persistedOutputId = outputId
      const r2Key = keyForOutput(auth.userId, persistedOutputId, fileName)
      await checkGlobalR2Budget(imageBuffer.length)
      await uploadBuffer(r2Key, imageBuffer, 'image/png')
      uploadedR2Key = r2Key
      logger.info(`[GenerateImage] ✅ Uploaded ${imageBuffer.length}B to R2 key=${r2Key}`)

      await outputService.update({
          outputId: persistedOutputId,
          userId: auth.userId,
          status: 'completed',
          modelId: finalModelId,
          r2Key,
          fileName,
          mimeType: 'image/png',
          sizeBytes: imageBuffer.length,
      })
    } catch (err) {
      logger.error('[GenerateImage] Failed to save output:', err)
      if (uploadedR2Key) {
        await deleteObject(uploadedR2Key).catch((_error) => undefined)
      }
      if (outputId) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to save generated image'
        await outputService.update({
            outputId,
            userId: auth.userId,
            status: 'failed',
            errorMessage,
        }).catch((_error) => undefined)
      }
      if (err instanceof R2GlobalBudgetError) {
        return NextResponse.json(
          { error: 'storage_limit_exceeded', message: 'Global R2 storage cap reached. Contact support.' },
          { status: 403 },
        )
      }
      if (err instanceof Error && err.message.includes('storage_limit_exceeded')) {
        return NextResponse.json(
          { error: 'storage_limit_exceeded', message: 'Not enough Overlay storage remaining for this image.' },
          { status: 403 },
        )
      }
      return NextResponse.json(
        { error: 'save_failed', message: err instanceof Error ? err.message : 'Failed to save generated image.' },
        { status: 500 },
      )
    }

    await chargeDeliveredImage()
    return NextResponse.json({ outputId, url: dataUrl, modelUsed: finalModelId })
  } catch (error) {
    return handleRouteError(error, {
      route: 'generate-image',
      operation: 'POST',
      clientMessage: 'Failed to generate image',
    })
  }
}
