import 'server-only'

import type { UIMessageChunk } from 'ai'

/**
 * Attaches message metadata to a UI message stream that has none.
 *
 * `toUIMessageStream` takes a `messageMetadata` callback, but a stream built by
 * `createModelCallToUIChunkTransform` — which is how Work mode reaches the
 * client — carries only the raw model call. Without this, metadata-driven UI
 * such as source citations simply never arrives for a Work turn, even though
 * the citations were resolved before the turn started.
 *
 * Metadata rides both the `start` and `finish` chunks, matching the chat path:
 * sending it early is what lets the client linkify sources while the reply is
 * still streaming rather than only once it lands.
 */
export function createUiMessageMetadataTransform(
  metadata: Record<string, unknown> | undefined,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  const hasMetadata = Boolean(metadata && Object.keys(metadata).length > 0)
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (!hasMetadata || (chunk.type !== 'start' && chunk.type !== 'finish')) {
        controller.enqueue(chunk)
        return
      }
      controller.enqueue({
        ...chunk,
        // Anything the producer already set wins: this fills a gap rather than
        // overriding a decision made further upstream.
        messageMetadata: { ...metadata, ...(chunk.messageMetadata ?? {}) },
      })
    },
  })
}
