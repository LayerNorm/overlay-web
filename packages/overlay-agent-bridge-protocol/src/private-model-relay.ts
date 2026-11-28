/**
 * Overlay-billed models in private threads (internal/develop/private-threads.md). The agent loop runs in the Agent
 * Host on the person's computer; each model call is sent to Overlay's metered relay, which runs that one call with
 * Overlay's model provider and streams the model's parts back. Overlay charges the workspace for the call and keeps
 * nothing of it: no transcript, no prompt, no reply.
 *
 * The wire format is JSON: the request carries the AI SDK language-model call options, and a streamed response is
 * newline-delimited JSON, one stream part per line. Values JSON cannot carry (bytes, URLs, dates) are tagged.
 */
export const PRIVATE_MODEL_RELAY_VERSION = 1 as const
/** Where the relay lives on an Overlay server. */
export const PRIVATE_MODEL_RELAY_PATH = '/api/private-threads/model'
/** One call's request may be large (a long transcript with screenshots), but not unbounded. */
export const MAX_PRIVATE_MODEL_RELAY_REQUEST_BYTES = 24 * 1024 * 1024

export type PrivateModelRelayRequest = {
  version: typeof PRIVATE_MODEL_RELAY_VERSION
  /** An Overlay catalog model id, for example `anthropic/claude-sonnet-4.6`. */
  modelId: string
  /**
   * `stream` answers with newline-delimited stream parts (`doStream`); `generate` answers with one JSON result
   * (`doGenerate`), used for context summaries.
   */
  mode: 'stream' | 'generate'
  /** The AI SDK call options, without the abort signal; encoded with {@link encodeRelayJson}. */
  options: Record<string, unknown>
}

type Tagged = { $relay: 'bytes'; base64: string } | { $relay: 'url'; href: string } | { $relay: 'date'; iso: string }

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** JSON with bytes, URLs and dates kept. Functions, signals and `undefined` are dropped, as in plain JSON. */
export function encodeRelayJson(value: unknown): string {
  return JSON.stringify(toWire(value))
}

export function decodeRelayJson<T = unknown>(text: string): T {
  return fromWire(JSON.parse(text)) as T
}

function toWire(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $relay: 'bytes', base64: bytesToBase64(value) } satisfies Tagged
  if (value instanceof ArrayBuffer) return { $relay: 'bytes', base64: bytesToBase64(new Uint8Array(value)) } satisfies Tagged
  if (value instanceof URL) return { $relay: 'url', href: value.href } satisfies Tagged
  if (value instanceof Date) return { $relay: 'date', iso: value.toISOString() } satisfies Tagged
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (Array.isArray(value)) return value.map((item) => toWire(item) ?? null)
  if (value && typeof value === 'object') {
    if (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal) return undefined
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const wire = toWire(item)
      if (wire !== undefined) out[key] = wire
    }
    return out
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined
  return value
}

function fromWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromWire)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.$relay === 'bytes' && typeof record.base64 === 'string') return base64ToBytes(record.base64)
    if (record.$relay === 'url' && typeof record.href === 'string') return new URL(record.href)
    if (record.$relay === 'date' && typeof record.iso === 'string') return new Date(record.iso)
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(record)) out[key] = fromWire(item)
    return out
  }
  return value
}

/** The relay's error line, and the shape of its JSON error responses. */
export type PrivateModelRelayError = { type: 'error'; error: { message: string; code?: string } }
