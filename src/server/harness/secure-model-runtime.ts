import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { OverlayFreeRouteBusyError } from '@/server/ai/gateway/overlay-free-router-errors'
import type { HarnessModelReference } from './secure-model'

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
  if (isConfirmedHarnessModelRejection(error)) await recordHarnessModelRejection(reference, 'model_unavailable')
}

export async function secureModelDoStream(reference: HarnessModelReference, options: LanguageModelV4CallOptions) {
  let result: Awaited<ReturnType<Awaited<ReturnType<typeof model>>['doStream']>>
  try {
    result = await (await model(reference)).doStream(options)
  } catch (error) {
    await recordConfirmedRejection(reference, error)
    throw error
  }
  if (!reference.native?.streamToDelivery) return result
  const { projectNativeHarnessStream } = await import('./native-model-stream')
  return { ...result, stream: await projectNativeHarnessStream(reference, result.stream) }
}

export async function secureModelDoGenerate(reference: HarnessModelReference, options: LanguageModelV4CallOptions) {
  try {
    return await (await model(reference)).doGenerate(options)
  } catch (error) {
    await recordConfirmedRejection(reference, error)
    throw error
  }
}
