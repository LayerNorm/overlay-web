import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { getLanguageModel } from '@/server/ai/model-runtime'
import type { HarnessModelReference } from './secure-model'

async function model(reference: HarnessModelReference) {
  const provider = await getLanguageModel(reference.modelId, undefined, reference.credentialOwnerId, {
    sessionId: reference.sessionId,
    allowLowBalanceFallback: reference.allowLowBalanceFallback,
  })
  return wrapLanguageModel({ model: provider, middleware: [] })
}

async function recordConfirmedRejection(reference: HarnessModelReference, error: unknown): Promise<void> {
  if (!reference.personal || reference.modelId.startsWith('byok/')) return
  const { isConfirmedHarnessModelRejection, recordHarnessModelRejection } = await import('./model-rejection')
  if (isConfirmedHarnessModelRejection(error)) await recordHarnessModelRejection(reference, 'model_unavailable')
}

export async function secureModelDoStream(reference: HarnessModelReference, options: LanguageModelV4CallOptions) {
  try {
    return await (await model(reference)).doStream(options)
  } catch (error) {
    await recordConfirmedRejection(reference, error)
    throw error
  }
}

export async function secureModelDoGenerate(reference: HarnessModelReference, options: LanguageModelV4CallOptions) {
  try {
    return await (await model(reference)).doGenerate(options)
  } catch (error) {
    await recordConfirmedRejection(reference, error)
    throw error
  }
}
