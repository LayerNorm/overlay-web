import 'server-only'

import { createHash } from 'node:crypto'
import { chunkKnowledgeText } from '@/shared/knowledge/chunking'
import type { EmbeddingProvider } from './EmbeddingProvider'
import { PostgresKnowledgeIndexRepository } from './PostgresKnowledgeIndexRepository'
import { calculateEmbeddingModelCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import {
  providerRequestFingerprint,
  ServerProviderUsageMeter,
} from '@/server/billing/ServerProviderUsageMeter'

export class KnowledgeIndexService {
  constructor(private readonly deps: {
    embeddings: EmbeddingProvider
    repository: PostgresKnowledgeIndexRepository
    usageMeter?: ServerProviderUsageMeter
  }) {}

  async reindex(args: {
    expectedContentHash?: string
    sourceId: string
    sourceKind: 'file' | 'memory'
    userId: string
  }): Promise<{ chunks: number; skipped?: 'deleted' | 'stale' }> {
    const source = await this.deps.repository.getSource(args)
    if (!source) {
      await this.deps.repository.purgeSource(args)
      return { chunks: 0, skipped: 'deleted' }
    }
    if (args.expectedContentHash && source.contentHash !== args.expectedContentHash) {
      return { chunks: 0, skipped: 'stale' }
    }

    const textChunks = chunkKnowledgeText(source.content)
    try {
      const texts = textChunks.map((chunk) => chunk.text)
      const estimatedInputTokens = Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / 4)
      const pricingModelId = normalizeEmbeddingPricingModelId(this.deps.embeddings.identity.modelId)
      const providerCostUsd = await calculateEmbeddingModelCostOrNull(pricingModelId, estimatedInputTokens)
      if (providerCostUsd === null) throw new Error(`pricing_missing:${pricingModelId}`)
      const embed = () => this.deps.embeddings.embed(texts)
      const vectors = this.deps.usageMeter
        ? await this.deps.usageMeter.run({
            execute: embed,
            kind: 'embedding',
            modelId: pricingModelId,
            operationId: `knowledge.reindex-${args.sourceKind}:${args.sourceId}`,
            providerCostUsd,
            requestFingerprint: providerRequestFingerprint({
              contentHash: source.contentHash,
              model: this.deps.embeddings.identity,
            }),
            usageEvent: { inputTokens: estimatedInputTokens },
            userId: args.userId,
            workspaceId: source.workspaceId,
            programmaticSubjectId: `knowledge-index:${args.sourceKind}:${args.sourceId}`,
          })
        : await embed()
      await this.deps.repository.replaceSource({
        chunks: textChunks.map((chunk, index) => ({
          ...chunk,
          contentHash: createHash('sha256').update(chunk.text).digest('hex'),
          embedding: vectors[index]!,
        })),
        identity: this.deps.embeddings.identity,
        source,
      })
      return { chunks: textChunks.length }
    } catch (error) {
      await this.deps.repository.markFailed(source, error instanceof Error ? error.message : String(error))
      throw error
    }
  }
}

function normalizeEmbeddingPricingModelId(modelId: string): string {
  return modelId.includes('/') ? modelId : `openai/${modelId}`
}
