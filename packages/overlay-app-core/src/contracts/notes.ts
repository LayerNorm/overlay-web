import type { MutationSuccessResponse, PaginationQueryContract } from './common'

export interface NoteDoc {
  _id: string
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
  clientId?: string
  projectId?: string
}

export interface NoteQueryContract extends PaginationQueryContract {
  noteId?: string
  projectId?: string | null
  includeDeleted?: boolean
}

export interface CreateNoteRequest {
  title?: string
  content?: string
  tags?: string[]
  projectId?: string
  clientId?: string
  accessToken?: string
  userId?: string
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
  projectId?: string | null
  expectedUpdatedAt?: number
  accessToken?: string
  userId?: string
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
  noteContent: string
  noteTitle: string
  message: string
  modelId?: string
  mode?: 'ask' | 'write'
  projectId?: string
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
  | { type: 'thinking'; thinking?: string }
  | { type: 'tool_call'; tool?: string; toolInput?: Record<string, unknown> }
  | { type: 'edit_proposal'; edit?: NotebookEdit }
  | { type: 'text'; text?: string }
  | { type: 'done' }
  | { type: 'error'; error?: string }
