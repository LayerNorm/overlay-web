import 'server-only'

import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { HarnessTranscriptPersistence } from '@overlay/agent-runtime/harness-store'
import { HARNESS_CONTROL_TOOLS } from './context'
import { stripTextualToolCalls } from './textual-tool-calls'

export type PublicTranscriptPage = {
  resultSummary?: string | null
  steps: Array<{
    sequence: number
    persistence: HarnessTranscriptPersistence
    fullPersistenceUrl?: string | null
    fullPersistenceDigest?: string
  }>
  nextSequence: number | null
}

export async function readPublicTranscriptStep(step: PublicTranscriptPage['steps'][number], signal: AbortSignal) {
  if (!step.fullPersistenceDigest) {
    if (step.fullPersistenceUrl != null) throw new Error('Full transcript payload digest is unavailable.')
    return { persistence: step.persistence, legacy: true }
  }
  if (!step.fullPersistenceUrl) throw new Error('Full transcript payload is unavailable.')
  const response = await fetch(step.fullPersistenceUrl, { signal, redirect: 'error', cache: 'no-store' })
  if (!response.ok) throw new Error('Full transcript payload could not be read.')
  const bytes = gunzipSync(Buffer.from(await response.arrayBuffer()), { maxOutputLength: 256 * 1024 * 1024 })
  if (createHash('sha256').update(bytes).digest('hex') !== step.fullPersistenceDigest) {
    throw new Error('Full transcript payload integrity check failed.')
  }
  const persistence = JSON.parse(bytes.toString('utf8')) as HarnessTranscriptPersistence
  if (typeof persistence.content !== 'string' || !Array.isArray(persistence.parts)) {
    throw new Error('Invalid full transcript payload.')
  }
  return { persistence, legacy: false }
}

export function createPublicTranscriptStream({ firstPage, loadPage, signal }: {
  firstPage: PublicTranscriptPage
  loadPage: (afterSequence: number) => Promise<PublicTranscriptPage | null>
  signal: AbortSignal
}) {
  const encoder = new TextEncoder()
  const abort = new AbortController()
  const combinedSignal = AbortSignal.any([signal, abort.signal])
  async function* records() {
    let page = firstPage
    let previous = -1
    let legacy = false
    for (;;) {
      for (const step of page.steps) {
        combinedSignal.throwIfAborted()
        if (!Number.isSafeInteger(step.sequence) || step.sequence <= previous) throw new Error('Invalid transcript order.')
        const value = await readPublicTranscriptStep(step, combinedSignal)
        legacy ||= value.legacy
        previous = step.sequence
        yield { type: 'step', sequence: step.sequence, persistence: value.persistence }
      }
      if (page.nextSequence === null) break
      if (page.nextSequence !== previous || !page.steps.length) throw new Error('Invalid transcript cursor.')
      combinedSignal.throwIfAborted()
      const next = await loadPage(page.nextSequence)
      if (!next) throw new Error('Transcript access is no longer available.')
      page = next
    }
    yield { type: 'done', legacy, resultSummary: stripTextualToolCalls(firstPage.resultSummary ?? '', new Set(HARNESS_CONTROL_TOOLS)) }
  }
  const iterator = records()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`))
      } catch (_error) {
        if (!combinedSignal.aborted) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', message: 'Could not load the complete trace.' })}\n`))
          controller.close()
        } else controller.error(new Error('Transcript request cancelled.'))
      }
    },
    cancel() { abort.abort() },
  })
}
