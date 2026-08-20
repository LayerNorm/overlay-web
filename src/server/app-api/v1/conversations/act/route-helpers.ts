import type { NextResponse } from 'next/server'
import type { UIMessage } from '@/server/ai/sdk'
import { getChatModelDisplayName } from '@/shared/ai/gateway/model-data'
import {
  FREE_TIER_DEFAULT_MODEL_ID,
  isLegacyFreeTierDefaultModelId,
} from '@/shared/ai/gateway/model-types'
import { parseActStreamIdempotencyKey } from '@/shared/api/act-idempotency'

export const DEFAULT_ACT_ABORT_TIMEOUT_MS = 290_000
export const AUTOMATION_ACT_ABORT_TIMEOUT_MS = 720_000
export const MIN_ACT_ABORT_TIMEOUT_MS = 30_000
export const MAX_ACT_ABORT_TIMEOUT_MS = 780_000
export const MAX_ACT_MODEL_ATTEMPTS = 5

export type ActModelAttemptFailureReason = 'budget' | 'pricing' | 'provider' | 'reservation'

export type ActModelAttemptFailure = {
  modelId: string
  reason: ActModelAttemptFailureReason
}

export type ActAttemptReservationResult<TResponse> =
  | { ok: true }
  | { ok: false; reason: ActModelAttemptFailureReason; response: TResponse }

export interface ActMultiModelState {
  isMultiModelFollowUpSlot: boolean
  multiModelSlotIndex: number
  multiModelTotal: number
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

export function fallbackNoticeText(
  fromAttempts: string | ActModelAttemptFailure[],
  toModelId: string,
): string {
  const attempts = typeof fromAttempts === 'string'
    ? [{ modelId: fromAttempts, reason: 'provider' as const }]
    : fromAttempts
  const names = formatModelNameList(attempts.map((attempt) => attempt.modelId))
  const target = getChatModelDisplayName(toModelId)
  if (attempts.length > 0 && attempts.every((attempt) => attempt.reason === 'budget')) {
    return `${names} exceeded remaining budget, switching to ${target}.`
  }
  if (attempts.length > 0 && attempts.every((attempt) => attempt.reason === 'provider')) {
    return `${names} unavailable, switching to ${target}.`
  }
  return `${names} could not be used, switching to ${target}.`
}

export function prefixFallbackNoticeAfterStart(
  body: ReadableStream<Uint8Array<ArrayBufferLike>> | null,
  notice?: string,
): ReadableStream<Uint8Array<ArrayBufferLike>> | null {
  if (!body || !notice) return body
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let inserted = false

  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (inserted) {
        controller.enqueue(chunk)
        return
      }
      buffer += decoder.decode(chunk, { stream: true })
      const firstFrameEnd = buffer.indexOf('\n\n')
      if (firstFrameEnd === -1) return
      const firstFrame = buffer.slice(0, firstFrameEnd + 2)
      const rest = buffer.slice(firstFrameEnd + 2)
      buffer = ''
      inserted = true
      controller.enqueue(encoder.encode(firstFrame))
      controller.enqueue(encoder.encode(fallbackNoticeFrames(notice)))
      if (rest) controller.enqueue(encoder.encode(rest))
    },
    flush(controller) {
      if (!inserted && buffer) {
        controller.enqueue(encoder.encode(fallbackNoticeFrames(notice)))
        controller.enqueue(encoder.encode(buffer))
      }
    },
  })) as ReadableStream<Uint8Array<ArrayBufferLike>>
}

export function resolveEffectiveActModelId(modelId?: string): string {
  const requestedModelId = modelId || 'claude-sonnet-4-6'
  return isLegacyFreeTierDefaultModelId(requestedModelId)
    ? FREE_TIER_DEFAULT_MODEL_ID
    : requestedModelId
}

export function resolveActMultiModelState(params: {
  rawMultiModelSlotIndex?: number
  rawMultiModelTotal?: number
  idempotencyKey?: string | null
}): ActMultiModelState {
  const parsedKey = params.idempotencyKey
    ? parseActStreamIdempotencyKey(params.idempotencyKey)
    : null
  const slotFromBody =
    typeof params.rawMultiModelSlotIndex === 'number' && params.rawMultiModelSlotIndex >= 0
      ? Math.min(3, Math.floor(params.rawMultiModelSlotIndex))
      : undefined
  const slotFromKey = parsedKey && Number.isFinite(parsedKey.slotIndex)
    ? Math.min(3, parsedKey.slotIndex)
    : undefined
  const multiModelSlotIndex = slotFromBody ?? slotFromKey ?? 0
  const totalFromBody =
    typeof params.rawMultiModelTotal === 'number' && params.rawMultiModelTotal > 0
      ? Math.min(4, Math.floor(params.rawMultiModelTotal))
      : undefined
  const multiModelTotal = Math.min(4, Math.max(totalFromBody ?? 1, multiModelSlotIndex + 1))

  return {
    multiModelTotal,
    multiModelSlotIndex,
    isMultiModelFollowUpSlot: multiModelTotal > 1 && multiModelSlotIndex > 0,
  }
}

export function resolveActTurnId(turnId: string | undefined, now = Date.now()): string {
  return turnId?.trim() || `act-${now}`
}

export async function runActModelAttempts<TResponse = NextResponse>(params: {
  attemptModelIds: string[]
  onAttemptFailure(error: unknown, modelId: string, hasFallback: boolean): Promise<void> | void
  onFallback(previousModelId: string, attemptModelId: string, failedAttempts: ActModelAttemptFailure[]): void
  reserveBudgetForAttempt(attemptModelId: string): Promise<ActAttemptReservationResult<TResponse>>
  runAttempt(args: { attemptModelId: string; fallbackNotice?: string }): Promise<TResponse>
}): Promise<TResponse> {
  let lastAttemptError: unknown
  let lastAttemptResponse: TResponse | null = null
  const failedAttempts: ActModelAttemptFailure[] = []

  for (let attemptIndex = 0; attemptIndex < params.attemptModelIds.length; attemptIndex++) {
    const attemptModelId = params.attemptModelIds[attemptIndex]!
    const fallbackNotice = failedAttempts.length > 0
      ? fallbackNoticeText(failedAttempts, attemptModelId)
      : undefined
    try {
      const reservationResponse = await params.reserveBudgetForAttempt(attemptModelId)
      if (!reservationResponse.ok) {
        failedAttempts.push({ modelId: attemptModelId, reason: reservationResponse.reason })
        lastAttemptResponse = reservationResponse.response
        continue
      }
      const previousModelId = failedAttempts.at(-1)?.modelId
      if (previousModelId) params.onFallback(previousModelId, attemptModelId, [...failedAttempts])
      return await params.runAttempt({ attemptModelId, fallbackNotice })
    } catch (error) {
      lastAttemptError = error
      failedAttempts.push({ modelId: attemptModelId, reason: 'provider' })
      await params.onAttemptFailure(
        error,
        attemptModelId,
        attemptIndex < params.attemptModelIds.length - 1,
      )
    }
  }

  if (lastAttemptResponse) return lastAttemptResponse
  throw lastAttemptError ?? new Error('All model attempts failed')
}

function uiStreamEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function formatModelNameList(modelIds: string[]): string {
  const names = modelIds.map(getChatModelDisplayName)
  if (names.length <= 1) return names[0] ?? 'Selected model'
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`
}

function fallbackNoticeFrames(notice: string): string {
  const id = `fallback-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  return (
    uiStreamEvent({ type: 'text-start', id }) +
    uiStreamEvent({ type: 'text-delta', id, delta: `${notice}\n\n` }) +
    uiStreamEvent({ type: 'text-end', id })
  )
}
