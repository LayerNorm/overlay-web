import 'server-only'

import type { LanguageModelV3, LanguageModelV4 } from '@ai-sdk/provider'

export type { LanguageModelV3, LanguageModelV4 } from '@ai-sdk/provider'

/**
 * AI SDK v7 accepts both LanguageModelV3 and LanguageModelV4.
 * Providers may return either depending on their implementation version.
 */
export type LanguageModel = LanguageModelV3 | LanguageModelV4
