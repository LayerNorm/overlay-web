import { z } from 'zod'
import { AuthFields, BooleanQueryValue, FormDataBoundary, IdQuery, IntegerQueryValue, PaginationQuery, UnknownResponse } from './common'

export const FileListQuery = PaginationQuery.extend({
  fileId: IdQuery,
  projectId: IdQuery,
  kind: z.string().optional(),
  parentId: IdQuery,
  conversationId: IdQuery,
  outputType: z.string().optional(),
  type: z.string().optional(),
  summary: BooleanQueryValue,
})

export const FileContentQuery = z.object({})

export const CreateFileRequest = z.object({
  ...AuthFields,
  name: z.string().min(1).optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  projectId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  conversationId: z.string().optional(),
  kind: z.string().optional(),
}).passthrough()

export const UpdateFileRequest = CreateFileRequest.partial().extend({
  ...AuthFields,
  fileId: z.string().min(1),
})

export const DeleteFileRequest = z.object({
  ...AuthFields,
  fileId: z.string().min(1).optional(),
})

export const ShareFileRequest = z.object({
  ...AuthFields,
  fileId: z.string().min(1),
  visibility: z.enum(['private', 'public']).optional(),
}).passthrough()

export const UploadUrlRequest = z.object({
  ...AuthFields,
  sizeBytes: z.number().nonnegative(),
  name: z.string().min(1),
  mimeType: z.string().min(1),
})

export const PresignFileQuery = z.object({
  name: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: IntegerQueryValue,
})

export const SearchFileTextRequest = z.object({
  ...AuthFields,
  query: z.string().min(1).optional(),
  fileId: z.string().optional(),
}).passthrough()

export const IngestDocumentForm = FormDataBoundary

export const OutputListQuery = PaginationQuery.extend({
  type: z.string().optional(),
  conversationId: IdQuery,
})

export const DeleteOutputRequest = z.object({
  ...AuthFields,
  outputId: z.string().min(1).optional(),
})

export const OutputContentQuery = z.object({})

export const TranscribeForm = FormDataBoundary

export const FileResponse = UnknownResponse

export const BooleanFileQuery = BooleanQueryValue
