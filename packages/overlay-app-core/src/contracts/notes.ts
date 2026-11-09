import type { ScopedResourceFields } from './resource-scope'
import type { MutationSuccessResponse, PaginationQueryContract } from './common'

export interface NoteDoc extends ScopedResourceFields {
  _id: string
  /** The creator; only they can move it between scopes. */
  userId?: string
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
  clientId?: string
}

export interface NoteQueryContract extends PaginationQueryContract {
  noteId?: string
  includeDeleted?: boolean
  /** Personal, workspace, or archived. Omitted means everything active the caller can see. */
  view?: 'personal' | 'workspace' | 'archived'
}

export interface CreateNoteRequest {
  /** Created by automation rather than direct human activity. */
  byAgent?: boolean
  title?: string
  content?: string
  tags?: string[]
  clientId?: string
  conversationId?: string
  accessToken?: string
  userId?: string
  workspaceId?: string
  /** Defaults to personal. */
  scope?: 'personal' | 'workspace'
}

export interface CreateNoteResponse {
  id: string
  note: NoteDoc | null
  error?: string
}

export interface UpdateNoteRequest {
  noteId: string
  title?: string
  content?: string
  tags?: string[]
  expectedUpdatedAt?: number
  /** An agent made the change, so it earns no person activity credit. */
  byAgent?: boolean
  accessToken?: string
  userId?: string
  workspaceId?: string
}

export interface UpdateNoteResponse {
  success: boolean
  note: NoteDoc | null
  conflict?: {
    localRevision?: string
    remoteRevision?: string
    message: string
  }
  error?: string
}

export interface DeleteNoteResponse extends MutationSuccessResponse {
  noteId?: string
  deletedAt?: number
}

export interface NotebookAgentMention {
  type: string
  id: string
  name: string
  fileIds?: string[]
}

export interface NotebookAgentRequest {
  noteId: string
  turnId: string
  runId?: string
  cursor?: string
  noteContent: string
  noteTitle: string
  message: string
  modelId?: string
  mode?: 'ask' | 'write'
  mentions?: NotebookAgentMention[]
  accessToken?: string
  userId?: string
}

export interface NotebookEdit {
  id: string
  description: string
  startLine: number
  endLine: number
  originalLines: string[]
  newLines: string[]
}

export type NotebookAgentStreamEvent =
  | { type: 'accepted'; runId: string; conversationId: string; turnId: string; cursor?: string }
  | { type: 'thinking'; thinking?: string }
  | { type: 'tool_call'; tool?: string; toolInput?: Record<string, unknown>; eventId?: string; sequence?: number; cursor?: string }
  | { type: 'edit_proposal'; edit?: NotebookEdit; eventId?: string; sequence?: number; cursor?: string }
  | { type: 'text'; text?: string; eventId?: string; sequence?: number; cursor?: string }
  | { type: 'done'; eventId?: string; sequence?: number; cursor?: string }
  | { type: 'error'; error?: string; eventId?: string; sequence?: number; cursor?: string }
