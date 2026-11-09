import type { NotebookAgentRequest } from '@overlay/app-core'

export type NotebookAgentIdentity = {
  runId: string
  conversationId: string
  turnId: string
  cursor?: string
}

export const NOTEBOOK_RECONNECT_EXHAUSTED_MESSAGE =
  'The Notebook stream disconnected repeatedly. Stop this run before starting another request.'

export function notebookRunMayUpdate(input: {
  currentNoteId: string | undefined
  runNoteId: string
  currentToken: number | null
  runToken: number
}): boolean {
  return input.currentToken === input.runToken && input.currentNoteId === input.runNoteId
}

export type NotebookAgentReconnectResult =
  | { status: 'complete' | 'stopped' | 'exhausted' }
  | { status: 'request-error'; response: Response }

export function notebookSnapshotMatches(input: {
  frozenTitle: string
  currentTitle: string
  frozenMarkdown: string
  currentMarkdown: string
}): boolean {
  return input.frozenTitle === input.currentTitle && input.frozenMarkdown === input.currentMarkdown
}

export async function stopNotebookRunAfterAcceptance(input: {
  identity: NotebookAgentIdentity
  requested: boolean
  stopAgent: (identity: Pick<NotebookAgentIdentity, 'conversationId' | 'turnId'>) => Promise<void>
  disconnect: () => void
}): Promise<void> {
  if (!input.requested) return
  await input.stopAgent(input.identity)
  input.disconnect()
}

export async function cancelNotebookRunAfterReconnectExhaustion(input: {
  run: { identity: NotebookAgentIdentity | null }
  stopAgent: (identity: Pick<NotebookAgentIdentity, 'conversationId' | 'turnId'>) => Promise<void>
  disconnect: () => void
}): Promise<boolean> {
  if (!input.run.identity) return false
  try {
    await input.stopAgent(input.run.identity)
    input.run.identity = null
    input.disconnect()
    return true
  } catch {
    return false
  }
}

export async function followNotebookAgentStream(input: {
  request: NotebookAgentRequest
  runAgent: (request: NotebookAgentRequest, signal: AbortSignal) => Promise<Response>
  signal: AbortSignal
  getIdentity: () => NotebookAgentIdentity | null
  readStream: (response: Response) => Promise<boolean>
  wait?: (milliseconds: number) => Promise<void>
}): Promise<NotebookAgentReconnectResult> {
  const wait = input.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  let retries = 0
  while (!input.signal.aborted) {
    let response: Response
    try {
      const identity = input.getIdentity()
      response = await input.runAgent({
        ...input.request,
        ...(identity ? { runId: identity.runId, cursor: identity.cursor } : {}),
      }, input.signal)
    } catch {
      if (input.signal.aborted) return { status: 'stopped' }
      if (retries >= 3) return { status: 'exhausted' }
      retries += 1
      await wait(250 * 2 ** retries)
      continue
    }

    if (!response.ok) {
      if (response.status < 500) return { status: 'request-error', response }
      if (retries >= 3) return { status: 'exhausted' }
      retries += 1
      await wait(250 * 2 ** retries)
      continue
    }

    if (await input.readStream(response)) return { status: 'complete' }
    if (input.signal.aborted) return { status: 'stopped' }
    if (retries >= 3) return { status: 'exhausted' }
    retries += 1
    await wait(250 * 2 ** retries)
  }
  return { status: 'stopped' }
}
