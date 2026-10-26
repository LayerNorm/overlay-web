import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@workflow/serde'
import { wrapLanguageModel } from 'ai'
import { getLanguageModel } from '@/server/ai/model-runtime'

export type HarnessModelReference = {
  modelId: string
  credentialOwnerId: string
  sessionId?: string
  allowLowBalanceFallback?: boolean
}

export class HarnessLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const
  readonly provider = 'overlay-harness'
  readonly supportedUrls = {}

  constructor(readonly reference: HarnessModelReference) {}

  get modelId() { return this.reference.modelId }

  static [WORKFLOW_SERIALIZE](model: HarnessLanguageModel): HarnessModelReference {
    return {
      modelId: model.reference.modelId,
      credentialOwnerId: model.reference.credentialOwnerId,
      ...(model.reference.sessionId ? { sessionId: model.reference.sessionId } : {}),
      ...(model.reference.allowLowBalanceFallback !== undefined ? { allowLowBalanceFallback: model.reference.allowLowBalanceFallback } : {}),
    }
  }

  static [WORKFLOW_DESERIALIZE](reference: HarnessModelReference) {
    return new HarnessLanguageModel(reference)
  }

  async doStream(options: LanguageModelV4CallOptions) {
    'use step'
    const model = await getLanguageModel(this.reference.modelId, undefined, this.reference.credentialOwnerId, {
      sessionId: this.reference.sessionId,
      allowLowBalanceFallback: this.reference.allowLowBalanceFallback,
    })
    return wrapLanguageModel({ model, middleware: [] }).doStream(options)
  }

  async doGenerate(options: LanguageModelV4CallOptions) {
    'use step'
    const model = await getLanguageModel(this.reference.modelId, undefined, this.reference.credentialOwnerId, {
      sessionId: this.reference.sessionId,
      allowLowBalanceFallback: this.reference.allowLowBalanceFallback,
    })
    return wrapLanguageModel({ model, middleware: [] }).doGenerate(options)
  }
}
