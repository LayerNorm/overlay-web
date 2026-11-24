/**
 * Pure helpers behind computer_recording: reading the driver's stop payload and turning it into the short proof-of-work
 * summary the model and the chat show ("3 checks: 2 passed, 1 failed").
 */

export type ComputerRecordingStatus = 'setup' | 'step' | 'pass' | 'fail'

export type ComputerRecordingAnnotation = { t: number; label: string; status: ComputerRecordingStatus }

export type ComputerRecordingStop = {
  id: string
  path: string
  sizeBytes: number
  durationSeconds: number
  title: string
  annotations: ComputerRecordingAnnotation[]
  counts: Record<ComputerRecordingStatus, number>
}

const STATUSES: readonly ComputerRecordingStatus[] = ['setup', 'step', 'pass', 'fail']

export function parseComputerRecordingStop(value: Record<string, unknown>): ComputerRecordingStop | null {
  if (typeof value.id !== 'string' || typeof value.path !== 'string' || typeof value.sizeBytes !== 'number') return null
  const annotations = Array.isArray(value.annotations)
    ? value.annotations.flatMap((entry): ComputerRecordingAnnotation[] => {
        if (!entry || typeof entry !== 'object') return []
        const item = entry as Record<string, unknown>
        if (typeof item.t !== 'number' || typeof item.label !== 'string') return []
        const status = STATUSES.includes(item.status as ComputerRecordingStatus) ? item.status as ComputerRecordingStatus : 'step'
        return [{ t: item.t, label: item.label, status }]
      })
    : []
  const counts = { setup: 0, step: 0, pass: 0, fail: 0 }
  for (const annotation of annotations) counts[annotation.status] += 1
  return {
    id: value.id,
    path: value.path,
    sizeBytes: value.sizeBytes,
    durationSeconds: typeof value.durationSeconds === 'number' ? value.durationSeconds : 0,
    title: typeof value.title === 'string' ? value.title : '',
    annotations,
    counts,
  }
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  return minutes ? `${minutes}m ${String(total % 60).padStart(2, '0')}s` : `${total}s`
}

export function formatComputerRecordingTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** One line for the result: duration plus pass/fail counts, e.g. "1m 05s recording, 3 checks: 2 passed, 1 failed". */
export function summarizeComputerRecording(stop: Pick<ComputerRecordingStop, 'durationSeconds' | 'counts'>) {
  const checks = stop.counts.pass + stop.counts.fail
  const parts = [`${formatDuration(stop.durationSeconds)} recording`]
  if (checks) {
    const outcome = [stop.counts.pass ? `${stop.counts.pass} passed` : '', stop.counts.fail ? `${stop.counts.fail} failed` : ''].filter(Boolean)
    parts.push(`${checks} check${checks === 1 ? '' : 's'}: ${outcome.join(', ')}`)
  } else if (stop.counts.step + stop.counts.setup) {
    const steps = stop.counts.step + stop.counts.setup
    parts.push(`${steps} step${steps === 1 ? '' : 's'}, no pass/fail checks`)
  }
  return parts.join(', ')
}

/** Chapter list for the reply, so the reader can jump to each check. */
export function computerRecordingChapters(annotations: ComputerRecordingAnnotation[]) {
  return annotations.map(annotation => ({
    at: formatComputerRecordingTimestamp(annotation.t),
    seconds: annotation.t,
    status: annotation.status,
    label: annotation.label,
  }))
}

export function computerRecordingFileName(stop: Pick<ComputerRecordingStop, 'id' | 'title'>, name?: string) {
  const base = (name ?? stop.title)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/\.mp4$/i, '')
  return `${base || `Recording ${stop.id}`}.mp4`
}
