import { createHash } from 'node:crypto'
import { normalizeNotebookTitle, type NotebookAgentMention } from '@overlay/app-core'
import { toCanonicalNoteMarkdown } from '@overlay/app-core/note-markdown'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'

export function notebookRequestDigest(input: {
  noteId: string
  turnId: string
  noteMarkdown: string
  noteTitle: string
  message: string
  modelId: string
  mentions?: NotebookAgentMention[]
}): string {
  return createHash('sha256').update(JSON.stringify([
    input.noteId,
    input.turnId,
    toCanonicalNoteMarkdown(input.noteMarkdown),
    normalizeNotebookTitle(input.noteTitle),
    input.message,
    input.modelId,
    input.mentions ?? [],
  ])).digest('hex')
}

export function matchesNotebookRunIdentity(input: {
  state: HarnessSnapshot
  agentRun: { id: string; conversationId: string; userId: string; turnId: string }
  userId: string
  workspaceId: string
  noteId: string
  turnId: string
  conversationId: string
  requestDigest: string
  runId?: string
}): boolean {
  const { state } = input
  const surface = state.policy.surface
  const allowedToolIds = state.policy.allowedToolIds
  return (!input.runId || input.runId === state.runId)
    && state.runId === `personal:${input.agentRun.id}`
    && input.agentRun.conversationId === input.conversationId
    && input.agentRun.userId === input.userId
    && input.agentRun.turnId === input.turnId
    && state.policy.actorUserId === input.userId
    && state.policy.workspaceId === input.workspaceId
    && surface?.kind === 'notebook'
    && surface.noteId === input.noteId
    && surface.turnId === input.turnId
    && surface.requestDigest === input.requestDigest
    && ['read_note', 'propose_edit', 'finish'].every(id => allowedToolIds.includes(id))
    && allowedToolIds.every(id => ['search_knowledge', 'read_note', 'propose_edit', 'finish'].includes(id))
}
