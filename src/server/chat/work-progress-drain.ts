import 'server-only'

import type { UIMessageChunk } from 'ai'
import { logger } from '@/server/observability/logger'

/** A publish costs a write, so text accumulates until one of these trips. */
export const WORK_PROGRESS_FLUSH_INTERVAL_MS = 400
export const WORK_PROGRESS_FLUSH_CHARS = 300

function textDelta(chunk: UIMessageChunk): string {
  if (chunk.type !== 'text-delta') return ''
  const part = chunk as { delta?: unknown; text?: unknown }
  if (typeof part.delta === 'string') return part.delta
  return typeof part.text === 'string' ? part.text : ''
}

/**
 * Publishes a Work turn's text into its assistant row as it streams.
 *
 * The workflow itself can only persist at model-step boundaries — that is the
 * coarsest hook the agent loop offers and the only one deterministic enough to
 * be a step. This adds the finer grain on top by reading the same stream the
 * browser is reading, so a reader who reloads sees the reply mid-sentence
 * rather than only as far as the last completed step.
 *
 * Deliberately best effort. It lives in the request, so it stops when the
 * request does; the workflow keeps running either way, the step-boundary writes
 * remain the durable floor, and completion is authoritative. Losing this costs
 * granularity, never the reply.
 */
export async function drainWorkProgress(
  chunks: ReadableStream<UIMessageChunk>,
  options: {
    now?: () => number
    /** Writes the whole reply so far. Absolute, never a fragment to append. */
    publish: (content: string) => Promise<void>
    runId: string
  },
): Promise<void> {
  const now = options.now ?? Date.now
  const reader = chunks.getReader()
  let accumulated = ''
  let published = ''
  let lastFlushAt = now()

  const flush = async () => {
    if (accumulated === published) return
    published = accumulated
    // Absolute content, so a write that races the workflow's own step-boundary
    // write converges instead of doubling the reply.
    await options.publish(published)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      accumulated += textDelta(value)
      const due = accumulated.length - published.length >= WORK_PROGRESS_FLUSH_CHARS
        || (accumulated !== published && now() - lastFlushAt >= WORK_PROGRESS_FLUSH_INTERVAL_MS)
      if (!due) continue
      lastFlushAt = now()
      await flush()
    }
    await flush()
  } catch (error) {
    logger.warn('[conversations/act] Work progress drain ended early', {
      error: error instanceof Error ? error.message : String(error),
      runId: options.runId,
    })
  } finally {
    reader.releaseLock()
  }
}
