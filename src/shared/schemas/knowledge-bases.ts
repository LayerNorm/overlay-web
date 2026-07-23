import { z } from 'zod'

export const KnowledgeBaseListQuery = z.object({})

export const CreateKnowledgeBaseRequest = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional(),
  kind: z.enum(['personal', 'organization']).optional(),
})

export const UpdateKnowledgeBaseRequest = CreateKnowledgeBaseRequest.partial().extend({
  knowledgeBaseId: z.string().min(1),
})

export const DeleteKnowledgeBaseRequest = z.object({
  knowledgeBaseId: z.string().min(1),
})

export const CreateKnowledgeBaseSourceRequest = z.object({
  title: z.string().trim().min(1).max(240),
  content: z.string().min(1).max(12 * 1024 * 1024),
  mimeType: z.string().trim().max(160).optional(),
  sourceRef: z.string().trim().max(2000).optional(),
})

export const UpdateKnowledgeBaseSourceRequest = z.object({
  sourceId: z.string().min(1),
  content: z.string().min(1).max(12 * 1024 * 1024).optional(),
  enabled: z.boolean().optional(),
  retry: z.boolean().optional(),
})

export const DeleteKnowledgeBaseSourceRequest = z.object({
  sourceId: z.string().min(1),
  deleteCanonical: z.boolean().optional(),
})

export const SearchKnowledgeBaseRequest = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
})

export const CreateKnowledgeBaseGrantRequest = z.object({
  principalType: z.enum(['user', 'group', 'role']),
  principalId: z.string().trim().min(1),
  accessRole: z.enum(['viewer', 'editor']),
})

export const DeleteKnowledgeBaseGrantRequest = z.object({
  grantId: z.string().min(1),
})

export const KnowledgeBaseEmptyQuery = z.object({})

export type UpdateKnowledgeBaseSourceRequest = z.infer<typeof UpdateKnowledgeBaseSourceRequest>
export type DeleteKnowledgeBaseSourceRequest = z.infer<typeof DeleteKnowledgeBaseSourceRequest>
export type SearchKnowledgeBaseRequest = z.infer<typeof SearchKnowledgeBaseRequest>
export type CreateKnowledgeBaseGrantRequest = z.infer<typeof CreateKnowledgeBaseGrantRequest>
export type DeleteKnowledgeBaseGrantRequest = z.infer<typeof DeleteKnowledgeBaseGrantRequest>
