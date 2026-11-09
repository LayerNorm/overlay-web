import type { NotebookAgentStreamEvent } from '@overlay/app-core'
import type { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import { readPublicTranscriptStep } from '@/server/harness/public-transcript'
import {
  parseNotebookCursor,
  projectNotebookTerminal,
  projectNotebookTranscriptStep,
} from '@/server/notebook/notebook-agent-stream'

const NOTEBOOK_TRANSCRIPT_FETCH_TIMEOUT_MS = 60_000

function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function createNotebookStream(input: {
  runId: string
  conversationId: string
  turnId: string
  actorUserId: string
  cursor?: string
  signal: AbortSignal
  repository: ConvexHarnessRepository
}): Response {
  const encoder = new TextEncoder()
  let stopped = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: NotebookAgentStreamEvent) => {
        if (!stopped) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }
      emit({
        type: 'accepted',
        runId: input.runId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      })
      const cursor = parseNotebookCursor(input.cursor)
      let afterSequence = cursor ? cursor.sequence - 1 : -1
      let afterCursor = cursor ?? undefined

      void (async () => {
        try {
          while (!stopped && !input.signal.aborted) {
            const state = await input.repository.readPublicStreamState({
              actorUserId: input.actorUserId,
              runId: input.runId,
              afterSequence,
            })
            if (!state) throw new Error('Notebook stream is unavailable.')
            for (const step of state.transcriptSteps) {
              const { persistence } = await readPublicTranscriptStep(
                step,
                AbortSignal.any([input.signal, AbortSignal.timeout(NOTEBOOK_TRANSCRIPT_FETCH_TIMEOUT_MS)]),
              )
              const events = projectNotebookTranscriptStep({
                runId: input.runId,
                step: { ...step, persistence },
                afterCursor,
              })
              for (const event of events) emit(event)
              afterSequence = step.sequence
              afterCursor = undefined
            }
            if (state.nextSequence !== null) {
              afterSequence = Math.max(afterSequence, state.nextSequence)
              continue
            }
            if (isTerminal(state.status)) {
              for (const event of projectNotebookTerminal({ runId: input.runId, status: state.status })) emit(event)
              controller.close()
              return
            }
            await new Promise(resolve => setTimeout(resolve, 150))
          }
          if (!stopped) controller.close()
        } catch (_error) {
          if (!stopped && !input.signal.aborted) {
            controller.close()
          }
        }
      })()
      input.signal.addEventListener('abort', () => {
        stopped = true
        try { controller.close() } catch (_error) { /* stream already closed */ }
      }, { once: true })
    },
    cancel() {
      stopped = true
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
