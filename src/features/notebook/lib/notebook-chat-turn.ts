import type { NotebookAgentRequest } from '@overlay/app-core'
import { buildActStreamIdempotencyKey } from '@/shared/api/act-idempotency'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { chatStreamToNotebookEvents } from './notebook-chat-stream'

/** Each note keeps one personal chat, found again by this client id. */
export function notebookChatClientId(noteId: string): string {
  return `notebook:${noteId}`
}

/**
 * Sends a Notebook message as an ordinary personal chat turn on the note's own
 * conversation. Aborting the request (Stop, or leaving the note) stops the run.
 */
export async function runNotebookChatTurn(input: {
  request: NotebookAgentRequest
  signal: AbortSignal
  ensureConversation(request: NotebookAgentRequest): Promise<string>
}): Promise<Response> {
  const { request, signal } = input
  const conversationId = await input.ensureConversation(request)
  const turnId = crypto.randomUUID()
  const stop = () => {
    void overlayAppClient.conversations.stopResponse({ conversationId }, { credentials: 'same-origin' })
      .catch(() => undefined)
  }
  signal.addEventListener('abort', stop, { once: true })
  const release = () => signal.removeEventListener('abort', stop)
  try {
    const response = await overlayAppClient.conversations.actResponse({
      conversationId,
      turnId,
      mode: 'chat',
      modelId: request.modelId,
      notebookNoteId: request.noteId,
      ...(request.mentions?.length ? { mentions: request.mentions } : {}),
      messages: [{ id: turnId, role: 'user', parts: [{ type: 'text', text: request.message }] }],
    }, {
      credentials: 'same-origin',
      signal,
      idempotencyKey: buildActStreamIdempotencyKey(turnId, 0),
    })
    if (!response.ok || !response.body) {
      release()
      return response
    }
    const body = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(chatStreamToNotebookEvents(release))
    return new Response(body, { status: response.status, headers: { 'Content-Type': 'application/x-ndjson' } })
  } catch (error) {
    if (!signal.aborted) release()
    throw error
  }
}
