import type { NotebookAgentRequest } from '@overlay/app-core'
import { buildActStreamIdempotencyKey } from '@/shared/api/act-idempotency'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

/** Each note keeps one personal chat, found again by this client id. */
export function notebookChatClientId(noteId: string): string {
  return `notebook:${noteId}`
}

export type NotebookChatTarget = { workspaceId: string; conversationId: string }
export type NotebookTurnSettlement = 'completed' | 'failed' | 'cancelled' | 'unavailable'
export type NotebookTurnOutcome = NotebookTurnSettlement | 'rejected'

export type NotebookChatTurn = NotebookChatTarget & {
  turnId: string
  noteId: string
  text: string
  modelId?: string
  createdAt: number
}

type ConversationClient = Pick<typeof overlayAppClient.conversations, 'actResponse' | 'stopResponse'>

/** The act stream ends at admission and carries an error chunk only when the turn was not admitted. */
export function admissionStreamError(body: string): string | null {
  for (const line of body.split('\n')) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : ''
    if (!data || data === '[DONE]') continue
    try {
      const chunk = JSON.parse(data) as { type?: string; errorText?: string }
      if (chunk.type === 'error') return chunk.errorText || 'The response could not be completed.'
    } catch {
      continue
    }
  }
  return null
}

function settledOrStopped(settlement: Promise<NotebookTurnSettlement>, signal: AbortSignal): Promise<NotebookTurnSettlement> {
  if (signal.aborted) return Promise.resolve('cancelled')
  return new Promise((resolve) => {
    const stopped = () => resolve('cancelled')
    signal.addEventListener('abort', stopped, { once: true })
    void settlement.then((outcome) => {
      signal.removeEventListener('abort', stopped)
      resolve(outcome)
    })
  })
}

/**
 * Sends a Notebook message as an ordinary personal chat turn on the note's own
 * conversation. The reply is read from Convex like any chat, so the request ends at
 * admission and this resolves when the turn settles. Aborting (Stop, or leaving the
 * note) stops the run and resolves at once.
 */
export async function runNotebookChatTurn(input: {
  request: NotebookAgentRequest
  signal: AbortSignal
  ensureConversation(request: NotebookAgentRequest): Promise<NotebookChatTarget>
  waitForTurn(target: NotebookChatTarget & { turnId: string }): Promise<NotebookTurnSettlement>
  onTurnStart?(turn: NotebookChatTurn): void
  onTurnEnd?(turn: NotebookChatTurn, outcome: NotebookTurnOutcome): void
  client?: ConversationClient
  now?(): number
}): Promise<Response | void> {
  const { request, signal } = input
  const client = input.client ?? overlayAppClient.conversations
  const target = await input.ensureConversation(request)
  const turn: NotebookChatTurn = {
    ...target,
    turnId: crypto.randomUUID(),
    noteId: request.noteId,
    text: request.message,
    ...(request.modelId ? { modelId: request.modelId } : {}),
    createdAt: (input.now ?? Date.now)(),
  }
  const stop = () => {
    void client.stopResponse({ conversationId: target.conversationId }, { credentials: 'same-origin' })
      .catch(() => undefined)
  }
  signal.addEventListener('abort', stop, { once: true })
  input.onTurnStart?.(turn)
  let outcome: NotebookTurnOutcome = 'rejected'
  try {
    const response = await client.actResponse({
      conversationId: target.conversationId,
      turnId: turn.turnId,
      mode: 'chat',
      modelId: request.modelId,
      notebookNoteId: request.noteId,
      liveTransport: 'convex',
      ...(request.mentions?.length ? { mentions: request.mentions } : {}),
      messages: [{ id: turn.turnId, role: 'user', parts: [{ type: 'text', text: request.message }] }],
    }, {
      credentials: 'same-origin',
      signal,
      idempotencyKey: buildActStreamIdempotencyKey(turn.turnId, 0),
    })
    if (!response.ok) return response
    const admissionError = admissionStreamError(await response.text())
    if (admissionError) throw new Error(admissionError)
    outcome = await settledOrStopped(input.waitForTurn({ ...target, turnId: turn.turnId }), signal)
    if (outcome === 'unavailable') throw new Error('This note\'s assistant chat is no longer available.')
  } catch (error) {
    if (signal.aborted) outcome = 'cancelled'
    throw error
  } finally {
    signal.removeEventListener('abort', stop)
    input.onTurnEnd?.(turn, outcome)
  }
}
