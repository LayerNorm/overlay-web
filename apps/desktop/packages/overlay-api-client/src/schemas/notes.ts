import { z } from 'zod'
import { AuthFields, BooleanQueryValue, IdQuery, PaginationQuery, UnknownResponse } from './common'

export const NoteListQuery = PaginationQuery.extend({
  noteId: IdQuery,
  projectId: IdQuery,
  includeDeleted: BooleanQueryValue,
})

export const CreateNoteRequest = z.object({
  ...AuthFields,
  title: z.string().max(200).optional(),
  content: z.string().optional(),
  projectId: z.string().optional(),
})

export const UpdateNoteRequest = CreateNoteRequest.partial().extend({
  ...AuthFields,
  noteId: z.string().min(1),
})

export const DeleteNoteRequest = z.object({
  ...AuthFields,
  noteId: z.string().min(1).optional(),
})

export const NotebookAgentRequest = z.object({
  ...AuthFields,
  noteId: z.string().optional(),
  prompt: z.string().optional(),
}).passthrough()

export const NoteResponse = UnknownResponse
