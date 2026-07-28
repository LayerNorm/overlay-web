import { z } from 'zod'
import { FormDataBoundary } from './common'

export const KnowledgeBaseListQuery = z.object({})
export const KnowledgeBaseShareDirectoryQuery = z.object({})
export const AdminKnowledgeBaseListQuery = z.object({})

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
  title: z.string().trim().min(1).max(240).optional(),
  content: z.string().min(1).max(12 * 1024 * 1024).optional(),
  mimeType: z.string().trim().max(160).optional(),
  sourceRef: z.string().trim().max(2000).optional(),
  /** Set for externally fetched sources; `ref` then supplies the origin. */
  kind: z.enum(['text', 'url', 'connector', 'drive']).optional(),
  ref: z.string().trim().max(2000).optional(),
}).refine(
  (value) => (
    value.kind && value.kind !== 'text'
      ? Boolean(value.ref)
      : Boolean(value.title && value.content)
  ),
  { message: 'Provide title and content, or a kind with a ref' },
)

export const UpdateKnowledgeBaseSourceRequest = z.object({
  sourceId: z.string().min(1),
  content: z.string().min(1).max(12 * 1024 * 1024).optional(),
  enabled: z.boolean().optional(),
  retry: z.boolean().optional(),
  /** Re-fetch an external source from its origin. */
  refresh: z.boolean().optional(),
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

export const KnowledgeBaseDiagnosticsQuery = z.object({
  /** Omit for base-wide diagnostics; supply to fetch one source's extraction preview. */
  sourceId: z.string().min(1).optional(),
  previewLimit: z.coerce.number().int().min(200).max(20_000).optional(),
})

export const ReindexKnowledgeBaseRequest = z.object({
  /** Omit to sweep the whole base. */
  sourceId: z.string().min(1).optional(),
  /** Skip sources already indexed under the current content and embedding identity. */
  onlyStale: z.boolean().optional(),
})

export const EnsurePersonalKnowledgeBaseRequest = z.object({
  title: z.string().trim().min(1).max(160).optional(),
})

export const KnowledgeBaseEmptyQuery = z.object({})
export const KnowledgeBaseSourceUploadForm = FormDataBoundary

export type UpdateKnowledgeBaseSourceRequest = z.infer<typeof UpdateKnowledgeBaseSourceRequest>
export type DeleteKnowledgeBaseSourceRequest = z.infer<typeof DeleteKnowledgeBaseSourceRequest>
export type SearchKnowledgeBaseRequest = z.infer<typeof SearchKnowledgeBaseRequest>
export type CreateKnowledgeBaseGrantRequest = z.infer<typeof CreateKnowledgeBaseGrantRequest>
export type DeleteKnowledgeBaseGrantRequest = z.infer<typeof DeleteKnowledgeBaseGrantRequest>
