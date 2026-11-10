import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { HarnessModelReference } from './secure-model'

export type PreparedHarnessModel = {
  model: HarnessModelReference
  options: LanguageModelV4CallOptions
  contextWindow: number | null
}

export type HarnessModelPurpose = 'response' | 'summary' | 'verification'
