import 'server-only'

import type {
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider'
import {
  assessFreeReceipt,
  FREE_ROUTE_TIMEOUT_MS,
} from '@/shared/ai/gateway/overlay-free-policy'
import { logger } from '@/server/observability/logger'
import {
  type OverlayFreeAttempt,
  type OverlayFreePreparedAttempt,
  type OverlayFreeReceiptSummary,
  type OverlayFreeRoute,
  type OverlayFreeStreamContext,
} from './overlay-free-router-contracts'
import { trustedOverlayFreeOptions } from './overlay-free-request-policy'

function isRateLimited(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'statusCode' in error && (error as { statusCode?: unknown }).statusCode === 429
}

function receiptSummary(value: ReturnType<typeof assessFreeReceipt>): OverlayFreeReceiptSummary {
  return {
    safe: value.safe,
    cost: value.cost,
    ...(value.reason ? { reason: value.reason } : {}),
    ...(value.actualModelId ? { actualModelId: value.actualModelId } : {}),
    ...(value.actualProvider ? { actualProvider: value.actualProvider } : {}),
  }
}

function overlayMetadata(
  providerMetadata: LanguageModelV4GenerateResult['providerMetadata'],
  route: OverlayFreeRoute,
  receipt: OverlayFreeReceiptSummary,
) {
  return {
    ...providerMetadata,
    overlayFree: {
      route: receipt.actualModelId ?? route.modelId,
      provider: receipt.actualProvider ?? route.provider,
      safe: receipt.safe,
      cost: receipt.cost,
      ...(receipt.reason ? { reason: receipt.reason } : {}),
    },
  }
}

function logUnsafeReceipt(route: OverlayFreeRoute, receipt: OverlayFreeReceiptSummary): void {
  if (receipt.safe) return
  logger.warn('[overlay-free] unsafe provider receipt', {
    routeKey: route.routeKey,
    cost: receipt.cost,
    reason: receipt.reason ?? 'unsafe receipt',
  })
}

export async function doOverlayFreeStream({
  options,
  candidates,
  deadline,
  repository,
  claim,
  preflight,
  model,
  now,
  onModelCaptured,
}: OverlayFreeStreamContext): Promise<LanguageModelV4StreamResult> {
  let safetyFailure = false
  let closed = false
  const streamAbort = new AbortController()
  const store = async <T>(operation: Promise<T>): Promise<T> => {
    try {
      return await operation
    } catch (error) {
      safetyFailure = true
      throw error
    }
  }

  let attemptIndex = 0
  const prepareAttempt = async (
    candidate: OverlayFreeRoute,
    fallbackRemains: boolean,
  ): Promise<OverlayFreePreparedAttempt | null> => {
    if (options.abortSignal?.aborted) throw options.abortSignal.reason ?? new Error('aborted')
    const claimed = await claim(candidate)
    const route = claimed.route
    const token = route?.activeLeaseToken
    if (claimed.status !== 'claimed' || !route || !token) return null
    if (closed) {
      await store(repository.cooldown(route.routeKey, token, now()))
      return null
    }
    const checked = await preflight(route, token, options, deadline)
    if (!checked) return null
    if (closed) {
      await store(repository.cooldown(route.routeKey, token, now()))
      return null
    }
    const remaining = deadline - Date.now()
    const timeout = Math.min(FREE_ROUTE_TIMEOUT_MS, remaining - (fallbackRemains ? 15_000 : 0))
    if (timeout <= 0) {
      await store(repository.cooldown(route.routeKey, token, now()))
      return null
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    return { route: checked.route, token, capabilities: checked.capabilities, controller, timer }
  }

  const settleMissingReceipt = async (route: OverlayFreeRoute, token: string) => {
    await store(repository.settle({
      routeKey: route.routeKey,
      leaseToken: token,
      now: now(),
      receipt: { safe: false, cost: null, reason: 'missing receipt' },
      safe: false,
      cost: null,
      reason: 'missing receipt',
    }))
  }

  const invokePreparedAttempt = async (
    prepared: OverlayFreePreparedAttempt,
  ): Promise<OverlayFreeAttempt | null> => {
    const { route, token, capabilities, controller, timer } = prepared
    let generationStarted = false
    try {
      const languageModel = await model(route)
      if (closed) throw new DOMException('Stream cancelled', 'AbortError')
      if (options.abortSignal?.aborted) throw options.abortSignal.reason ?? new Error('aborted')
      generationStarted = true
      const response = await languageModel.doStream({
        ...trustedOverlayFreeOptions(options, route, capabilities),
        abortSignal: AbortSignal.any([
          controller.signal, streamAbort.signal, ...(options.abortSignal ? [options.abortSignal] : []),
        ]),
      })
      if (closed) {
        await response.stream.cancel()
        throw new DOMException('Stream cancelled', 'AbortError')
      }
      return {
        route,
        token,
        reader: response.stream.getReader(),
        response,
        timer,
        controller,
        settled: false,
      }
    } catch (error) {
      clearTimeout(timer)
      if (closed || options.abortSignal?.aborted) {
        if (!generationStarted || isRateLimited(error)) {
          await store(repository.cooldown(route.routeKey, token, now()))
        } else {
          await settleMissingReceipt(route, token)
        }
        if (closed) return null
        throw error
      }
      if (!generationStarted || isRateLimited(error)) {
        await store(repository.cooldown(route.routeKey, token, now()))
      } else {
        await settleMissingReceipt(route, token)
      }
      return null
    }
  }

  const openNext = async (): Promise<OverlayFreeAttempt | null> => {
    while (!closed && attemptIndex < candidates.length && Date.now() < deadline) {
      const candidate = candidates[attemptIndex++]!
      const fallbackRemains = candidate.transport === 'gateway' &&
        candidates.slice(attemptIndex).some((item) => item.transport === 'openrouter')
      const prepared = await prepareAttempt(candidate, fallbackRemains)
      if (!prepared) continue
      const attempt = await invokePreparedAttempt(prepared)
      if (attempt) return attempt
    }
    return null
  }

  const safeOpenNext = async () => {
    try {
      return await openNext()
    } catch (error) {
      safetyFailure = true
      throw error
    }
  }

  let current = await safeOpenNext()
  if (!current) throw new Error('overlay_free_no_eligible_route')
  const initialResponse = current.response

  let responseModelId: string | undefined
  let semantic = false
  let prelude: LanguageModelV4StreamPart[] = []
  let preludeSize = 0

  const resetPrelude = () => {
    responseModelId = undefined
    prelude = []
    preludeSize = 0
  }

  const settleUnsafe = async (attempt: OverlayFreeAttempt, reason: string) => {
    if (attempt.settled) return
    attempt.settled = true
    await store(repository.settle({
      routeKey: attempt.route.routeKey,
      leaseToken: attempt.token,
      now: now(),
      receipt: { safe: false, cost: null, reason },
      safe: false,
      cost: null,
      reason,
    }))
  }

  const advanceBeforeOutput = async () => {
    current = await safeOpenNext()
    resetPrelude()
    if (!current) throw new Error('overlay_free_missing_stream_receipt')
  }

  const handleEnd = async () => {
    const attempt = current!
    clearTimeout(attempt.timer)
    await settleUnsafe(attempt, 'missing receipt')
    if (closed) return
    if (semantic || options.abortSignal?.aborted) {
      throw new Error('overlay_free_missing_stream_receipt')
    }
    await advanceBeforeOutput()
  }

  const handleEarlyError = async (error: unknown) => {
    const attempt = current!
    clearTimeout(attempt.timer)
    await attempt.reader.cancel().catch((_error) => undefined)
    if (closed) return
    if (isRateLimited(error) && !semantic) {
      if (!attempt.settled) {
        attempt.settled = true
        await store(repository.cooldown(attempt.route.routeKey, attempt.token, now()))
      }
    } else {
      await settleUnsafe(attempt, semantic ? 'stream error after output' : 'missing receipt')
    }
    if (closed) return
    if (semantic || options.abortSignal?.aborted) throw error
    current = await safeOpenNext()
    resetPrelude()
    if (!current) throw error
  }

  const handleFinish = async (part: Extract<LanguageModelV4StreamPart, { type: 'finish' }>, controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>) => {
    const attempt = current!
    clearTimeout(attempt.timer)
    const receipt = assessFreeReceipt({
      providerMetadata: part.providerMetadata,
      response: { modelId: responseModelId },
      usage: part.usage,
    }, {
      transport: attempt.route.transport,
      modelId: attempt.route.modelId,
      provider: attempt.route.provider,
    })
    const summary = receiptSummary(receipt)
    attempt.settled = true
    await store(repository.settle({
      routeKey: attempt.route.routeKey,
      leaseToken: attempt.token,
      now: now(),
      receipt: summary,
      safe: receipt.safe,
      cost: receipt.cost,
      actualModelId: receipt.actualModelId,
      actualProvider: receipt.actualProvider,
      reason: receipt.reason ?? undefined,
    }))
    if (closed) return
    logUnsafeReceipt(attempt.route, summary)
    if (receipt.actualModelId) onModelCaptured?.(receipt.actualModelId)
    for (const buffered of prelude) controller.enqueue(buffered)
    controller.enqueue({
      ...part,
      providerMetadata: overlayMetadata(part.providerMetadata, attempt.route, summary),
    })
    closed = true
    void attempt.reader.cancel().catch((_error) => undefined)
    controller.close()
  }

  const handleNormalPart = (
    part: LanguageModelV4StreamPart,
    controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
  ): 'continue' | 'return' => {
    if (part.type === 'stream-start' || part.type === 'response-metadata') {
      if (part.type === 'response-metadata' && typeof part.modelId === 'string') {
        responseModelId = part.modelId
      }
      preludeSize += JSON.stringify(part).length
      if (preludeSize > 64 * 1024 || prelude.length >= 32) {
        throw new Error('overlay_free_stream_prelude_too_large')
      }
      if (!semantic) {
        prelude.push(part)
        return 'continue'
      }
    }
    if (part.type === 'raw') return 'continue'
    if (!semantic) {
      semantic = true
      for (const buffered of prelude) controller.enqueue(buffered)
      prelude = []
      preludeSize = 0
    }
    controller.enqueue(part)
    return 'return'
  }

  const processPart = async (
    part: LanguageModelV4StreamPart,
    controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
  ): Promise<'continue' | 'return'> => {
    if (part.type === 'error') {
      await handleEarlyError(part.error)
      return 'continue'
    }
    if (part.type === 'finish') {
      await handleFinish(part, controller)
      return 'return'
    }
    return handleNormalPart(part, controller)
  }

  const handlePullError = async (
    error: unknown,
    controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
  ): Promise<boolean> => {
    if (closed) return false
    if (current) {
      clearTimeout(current.timer)
      await current.reader.cancel().catch((_error) => undefined)
      if (closed) return false
      if (!current.settled) {
        await settleUnsafe(current, semantic ? 'stream interrupted after output' : 'missing receipt')
      }
    }
    if (closed) return false
    if (safetyFailure) {
      closed = true
      controller.error(error)
      return false
    }
    if (!semantic && !options.abortSignal?.aborted) {
      current = await safeOpenNext()
      if (closed) return false
      resetPrelude()
      if (current) return true
    }
    closed = true
    controller.error(error)
    return false
  }

  const stream = new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      while (current && !closed) {
        try {
          if (options.abortSignal?.aborted) throw options.abortSignal.reason ?? new Error('aborted')
          const next = await current.reader.read()
          if (closed) return
          if (next.done) {
            await handleEnd()
            continue
          }
          if (await processPart(next.value, controller) === 'return') return
        } catch (error) {
          if (!await handlePullError(error, controller)) return
        }
      }
    },
    async cancel() {
      if (closed) return
      closed = true
      streamAbort.abort()
      if (!current || current.settled) return
      clearTimeout(current.timer)
      current.controller.abort()
      try {
        await current.reader.cancel()
      } finally {
        await settleUnsafe(current, 'stream cancelled')
      }
    },
  })

  return { ...initialResponse, stream }
}
