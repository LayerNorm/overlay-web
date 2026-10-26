import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@workflow/serde'
import { gateway } from 'ai'

export class SecureSmokeModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const
  readonly provider = 'overlay-smoke'
  readonly supportedUrls = {}

  constructor(readonly modelId: string) {}

  static [WORKFLOW_SERIALIZE](model: SecureSmokeModel) {
    return { modelId: model.modelId }
  }

  static [WORKFLOW_DESERIALIZE](reference: { modelId: string }) {
    return new SecureSmokeModel(reference.modelId)
  }

  async doStream(options: LanguageModelV4CallOptions) {
    'use step'
    return gateway(this.modelId).doStream(options)
  }

  async doGenerate(options: LanguageModelV4CallOptions) {
    'use step'
    return gateway(this.modelId).doGenerate(options)
  }
}
