import { logger } from '@/server/observability/logger'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { readValidatedJson } from '@/server/app-api/validated-input'
import { experimental_generateVideo as generateVideo } from '@/server/ai/sdk'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getGatewayVideoModel } from '@/server/ai/model-runtime'
import type { VideoSubMode } from '@/shared/ai/gateway/model-types'
import { getVideoModelsBySubMode } from '@/shared/ai/gateway/model-data'
import { calculateVideoModelCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { uploadBuffer, keyForOutput, deleteObject } from '@/server/storage/object-store'
import { checkGlobalR2Budget, R2GlobalBudgetError } from '@/server/storage/r2-budget'
import type { Entitlements } from '@/shared/app/app-contracts'
import { GenerateVideoRequest } from '@/shared/schemas/chat'
import {
  billableBudgetCentsFromProviderUsd,
  finalizeProviderBudgetReservation,
  getBudgetTotals,
  isPaidPlan,
  markProviderBudgetReconcile,
  releaseProviderBudgetReservation,
  reserveProviderBudget,
} from '@/server/billing/billing-runtime'

export const maxDuration = 300

function sseChunk(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  const bodyResult = await readValidatedJson(request, context, GenerateVideoRequest)
  if (!bodyResult.ok) return bodyResult.response
  const { prompt, modelId, aspectRatio, duration, conversationId, turnId, videoSubMode, imageUrl, temporaryChat } = bodyResult.data

  const { auth } = context


  if (!prompt?.trim()) {
    return new Response('Prompt is required', { status: 400 })
  }
  const effectiveSubMode: VideoSubMode = videoSubMode ?? 'text-to-video'
  const allowedModels = getVideoModelsBySubMode(effectiveSubMode).map((m) => m.id)
  const selectedModelId = modelId ?? allowedModels[0]
  if (!selectedModelId || !allowedModels.includes(selectedModelId)) {
    return new Response('Unsupported video model for this mode', { status: 400 })
  }

  const serverSecret = getInternalApiSecret()

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s)
      let outputId: string | null = null
      let uploadedR2Key: string | null = null
      let reservationId: string | null = null
      let providerSucceeded = false

      const markOutputFailed = async (errorMessage: string) => {
        if (!outputId) return
        await convex.mutation(
          'outputs/outputs:update',
          {
            outputId,
            userId: auth.userId,
            serverSecret,
            status: 'failed',
            errorMessage,
          },
          { throwOnError: true },
        ).catch((_error) => undefined)
      }
      const releaseReservedBudget = async (reason?: string) => {
        if (!reservationId) return
        await releaseProviderBudgetReservation({
          userId: auth.userId,
          reservationId,
          providerWorkStarted: providerSucceeded,
          reason,
        }).catch((err) => logger.error('[GenerateVideo] Failed to release budget reservation:', err))
        reservationId = null
      }

      try {
        // ── Subscription enforcement ────────────────────────────────────────
        const entitlements = await convex.query<Entitlements>('platform/usage:getEntitlementsByServer', {
          serverSecret,
          userId: auth.userId,
        })

        if (!entitlements) {
          controller.enqueue(
            encode(
              sseChunk({
                type: 'error',
                error: 'unauthorized',
                message: 'Could not verify subscription. Try signing out and back in.',
              }),
            ),
          )
          controller.close()
          return
        }

        const rawDuration = duration ?? 8
        // Clamp duration to model-supported ranges before any cost calculation or API call.
        // Veo models only accept 4, 6, or 8 seconds for text-to-video.
        // Seedance v1.5 Pro accepts 4–12 seconds.
        // Other models: cap at 10 seconds to stay within reasonable API limits.
        function clampDurationForModel(modelId: string, d: number): number {
          if (modelId.startsWith('google/veo')) {
            const veoOptions = [4, 6, 8]
            return veoOptions.reduce((prev, curr) => Math.abs(curr - d) < Math.abs(prev - d) ? curr : prev)
          }
          if (modelId.startsWith('bytedance/seedance')) {
            return Math.min(12, Math.max(4, d))
          }
          return Math.min(10, Math.max(3, d))
        }
        const effectiveDuration = clampDurationForModel(selectedModelId, rawDuration)
        let currentEntitlements = entitlements
        const budget = getBudgetTotals(currentEntitlements)
        const usedPct = budget.totalCents > 0 ? ((budget.usedCents / budget.totalCents) * 100).toFixed(2) : '0.00'
        logger.info(`[GenerateVideo] 📊 Entitlements: tier=${currentEntitlements.tier} | used=${budget.usedCents}¢ / ${budget.totalCents}¢ (${usedPct}% used, $${(budget.remainingCents / 100).toFixed(4)} remaining) | userId=${auth.userId}`)
        if (!isPaidPlan(currentEntitlements)) {
          controller.enqueue(encode(sseChunk({ type: 'error', error: 'generation_not_allowed', message: 'Video generation requires a paid plan.' })))
          controller.close()
          return
        }
        if ((currentEntitlements.overlayStorageBytesUsed ?? 0) >= (currentEntitlements.overlayStorageBytesLimit ?? 0)) {
          controller.enqueue(encode(sseChunk({ type: 'error', error: 'storage_limit_exceeded', message: 'Overlay storage limit reached. Delete files or outputs, or upgrade your plan.' })))
          controller.close()
          return
        }

        const subModeModels = allowedModels
        const priorityList = [selectedModelId, ...subModeModels.filter((id) => id !== selectedModelId)]
        const priceEntries = await Promise.all(
          priorityList.map(async (candidateId) => [
            candidateId,
            await calculateVideoModelCostOrNull(
              candidateId,
              clampDurationForModel(candidateId, rawDuration),
            ),
          ] as const),
        )
        const priceByModelId = new Map(priceEntries)
        const pricedPriorityList = priorityList.filter((candidateId) =>
          priceByModelId.get(candidateId) !== null,
        )
        if (pricedPriorityList.length === 0) {
          controller.enqueue(encode(sseChunk({ type: 'error', error: 'pricing_missing', message: 'No priced video models are available for this mode.' })))
          controller.close()
          return
        }
        if (modelId && pricedPriorityList[0] !== selectedModelId) {
          controller.enqueue(encode(sseChunk({ type: 'error', error: 'pricing_missing', message: 'This video model is not configured for billing.' })))
          controller.close()
          return
        }
        const maxProviderCostUsd = Math.max(...pricedPriorityList.map((candidateId) =>
          priceByModelId.get(candidateId) ?? 0,
        ))
        const reservation = await reserveProviderBudget({
          userId: auth.userId,
          entitlements: currentEntitlements,
          providerCostUsd: maxProviderCostUsd,
          kind: 'generation',
          modelId: modelId ?? 'video-fallback',
        })
        if (!reservation.ok) {
          controller.enqueue(encode(sseChunk({ type: 'error', ...reservation.payload, error: reservation.code })))
          controller.close()
          return
        }
        reservationId = reservation.reservationId
        currentEntitlements = reservation.entitlements

        if (temporaryChat === true) {
          controller.enqueue(encode(sseChunk({ type: 'started', outputId: null, temporary: true })))
        } else {
          // ── Create pending output record ────────────────────────────────────
          try {
            outputId = await convex.mutation<string>(
              'outputs/outputs:create',
              {
                userId: auth.userId,
                serverSecret,
                type: 'video',
                source: 'video_generation',
                status: 'pending',
                prompt: prompt.trim(),
                modelId: selectedModelId,
                fileName: `overlay-video-${Date.now()}.mp4`,
                mimeType: 'video/mp4',
                ...(conversationId ? { conversationId } : {}),
                ...(turnId ? { turnId } : {}),
              },
              { throwOnError: true },
            )
          } catch (err) {
            logger.error('[GenerateVideo] Failed to create output record:', err)
            await releaseReservedBudget(err instanceof Error ? err.message : 'output_create_failed')
            controller.enqueue(encode(sseChunk({ type: 'error', error: 'save_failed', message: 'Could not create the output record.' })))
            controller.close()
            return
          }
          if (!outputId) {
            await releaseReservedBudget('output_create_empty')
            controller.enqueue(encode(sseChunk({ type: 'error', error: 'save_failed', message: 'Could not create the output record.' })))
            controller.close()
            return
          }

          // ── Signal to client that we started ─────────────────────────────────
          controller.enqueue(encode(sseChunk({ type: 'started', outputId })))
        }

        let lastError: Error | null = null
        let usedModelId: string | null = null
        let usedDuration = effectiveDuration
        let videoBase64: string | null = null
        for (const tryModelId of pricedPriorityList) {
          try {
            const videoModel = await getGatewayVideoModel(
              tryModelId,
              auth.accessToken || undefined,
            )

            const modelDuration = clampDurationForModel(tryModelId, rawDuration)
            let result: Awaited<ReturnType<typeof generateVideo>>
            if (effectiveSubMode === 'image-to-video') {
              result = await generateVideo({
                model: videoModel,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                prompt: { text: prompt.trim(), image: imageUrl } as any,
                duration: modelDuration,
                aspectRatio: (aspectRatio as `${number}:${number}` | undefined) ?? '16:9',
              })
            } else if (effectiveSubMode === 'reference-to-video') {
              result = await generateVideo({
                model: videoModel,
                prompt: prompt.trim(),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                providerOptions: { alibaba: { referenceUrls: imageUrl ? [imageUrl] : [] } } as any,
              })
            } else if (effectiveSubMode === 'motion-control') {
              result = await generateVideo({
                model: videoModel,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                prompt: { image: imageUrl, text: prompt.trim() } as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                providerOptions: { klingai: { videoUrl: imageUrl, characterOrientation: 'video', mode: 'std' } } as any,
              })
            } else if (effectiveSubMode === 'video-editing') {
              result = await generateVideo({
                model: videoModel,
                prompt: prompt.trim(),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                providerOptions: { xai: { videoUrl: imageUrl, pollTimeoutMs: 600000 } } as any,
              })
            } else {
              // text-to-video (default)
              result = await generateVideo({
                model: videoModel,
                prompt: prompt.trim(),
                duration: modelDuration,
                aspectRatio: (aspectRatio as `${number}:${number}` | undefined) ?? '16:9',
              })
            }

            videoBase64 = result.videos[0]?.base64 ?? null
            usedModelId = tryModelId
            usedDuration = modelDuration
            providerSucceeded = true
            break
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err))
            logger.error(`[GenerateVideo] Model ${tryModelId} failed:`, lastError.message)
            continue
          }
        }

        if (!videoBase64 || !usedModelId) {
          // Update Convex record to failed
          await markOutputFailed(lastError?.message ?? 'All models failed')
          await releaseReservedBudget(lastError?.message ?? 'All models failed')
          controller.enqueue(encode(sseChunk({ type: 'failed', outputId, error: 'All video models failed. Please try again.' })))
          controller.close()
          return
        }

        const dataUrl = `data:video/mp4;base64,${videoBase64}`
        const videoBuffer = Buffer.from(videoBase64!, 'base64')

        if (temporaryChat !== true) {
          const persistedOutputId = outputId

          // ── Check per-user storage quota ────────────────────────────────────────
          if ((currentEntitlements.overlayStorageBytesUsed ?? 0) + videoBuffer.length > (currentEntitlements.overlayStorageBytesLimit ?? 0)) {
            await markOutputFailed('Not enough Overlay storage remaining for this video.')
            await releaseReservedBudget('storage_limit_exceeded_after_generation')
            controller.enqueue(encode(sseChunk({ type: 'error', error: 'storage_limit_exceeded', message: 'Not enough Overlay storage remaining for this video.' })))
            controller.close()
            return
          }

          // ── Upload to R2 ─────────────────────────────────────────────────────────
          let r2Key: string | null = null
          try {
            const fileName = `overlay-video-${Date.now()}.mp4`
            const key = keyForOutput(auth.userId, persistedOutputId!, fileName)
            await checkGlobalR2Budget(videoBuffer.length)
            await uploadBuffer(key, videoBuffer, 'video/mp4')
            r2Key = key
            uploadedR2Key = key
            logger.info(`[GenerateVideo] ✅ Uploaded ${videoBuffer.length}B to R2 key=${key}`)
          } catch (err) {
            logger.error('[GenerateVideo] Failed to upload to R2:', err)
            await markOutputFailed(err instanceof Error ? err.message : 'Failed to upload video')
            if (err instanceof R2GlobalBudgetError) {
              await releaseReservedBudget('global_r2_budget_after_generation')
              controller.enqueue(encode(sseChunk({ type: 'error', error: 'storage_limit_exceeded', message: 'Global R2 storage cap reached. Contact support.' })))
              controller.close()
              return
            }
            await releaseReservedBudget(err instanceof Error ? err.message : 'r2_upload_failed')
            controller.enqueue(encode(sseChunk({ type: 'failed', outputId, error: 'Failed to save generated video.' })))
            controller.close()
            return
          }

          // ── Update Convex record to completed ───────────────────────────────────────
          try {
            await convex.mutation(
              'outputs/outputs:update',
              {
                outputId: persistedOutputId!,
                userId: auth.userId,
                serverSecret,
                status: 'completed',
                modelId: usedModelId,
                sizeBytes: videoBuffer.length,
                ...(r2Key ? { r2Key } : {}),
              },
              { throwOnError: true },
            )
          } catch (err) {
            logger.error('[GenerateVideo] Failed to update output:', err)
            if (uploadedR2Key) {
              await deleteObject(uploadedR2Key).catch((_error) => undefined)
            }
            await markOutputFailed(err instanceof Error ? err.message : 'Failed to finalize output record')
            if (err instanceof Error && err.message.includes('storage_limit_exceeded')) {
              await releaseReservedBudget('storage_limit_exceeded_after_generation')
              controller.enqueue(encode(sseChunk({ type: 'error', error: 'storage_limit_exceeded', message: 'Not enough Overlay storage remaining for this video.' })))
              controller.close()
              return
            }
            await releaseReservedBudget(err instanceof Error ? err.message : 'output_update_failed')
            controller.enqueue(encode(sseChunk({ type: 'failed', outputId, error: 'Failed to save generated video.' })))
            controller.close()
            return
          }
        }

        // ── Usage tracking ────────────────────────────────────────────────────────
        const costDollars = priceByModelId.get(usedModelId) ?? null
        if (costDollars == null) {
          await markProviderBudgetReconcile({
            userId: auth.userId,
            reservationId,
            errorMessage: `pricing_missing:${usedModelId}`,
          }).catch((err) => logger.error('[GenerateVideo] Failed to mark budget reservation for reconcile:', err))
          controller.enqueue(encode(sseChunk({ type: 'error', error: 'pricing_missing', message: 'Generated video model is not configured for billing.' })))
          controller.close()
          return
        }
        const costCents = billableBudgetCentsFromProviderUsd(costDollars)
        try {
          await finalizeProviderBudgetReservation({
            userId: auth.userId,
            reservationId,
            actualProviderCostUsd: costDollars,
            events: [{
              type: 'generation',
              modelId: usedModelId,
              inputTokens: 0,
              outputTokens: 0,
              cachedTokens: 0,
              cost: costCents,
              timestamp: Date.now(),
            }],
          })
          reservationId = null
        } catch (err) {
          logger.error('[GenerateVideo] Failed to finalize budget reservation:', err)
          await markProviderBudgetReconcile({
            userId: auth.userId,
            reservationId,
            errorMessage: err instanceof Error ? err.message : 'finalize_failed',
          }).catch((reconcileError) => logger.error('[GenerateVideo] Failed to mark budget reservation for reconcile:', reconcileError))
        }
        logger.info(`[GenerateVideo] 💰 Cost: model=${usedModelId} | duration=${usedDuration}s | provider=$${costDollars.toFixed(4)} billed=${costCents}¢`)

        controller.enqueue(encode(sseChunk({ type: 'completed', outputId, url: dataUrl, modelUsed: usedModelId, temporary: temporaryChat === true })))
        controller.close()
      } catch (error) {
        logger.error('[GenerateVideo] Unexpected error:', error)
        await markOutputFailed(error instanceof Error ? error.message : 'Unexpected error during video generation.')
        await releaseReservedBudget(error instanceof Error ? error.message : 'unexpected_error')
        controller.enqueue(encode(sseChunk({ type: 'failed', error: 'Unexpected error during video generation.' })))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
