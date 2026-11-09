import { z } from 'zod/v3'
import { ResourceViewQuery } from './misc'
import { AuthFields, BooleanQueryValue, IdQuery, PaginationQuery, UnknownResponse } from './common'

export const NoteListQuery = PaginationQuery.extend({
  noteId: IdQuery,
  includeDeleted: BooleanQueryValue,
  view: ResourceViewQuery,
})

export const CreateNoteRequest = z.object({
  ...AuthFields,
  title: z.string().max(200).optional(),
  byAgent: z.boolean().optional(),
  content: z.string().optional(),
  scope: z.enum(['personal', 'workspace']).optional(),
})

export const UpdateNoteRequest = CreateNoteRequest.partial().extend({
  ...AuthFields,
  noteId: z.string().min(1),
  byAgent: z.boolean().optional(),
})

export const DeleteNoteRequest = z.object({
  ...AuthFields,
  noteId: z.string().min(1).optional(),
})

export const NotebookAgentRequest = z.object({
  ...AuthFields,
  noteId: z.string().min(1).max(256),
  turnId: z.string().min(1).max(256),
  runId: z.string().max(256).optional(),
  cursor: z.string().max(256).optional(),
  noteContent: z.string().max(400_000),
  noteTitle: z.string().max(200),
  message: z.string().min(1).max(32_000),
  modelId: z.string().max(200).optional(),
  mode: z.enum(['ask', 'write']).optional(),
  mentions: z.array(z.object({
    type: z.string().max(100),
    id: z.string().max(256),
    name: z.string().max(200),
    fileIds: z.array(z.string().max(256)).max(100).optional(),
  })).max(100).optional(),
  prompt: z.string().optional(),
}).passthrough()

export const NoteResponse = UnknownResponse
