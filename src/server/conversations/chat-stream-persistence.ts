import 'server-only'

import type { StreamTextTransform, ToolSet } from '@/server/ai/sdk'

const DEFAULT_FLUSH_INTERVAL_MS = 200

export function createPersistedTextDeltaTransform(args: {
  appendTextDelta: (textDelta: string) => Promise<boolean>
  flushIntervalMs?: number
}): StreamTextTransform<ToolSet> {
  return ({ stopStream }) => {
    let bufferedText = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = Promise.resolve()

    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      if (!bufferedText) return pending
      const textDelta = bufferedText
      bufferedText = ''
      pending = pending.then(async () => {
        const active = await args.appendTextDelta(textDelta)
        if (!active) stopStream()
      })
      return pending
    }

    const scheduleFlush = () => {
      if (timer) return
      timer = setTimeout(() => {
        void flush()
      }, args.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS)
    }

    return new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk)
        if (chunk.type !== 'text-delta' || !chunk.text) return
        bufferedText += chunk.text
        scheduleFlush()
      },
      async flush() {
        await flush()
      },
    })
  }
}
