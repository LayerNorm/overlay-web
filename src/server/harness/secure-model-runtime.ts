import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { OverlayFreeRouteBusyError, OverlayFreeRouteInterruptedError, OverlayFreeRouteUnavailableError } from '@/server/ai/gateway/overlay-free-router-errors'
import type { HarnessModelReference } from './secure-model'
import { preserveHarnessSDKFailure } from './execution-failure'

async function model(reference: HarnessModelReference) {
  const provider = await getLanguageModel(reference.modelId, undefined, reference.credentialOwnerId, {
    sessionId: reference.sessionId,
    allowLowBalanceFallback: reference.allowLowBalanceFallback,
  })
  return wrapLanguageModel({ model: provider, middleware: extractReasoningMiddleware({ tagName: 'think' }) })
}

async function recordConfirmedRejection(reference: HarnessModelReference, error: unknown): Promise<void> {
  if ((!reference.personal && !reference.native) || reference.modelId.startsWith('byok/')) return
  const { isConfirmedHarnessModelRejection, recordHarnessModelRejection } = await import('./model-rejection')
  if (error instanceof OverlayFreeRouteBusyError) {
    await recordHarnessModelRejection(reference, 'route_capacity')
    return
  }
  if (error instanceof OverlayFreeRouteUnavailableError) {
    await recordHarnessModelRejection(reference, 'route_unavailable')
    return
  }
  if (isConfirmedHarnessModelRejection(error)) await recordHarnessModelRejection(reference, 'model_unavailable')
}

function captureModelFailure(
  reference: HarnessModelReference,
  stream: ReadableStream<LanguageModelV4StreamPart>,
): ReadableStream<LanguageModelV4StreamPart> {
  const reader = stream.getReader()
  return new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) controller.close()
        else controller.enqueue(result.value.type === 'error'
          ? { ...result.value, error: preserveHarnessSDKFailure(result.value.error) } : result.value)
      } catch (error) {
        try {
          if ((reference.personal || reference.native) && !isByokModelId(reference.modelId)
            && error instanceof OverlayFreeRouteInterruptedError) {
            const { recordHarnessModelRejection } = await import('./model-rejection')
            await recordHarnessModelRejection(reference, 'route_interrupted')
          }
        } catch (receiptError) {
          controller.error(receiptError)
          return
        }
        controller.error(preserveHarnessSDKFailure(error))
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

export async function secureModelDoStream(reference: HarnessModelReference, options: LanguageModelV4CallOptions) {
  let result: Awaited<ReturnType<Awaited<ReturnType<typeof model>>['doStream']>>
  try {
    result = await (await model(reference)).doStream(options)
  } catch (error) {
    await recordConfirmedRejection(reference, error)
    throw preserveHarnessSDKFailure(error)
  }
  const stream = captureModelFailure(reference, result.stream)
  if (!reference.native?.streamToDelivery) return { ...result, stream }
  const { projectNativeHarnessStream } = await import('./native-model-stream')
  const toolNames = new Set((options.tools ?? []).flatMap(tool => (
    'name' in tool && typeof tool.name === 'string' ? [tool.name] : []
  )))
  return { ...result, stream: await projectNativeHarnessStream(reference, stream, toolNames) }
}

export async function secureModelDoGenerate(reference: HarnessModelReference, options: LanguageModelV4CallOptions) {
  try {
    return await (await model(reference)).doGenerate(options)
  } catch (error) {
    await recordConfirmedRejection(reference, error)
    throw preserveHarnessSDKFailure(error)
  }
}
