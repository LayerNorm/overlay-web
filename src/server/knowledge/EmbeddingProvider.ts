import 'server-only'

import type { OverlayRuntimeConfig } from '@/shared/config'

export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536

export type EmbeddingModelIdentity = {
  dimensions: number
  modelId: string
  modelVersion: string
  provider: 'ai-gateway' | 'openai'
}

export interface EmbeddingProvider {
  readonly identity: EmbeddingModelIdentity
  embed(texts: string[]): Promise<number[][]>
}

export function createEmbeddingProvider(config: OverlayRuntimeConfig): EmbeddingProvider {
  const provider = config.providers.embeddings?.provider ?? 'ai-gateway'
  const modelVersion = process.env.OVERLAY_EMBEDDING_MODEL_VERSION?.trim() || 'text-embedding-3-small-v1'
  if (provider === 'ai-gateway') {
    return new HttpEmbeddingProvider({
      apiKeyEnv: 'AI_GATEWAY_API_KEY',
      endpoint: process.env.AI_GATEWAY_EMBED_URL?.trim() || 'https://ai-gateway.vercel.sh/v1/embeddings',
      identity: {
        dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
        modelId: 'openai/text-embedding-3-small',
        modelVersion,
        provider,
      },
    })
  }
  if (provider === 'openai') {
    return new HttpEmbeddingProvider({
      apiKeyEnv: 'OPENAI_API_KEY',
      endpoint: process.env.OPENAI_EMBED_URL?.trim() || 'https://api.openai.com/v1/embeddings',
      identity: {
        dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
        modelId: 'text-embedding-3-small',
        modelVersion,
        provider,
      },
    })
  }
  throw new Error(`Unsupported embeddings provider for Postgres knowledge: ${provider}`)
}

class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly identity: EmbeddingModelIdentity

  constructor(private readonly options: {
    apiKeyEnv: string
    endpoint: string
    identity: EmbeddingModelIdentity
  }) {
    this.identity = options.identity
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const key = process.env[this.options.apiKeyEnv]?.trim()
    if (!key) throw new Error(`${this.options.apiKeyEnv} is required for knowledge embeddings`)
    const response = await fetch(this.options.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: texts.length === 1 ? texts[0] : texts,
        model: this.identity.modelId,
        ...(this.identity.provider === 'ai-gateway'
          ? { providerOptions: { gateway: { zeroDataRetention: true } } }
          : {}),
      }),
    })
    if (!response.ok) {
      throw new Error(`Embeddings HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
    }
    const body = await response.json() as { data?: Array<{ embedding?: number[]; index?: number }> }
    const vectors = [...(body.data ?? [])]
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
      .map((row) => row.embedding ?? [])
    if (vectors.length !== texts.length) {
      throw new Error(`Embeddings response returned ${vectors.length} vectors for ${texts.length} inputs`)
    }
    for (const vector of vectors) {
      if (vector.length !== this.identity.dimensions || vector.some((value) => !Number.isFinite(value))) {
        throw new Error(`Embeddings response did not contain valid ${this.identity.dimensions}-dimension vectors`)
      }
    }
    return vectors
  }
}
