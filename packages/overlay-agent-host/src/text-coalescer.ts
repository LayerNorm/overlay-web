import type { EmitAgentEvent, NormalizedAgentEvent } from './adapter.js'

export const TEXT_FLUSH_INTERVAL_MS = 250
export const TEXT_FLUSH_BYTES = 2 * 1024

type TextCheckpoint = Extract<NormalizedAgentEvent, { type: 'text_checkpoint' }>

/**
 * Thins an adapter's text checkpoints before they are recorded. Adapters report the whole reply so far on every
 * streamed token; recording each one multiplied upload size by the number of tokens. Only the newest checkpoint
 * matters, so this holds it back and records it at most every 250 ms, after 2,048 new bytes, when it is
 * final, and always before any other event, so a tool row never lands ahead of the words written before it.
 */
export function coalesceTextCheckpoints(
  emit: EmitAgentEvent,
  options: { intervalMs?: number; flushBytes?: number } = {},
): EmitAgentEvent & { flush(): Promise<void> } {
  let pending: TextCheckpoint | undefined
  let recordedLength = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  // Every record goes through one chain, so events keep the order the adapter produced them in.
  let chain: Promise<void> = Promise.resolve()

  const enqueue = (work: () => Promise<void>) => {
    const next = chain.then(work)
    chain = next.catch(() => undefined)
    return next
  }
  const takePending = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const event = pending
    pending = undefined
    if (event) recordedLength = event.payload.text.length
    return event
  }
  const flush = () => {
    const event = takePending()
    return enqueue(async () => { if (event) await emit(event) })
  }

  const coalesced = async (event: NormalizedAgentEvent) => {
    if (event.type !== 'text_checkpoint') {
      const text = takePending()
      return enqueue(async () => {
        if (text) await emit(text)
        await emit(event)
      })
    }
    // A shorter text starts a new reply (a new turn): record it without comparing against the old one.
    if (event.payload.text.length < recordedLength) recordedLength = 0
    pending = event
    if (event.payload.final || new TextEncoder().encode(event.payload.text.slice(recordedLength)).byteLength >= (options.flushBytes ?? TEXT_FLUSH_BYTES)) return flush()
    timer ??= setTimeout(() => { void flush().catch(() => undefined) }, options.intervalMs ?? TEXT_FLUSH_INTERVAL_MS)
    timer.unref?.()
  }
  return Object.assign(coalesced, { flush })
}
