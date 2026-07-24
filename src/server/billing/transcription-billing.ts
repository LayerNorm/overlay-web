import 'server-only'

// Groq's public on-demand price for whisper-large-v3-turbo is $0.04/hour and
// each request has a 10-second billing minimum. Keep this server-owned and
// review it when provider pricing changes.
export const GROQ_WHISPER_TURBO_USD_PER_HOUR = 0.04
export const GROQ_TRANSCRIPTION_MINIMUM_BILLABLE_SECONDS = 10
export const MAX_RESERVED_TRANSCRIPTION_SECONDS = 24 * 60 * 60

export type GroqVerboseTranscription = {
  duration?: unknown
  segments?: unknown
  text?: unknown
}

export function trustedTranscriptionDurationSeconds(value: GroqVerboseTranscription): number | null {
  if (typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 0) {
    return value.duration
  }
  if (!Array.isArray(value.segments)) return null
  let maximumEnd = 0
  let found = false
  for (const segment of value.segments) {
    if (!segment || typeof segment !== 'object') continue
    const end = (segment as { end?: unknown }).end
    if (typeof end !== 'number' || !Number.isFinite(end) || end < 0) continue
    maximumEnd = Math.max(maximumEnd, end)
    found = true
  }
  return found ? maximumEnd : null
}

export function transcriptionProviderCostUsd(durationSeconds: number): number {
  const billableSeconds = Math.max(
    GROQ_TRANSCRIPTION_MINIMUM_BILLABLE_SECONDS,
    Math.max(0, durationSeconds),
  )
  return (billableSeconds / 3600) * GROQ_WHISPER_TURBO_USD_PER_HOUR
}

