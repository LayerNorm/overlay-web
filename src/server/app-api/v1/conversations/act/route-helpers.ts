import type { UIMessage } from '@/server/ai/sdk'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'

export const DEFAULT_ACT_ABORT_TIMEOUT_MS = 290_000
export const AUTOMATION_ACT_ABORT_TIMEOUT_MS = 720_000
export const MIN_ACT_ABORT_TIMEOUT_MS = 30_000
export const MAX_ACT_ABORT_TIMEOUT_MS = 780_000
export const MAX_ACT_OUTPUT_TOKENS_PER_STEP = 8_192

export function estimateToolLoopReservationTokens(args: {
  estimatedInputTokens: number
  maxOutputTokensPerStep: number
  maxSteps: number
}): { estimatedInputTokens: number; maxOutputTokens: number } {
  const maxSteps = Math.max(1, Math.floor(args.maxSteps))
  return {
    estimatedInputTokens: Math.max(0, Math.ceil(args.estimatedInputTokens)) * maxSteps,
    maxOutputTokens: Math.max(0, Math.ceil(args.maxOutputTokensPerStep)) * maxSteps,
  }
}

export function summarizeToolOutputForLog(output: unknown): string {
  if (output == null) return 'null/undefined'
  if (typeof output === 'string') return `string length=${output.length}`
  if (typeof output === 'object') {
    const keys = Object.keys(output as object)
    return `object keys=[${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ', …' : ''}]`
  }
  return typeof output
}

export function resolveActAbortTimeoutMs(params: {
  requestedTimeoutMs?: number
  automationExecution?: boolean
}): number {
  const fallback = params.automationExecution
    ? AUTOMATION_ACT_ABORT_TIMEOUT_MS
    : DEFAULT_ACT_ABORT_TIMEOUT_MS
  if (!Number.isFinite(params.requestedTimeoutMs)) return fallback
  return Math.min(
    MAX_ACT_ABORT_TIMEOUT_MS,
    Math.max(MIN_ACT_ABORT_TIMEOUT_MS, Math.floor(params.requestedTimeoutMs!)),
  )
}

export function messagesRequireVision(messages: UIMessage[]): boolean {
  return messages.some((message) =>
    (message.parts ?? []).some((part) => {
      if (part.type !== 'file') return false
      const mediaType = 'mediaType' in part ? part.mediaType : undefined
      return typeof mediaType === 'string' && mediaType.startsWith('image/')
    }),
  )
}

export async function drainReadableStream(stream: ReadableStream<Uint8Array<ArrayBufferLike>>) {
  const reader = stream.getReader()
  try {
    while (!(await reader.read()).done) {
      // Drain the stream so the upstream model generation continues after disconnect.
    }
  } finally {
    reader.releaseLock()
  }
}

export function observeFirstTextToken(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>>,
  onFirstToken: () => void,
): ReadableStream<Uint8Array<ArrayBufferLike>> {
  const decoder = new TextDecoder()
  let buffer = ''
  let observed = false
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (!observed) {
        buffer += decoder.decode(chunk, { stream: true })
        if (/"type"\s*:\s*"text(?:-delta)?"/.test(buffer)) {
          observed = true
          buffer = ''
          onFirstToken()
        } else if (buffer.length > 8_192) {
          buffer = buffer.slice(-1_024)
        }
      }
      controller.enqueue(chunk)
    },
  }))
}

export function resolveEffectiveActModelId(modelId?: string): string {
  return modelId?.trim() || DEFAULT_MODEL_ID
}

export function resolveActTurnId(turnId: string | undefined, now = Date.now()): string {
  return turnId?.trim() || `act-${now}`
}
