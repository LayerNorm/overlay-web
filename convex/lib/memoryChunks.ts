import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/**
 * Changes who owns a memory's search index, or who can find it, without re-indexing. Re-indexing would skip this:
 * indexing is billed once per owner, source and text, so unchanged text is never rewritten. Patches the memory's chunks
 * and, for a new owner, their embeddings, which vector search selects by owner. Returns how many chunks changed.
 */
export async function retargetMemoryIndex(
  ctx: MutationCtx,
  memoryId: Id<'memories'>,
  patch: { userId?: string; visibility: 'owner' | 'workspace' },
): Promise<number> {
  const chunks = await ctx.db.query('knowledgeChunks')
    .withIndex('by_source', (q) => q.eq('sourceKind', 'memory').eq('sourceId', memoryId))
    .collect()
  for (const chunk of chunks) {
    await ctx.db.patch(chunk._id, patch)
    if (!patch.userId || patch.userId === chunk.userId) continue
    const embeddings = await ctx.db.query('knowledgeChunkEmbeddings')
      .withIndex('by_chunkId', (q) => q.eq('chunkId', chunk._id))
      .collect()
    await Promise.all(embeddings.map((embedding) => ctx.db.patch(embedding._id, { userId: patch.userId! })))
  }
  return chunks.length
}
