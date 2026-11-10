import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { HarnessModelReference } from './secure-model'

export type PreparedHarnessModel = {
  model: HarnessModelReference
  options: LanguageModelV4CallOptions
  contextWindow: number | null
}

export type HarnessModelPurpose = 'response' | 'summary' | 'verification'

/** Output tokens per call when neither the request nor the catalog names a maximum. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 32_000
