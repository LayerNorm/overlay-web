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
    const priceEntries = await Promise.all(
      priorityList.map(async (candidateId) => [
        candidateId,
        await calculateImageModelCostOrNull(candidateId),
      ] as const),
    )
    const priceByModelId = new Map(priceEntries)
    const pricedPriorityList = generationUsagePolicy.mode === 'unlimited'
      ? priorityList
      : priorityList.filter((candidateId) => priceByModelId.get(candidateId) !== null)
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

    const maxProviderCostUsd = Math.max(...pricedPriorityList.map((candidateId) => priceByModelId.get(candidateId) ?? 0))
    const reservation = await generationUsagePolicy.reserve({
      userId: auth.userId,
      entitlements: currentEntitlements,
      idempotencyKey: context.requestIdempotencyKey,
      providerCostUsd: maxProviderCostUsd,
      kind: 'generation',
      modelId: modelId ?? 'image-fallback',
      operationId: 'media.generate-image',
      programmaticSubjectId,
      requestFingerprint: context.requestFingerprint,
      workspaceId,
    })
    if (!reservation.ok) {
      return NextResponse.json({ ...reservation.payload, error: reservation.code }, { status: reservation.status })
    }
    currentEntitlements = reservation.entitlements

    let lastError: Error | null = null
    let usedModelId: string | null = null
    let imageBase64: string | null = null

    await generationUsagePolicy.markStarted({
      userId: auth.userId,
      reservationId: reservation.reservationId,
    })
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
        usedModelId = tryModelId
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        logger.error(`[GenerateImage] Model ${tryModelId} failed:`, lastError.message)
        continue
      }
    }

    if (!imageBase64 || !usedModelId) {
      const errMsg = lastError?.message ?? 'Unknown error'
      logger.error('[GenerateImage] Generation failed. Last error:', errMsg)
      await generationUsagePolicy.release({
        userId: auth.userId,
        reservationId: reservation.reservationId,
        reason: errMsg,
      }).catch((releaseError) => logger.error('[GenerateImage] Failed to release budget reservation:', releaseError))
      return NextResponse.json(
        { error: 'generation_failed', message: `Image generation failed: ${errMsg}` },
        { status: 500 }
      )
    }

    const dataUrl = `data:image/png;base64,${imageBase64}`
    const finalModelId = usedModelId

    const recordUsage = async () => {
      const costDollars = generationUsagePolicy.mode === 'unlimited'
        ? priceByModelId.get(finalModelId) ?? 0
        : priceByModelId.get(finalModelId) ?? null
      if (costDollars === null) {
        await generationUsagePolicy.markForReconcile({
          userId: auth.userId,
          reservationId: reservation.reservationId,
          errorMessage: `pricing_missing:${finalModelId}`,
        }).catch((reconcileError) => logger.error('[GenerateImage] Failed to mark reservation for reconcile:', reconcileError))
        return NextResponse.json(
          { error: 'pricing_missing', message: `Image model ${finalModelId} is not priced for production use.` },
          { status: 500 },
        )
      }
      const costCents = billableBudgetCentsFromProviderUsd(costDollars)
      // Validate that the actual cost does not exceed the reserved amount by more
      // than a small tolerance. If it does (e.g. pricing changed between reservation
      // and finalization), mark for manual reconciliation instead of overcharging.
      if (costDollars > maxProviderCostUsd * 1.1) {
        logger.warn(`[GenerateImage] ⚠️  Actual cost $${costDollars.toFixed(4)} exceeds reserved max $${maxProviderCostUsd.toFixed(4)} by >10% — marking for reconcile`)
        await generationUsagePolicy.markForReconcile({
          userId: auth.userId,
          reservationId: reservation.reservationId,
          errorMessage: `cost_exceeds_reservation:actual=${costDollars},reserved=${maxProviderCostUsd}`,
        }).catch((reconcileError) => logger.error('[GenerateImage] Failed to mark reservation for reconcile:', reconcileError))
        // Still finalize with the reserved amount to avoid overcharging
      }
      logger.info(`[GenerateImage] 💰 Cost: model=${finalModelId} | provider=$${costDollars.toFixed(4)} billed=${costCents}¢`)
      if (costCents > 0 || reservation.reservationId) {
        try {
          const recordResult = await generationUsagePolicy.finalize({
            userId: auth.userId,
            reservationId: reservation.reservationId,
            actualProviderCostUsd: costDollars,
            events: [{
              type: 'generation',
              modelId: finalModelId,
              inputTokens: 0,
              outputTokens: 0,
              cachedTokens: 0,
              cost: costCents,
              timestamp: Date.now(),
            }],
          })
          if (recordResult) {
            const updated = await generationUsagePolicy.getEntitlements({ programmaticSubjectId, userId: auth.userId, workspaceId })
            if (updated) {
              const totalCents = updated.creditsTotal * 100
              const usedPct = totalCents > 0 ? ((updated.creditsUsed / totalCents) * 100).toFixed(2) : '0.00'
              logger.info(`[GenerateImage] ✅ Usage recorded | new state: ${updated.creditsUsed}¢ / ${totalCents}¢ (${usedPct}% used, $${((totalCents - updated.creditsUsed) / 100).toFixed(4)} remaining)`)
            }
          } else {
            logger.error(`[GenerateImage] ❌ finalizeProviderBudgetReservation returned null — check server logs for Convex error`)
          }
        } catch (recordError) {
          logger.error('[GenerateImage] Failed to finalize budget reservation:', recordError)
          await generationUsagePolicy.markForReconcile({
            userId: auth.userId,
            reservationId: reservation.reservationId,
            errorMessage: recordError instanceof Error ? recordError.message : 'finalize_failed',
          }).catch((reconcileError) => logger.error('[GenerateImage] Failed to mark reservation for reconcile:', reconcileError))
        }
      } else {
        logger.info(`[GenerateImage] ⚠️  Cost is 0¢ for model=${finalModelId} — usage not recorded`)
      }
      return null
    }

    if (temporaryChat === true) {
      const usageError = await recordUsage()
      if (usageError) return usageError
      return NextResponse.json({ outputId: null, url: dataUrl, modelUsed: finalModelId, temporary: true })
    }

    // ── Upload to R2 & save output record ────────────────────────────────────
    let outputId: string | null = null
    let uploadedR2Key: string | null = null
    try {
      const imageBuffer = Buffer.from(imageBase64!, 'base64')
      if ((currentEntitlements.overlayStorageBytesUsed ?? 0) + imageBuffer.length > (currentEntitlements.overlayStorageBytesLimit ?? 0)) {
        await generationUsagePolicy.markForReconcile({
          userId: auth.userId,
          reservationId: reservation.reservationId,
          errorMessage: 'storage_limit_exceeded_after_generation',
        }).catch((reconcileError) => logger.error('[GenerateImage] Failed to mark reservation for reconcile:', reconcileError))
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
      await generationUsagePolicy.markForReconcile({
        userId: auth.userId,
        reservationId: reservation.reservationId,
        errorMessage: err instanceof Error ? err.message : 'Failed to save generated image',
      }).catch((reconcileError) => logger.error('[GenerateImage] Failed to mark reservation for reconcile:', reconcileError))
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

    // ── Usage tracking ────────────────────────────────────────────────────────
    const usageError = await recordUsage()
    if (usageError) return usageError

    return NextResponse.json({ outputId, url: dataUrl, modelUsed: finalModelId })
  } catch (error) {
    return handleRouteError(error, {
      route: 'generate-image',
      operation: 'POST',
      clientMessage: 'Failed to generate image',
    })
  }
}
