import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createAzure } from '@ai-sdk/azure'
import { embedMany, type EmbeddingModel } from 'ai'

export type CloudEmbeddingSettings =
  | {
      provider: 'azure-openai'
      apiKey: string
      resourceName?: string
      baseURL?: string
      apiVersion?: string
      deployment: string
    }
  | {
      provider: 'bedrock'
      region: string
      modelId: string
    }

export async function embedWithCloudProvider(
  settings: CloudEmbeddingSettings,
  texts: string[],
  options: {
    expectedDimensions: number
    abortSignal?: AbortSignal
    fetch?: typeof fetch
  },
): Promise<{ vectors: number[][]; promptTokens: number }> {
  if (texts.length === 0) return { vectors: [], promptTokens: 0 }

  let model: EmbeddingModel
  let providerOptions: { openai: { dimensions: number } } | undefined

  if (settings.provider === 'azure-openai') {
    model = createAzure({
      apiKey: settings.apiKey,
      resourceName: settings.resourceName,
      baseURL: settings.baseURL,
      apiVersion: settings.apiVersion,
      fetch: options.fetch,
    }).embedding(settings.deployment)
    providerOptions = { openai: { dimensions: options.expectedDimensions } }
  } else {
    model = createAmazonBedrock({
      region: settings.region,
      fetch: options.fetch,
    }).embedding(settings.modelId)
  }

  const result = await embedMany({
    model,
    values: texts,
    providerOptions,
    abortSignal: options.abortSignal,
  })
  const vectors = result.embeddings
  for (const vector of vectors) {
    if (vector.length !== options.expectedDimensions) {
      throw new Error(`Expected ${options.expectedDimensions} dims, got ${vector.length}`)
    }
  }

  return { vectors, promptTokens: result.usage.tokens }
}
