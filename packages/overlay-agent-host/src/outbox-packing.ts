import {
  MAX_EVENT_BATCH_BYTES,
  MAX_EVENTS_PER_BATCH,
  OVERLAY_AGENT_PROTOCOL_VERSION,
  type AgentHostEvent,
  type EventBatch,
} from '@layernorm/overlay-agent-bridge-protocol'

/** Room left under the protocol's batch limit for the envelope and encoding differences. */
export const EVENT_BATCH_HEADROOM_BYTES = 8 * 1024
export const EVENT_BATCH_BUDGET_BYTES = MAX_EVENT_BATCH_BYTES - EVENT_BATCH_HEADROOM_BYTES

/** Appended to a checkpoint whose text alone could not fit in one upload. Phase 2 text deltas remove this case. */
export const TRUNCATED_TEXT_MARKER = '\n\n[Output shortened in transit: this reply is longer than one upload allows.]'

const encoder = new TextEncoder()
const byteLength = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength

/**
 * Picks the longest prefix of `events` that fits one upload. Batches used to be a fixed 100 events: once text
 * checkpoints (each the whole reply so far) reached a few KB, 100 of them broke the 512 KB limit, the batch failed
 * validation, and the host retried the same batch forever. Packing by bytes means a batch always fits; `oversized`
 * is the first event when even it alone does not, so the caller can shrink it.
 */
export function packEventBatch(environmentId: string, events: AgentHostEvent[], budget = EVENT_BATCH_BUDGET_BYTES):
  { batch?: EventBatch; oversized?: AgentHostEvent } {
  if (events.length === 0) return {}
  const envelope = { protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, environmentId, runId: events[0]!.runId, events: [] as AgentHostEvent[] }
  let size = byteLength(envelope)
  for (const event of events.slice(0, MAX_EVENTS_PER_BATCH)) {
    const added = byteLength(event) + (envelope.events.length > 0 ? 1 : 0)
    if (size + added > budget) break
    envelope.events.push(event)
    size += added
  }
  if (envelope.events.length === 0) return { oversized: events[0] }
  return { batch: envelope as EventBatch }
}

/**
 * Shrinks a text checkpoint that cannot fit in any batch: keep as much of the start of the reply as fits, then a
 * visible marker. Returns undefined for other event types (their payloads are already bounded by the schema).
 */
export function shrinkOversizedEvent(event: AgentHostEvent, budget = EVENT_BATCH_BUDGET_BYTES): AgentHostEvent | undefined {
  if (event.type !== 'text_checkpoint') return undefined
  const text = event.payload.text
  const fits = (length: number) => byteLength({ ...event, payload: { ...event.payload, text: `${text.slice(0, length)}${TRUNCATED_TEXT_MARKER}` } }) + 512 <= budget
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(middle)) low = middle
    else high = middle - 1
  }
  return { ...event, payload: { ...event.payload, text: `${text.slice(0, low)}${TRUNCATED_TEXT_MARKER}` } }
}
