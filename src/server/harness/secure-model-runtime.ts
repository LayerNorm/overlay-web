import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import { getLanguageModel } from '@/server/ai/model-runtime'
import type { HarnessModelReference } from './secure-model'
import { preserveHarnessSDKFailure } from './execution-failure'
import { recordPublicStreamMetric } from './public-stream-metrics'

async function model(reference: HarnessModelReference) {
  const provider = await getLanguageModel(reference.modelId, undefined, reference.credentialOwnerId, {
    sessionId: reference.sessionId,
    workspaceId: reference.personal?.access.workspaceId ?? reference.native?.access.workspaceId,
  })
  return wrapLanguageModel({ model: provider, middleware: extractReasoningMiddleware({ tagName: 'think' }) })
}

async function recordConfirmedRejection(reference: HarnessModelReference, error: unknown): Promise<void> {
  if ((!reference.personal && !reference.native) || reference.modelId.startsWith('byok/')) return
  const { isConfirmedHarnessModelRejection, recordHarnessModelRejection } = await import('./model-rejection')
  if (isConfirmedHarnessModelRejection(error)) await recordHarnessModelRejection(reference, 'model_unavailable')
}

function captureModelFailure(
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
        controller.error(preserveHarnessSDKFailure(error))
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

export async function secureModelDoStream(reference: HarnessModelReference, options: LanguageModelV4CallOptions) {
  let selectedModel: Awaited<ReturnType<typeof model>>
  try {
    selectedModel = await model(reference)
  } catch (error) {
    await recordConfirmedRejection(reference, error)
    throw preserveHarnessSDKFailure(error)
  }
  const dispatchStartedAt = performance.now()
  const authority = reference.personal ?? reference.native
  if (authority && reference.publicStreamVersion === 1 && reference.purpose === 'response') {
    recordPublicStreamMetric({
      event: 'model_dispatch', runId: authority.access.runId,
      generation: authority.access.executionGeneration ?? 0, receiptId: authority.receiptId,
      modelId: reference.modelId,
    })
  }
  let result: Awaited<ReturnType<Awaited<ReturnType<typeof model>>['doStream']>>
  try {
    result = await selectedModel.doStream(options)
  } catch (error) {
    await recordConfirmedRejection(reference, error)
    throw preserveHarnessSDKFailure(error)
  }
  const stream = captureModelFailure(result.stream)
  const toolNames = new Set((options.tools ?? []).flatMap(tool => (
    'name' in tool && typeof tool.name === 'string' ? [tool.name] : []
  )))
  if (reference.publicStreamVersion === 1 && reference.purpose === 'response') {
    const { publishUnifiedHarnessStream } = await import('./public-stream-publisher')
    return { ...result, stream: publishUnifiedHarnessStream(reference, stream, toolNames, dispatchStartedAt) }
  }
  if (!reference.native?.streamToDelivery) return { ...result, stream }
  const { projectNativeHarnessStream } = await import('./native-model-stream')
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
