import { z } from 'zod'
import { AuthFields, BooleanQueryValue, IdQuery, IntegerQueryValue, PaginationQuery, UnknownResponse } from './common'

export const MemoryListQuery = PaginationQuery.extend({
  memoryId: IdQuery,
  raw: BooleanQueryValue,
  updatedSince: IntegerQueryValue,
  includeDeleted: BooleanQueryValue,
  projectId: IdQuery,
  conversationId: IdQuery,
  noteId: IdQuery,
})

export const CreateMemoryRequest = z.object({
  ...AuthFields,
  content: z.string().min(1).optional(),
  type: z.string().optional(),
  source: z.unknown().optional(),
}).passthrough()

export const UpdateMemoryRequest = CreateMemoryRequest.partial().extend({
  ...AuthFields,
  memoryId: z.string().min(1),
})

export const DeleteMemoryRequest = z.object({
  ...AuthFields,
  memoryId: z.string().min(1).optional(),
})

export const KnowledgeSearchRequest = z.object({
  ...AuthFields,
  query: z.string().min(1).optional(),
  projectId: z.string().optional(),
  limit: z.number().int().positive().optional(),
}).passthrough()

export const MemoryResponse = UnknownResponse
