import 'server-only'

import { createHash } from 'node:crypto'
import { chunkKnowledgeText } from '@/shared/knowledge/chunking'
import type { EmbeddingProvider } from './EmbeddingProvider'
import { PostgresKnowledgeIndexRepository } from './PostgresKnowledgeIndexRepository'

export class KnowledgeIndexService {
  constructor(private readonly deps: {
    embeddings: EmbeddingProvider
    repository: PostgresKnowledgeIndexRepository
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
      const vectors = await this.deps.embeddings.embed(textChunks.map((chunk) => chunk.text))
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
