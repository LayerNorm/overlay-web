import type { EmitAgentEvent } from './adapter.js'
import { coalesceTextCheckpoints } from './text-coalescer.js'

const ANCHOR_INTERVAL_BYTES = 64 * 1024
const DELTA_CHARS = 16 * 1024

function codePointBoundary(text: string, offset: number): number {
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff ? offset - 1 : offset
}

/** One run's ordered text and liveness; legacy servers keep receiving coalesced checkpoints. */
export function createRunStream(emit: EmitAgentEvent, options: {
  streaming: () => boolean
  active?: () => boolean
  observe: () => Promise<'live' | 'lost' | 'unknown'>
  onError: (error: unknown) => void
  heartbeatMs?: number
  now?: () => number
}) {
  const now = options.now ?? Date.now
  let lastActivityAt = now()
  let previousText = ''
  let bytesSinceAnchor = 0
  let terminal = false
  let heartbeatBusy = false
  const openTools = new Map<string, { title: string; startedAt: number }>()
  const encoder = new TextEncoder()

  const forward: EmitAgentEvent = async event => {
    lastActivityAt = now()
    if (event.type === 'action') {
      if (event.payload.status === 'completed' || event.payload.status === 'failed') openTools.delete(event.payload.actionId)
      else if (!openTools.has(event.payload.actionId)) openTools.set(event.payload.actionId, { title: event.payload.title, startedAt: now() })
    }
    if (['completed', 'failed', 'cancelled'].includes(event.type)) { terminal = true; clearInterval(timer); openTools.clear(); previousText = '' }
    if (event.type !== 'text_checkpoint' || !options.streaming()) { await emit(event); return }
    const text = event.payload.text
    let startOffset = previousText.length
    if (!text.startsWith(previousText)) {
      startOffset = 0
      while (startOffset < Math.min(text.length, previousText.length) && text[startOffset] === previousText[startOffset]) startOffset++
      startOffset = codePointBoundary(text, startOffset)
      // Trim only the corrected suffix, then resend it in bounded deltas even for a very large rewrite.
      await emit({ type: 'text_checkpoint', payload: { offset: startOffset, text: '' } })
      bytesSinceAnchor = 0
    }
    for (let offset = startOffset; offset < text.length;) {
      const end = codePointBoundary(text, Math.min(text.length, offset + DELTA_CHARS))
      const delta = text.slice(offset, end)
      await emit({ type: 'text_delta', payload: { offset, text: delta } })
      bytesSinceAnchor += encoder.encode(delta).byteLength
      offset = end
    }
    previousText = text
    if (bytesSinceAnchor >= ANCHOR_INTERVAL_BYTES) {
      // Bounded anchors keep working after the entire answer exceeds the upload limit.
      const target = Math.max(0, text.length - DELTA_CHARS)
      const boundary = codePointBoundary(text, target)
      const offset = boundary < target ? boundary + 2 : boundary
      await emit({ type: 'text_checkpoint', payload: { offset, text: text.slice(offset), ...(event.payload.final ? { final: true } : {}) } })
      bytesSinceAnchor = 0
    }
  }
  const heartbeat = async () => {
    if (terminal || heartbeatBusy || !options.streaming() || options.active?.() === false) return
    heartbeatBusy = true
    try {
      const process = await options.observe()
      if (terminal) return
      const quietMs = Math.max(0, now() - lastActivityAt)
      await emit({ type: 'heartbeat', payload: { quietMs, process,
        openTools: [...openTools].slice(-20).map(([actionId, tool]) => ({ actionId, title: tool.title, runningMs: Math.max(0, now() - tool.startedAt) })),
        // Long tools are expected. Quiet output alone is never proof of a stall.
        stalled: quietMs >= 90_000 && process !== 'live',
      } })
    } finally { heartbeatBusy = false }
  }
  const timer = setInterval(() => { void heartbeat().catch(options.onError) }, options.heartbeatMs ?? 10_000)
  timer.unref?.()
  const coalesced = coalesceTextCheckpoints(forward)
  return { emit: coalesced, heartbeat, stop() { terminal = true; clearInterval(timer); openTools.clear(); previousText = '' } }
}
