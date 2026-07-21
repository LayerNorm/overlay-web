import type { MutationSuccessResponse, PaginationQueryContract } from './common'

export interface KnowledgeFile {
  _id: string
  clientId?: string
  name: string
  type: 'file' | 'folder' | 'note' | 'output' | string
  kind?: 'folder' | 'note' | 'upload' | 'output' | string
  parentId: string | null
  content?: string
  textContent?: string
  previewText?: string
  mimeType?: string
  extension?: string
  sizeBytes?: number
  isStorageBacked?: boolean
  downloadUrl?: string
  outputType?: string
  modelId?: string
  prompt?: string
  createdAt: number
  updatedAt: number
  projectId?: string
}

export type KnowledgeFileKind = 'folder' | 'note' | 'upload' | 'output' | string

export interface KnowledgeFileTreeNode extends KnowledgeFile {
  depth: number
  path: readonly string[]
  children: KnowledgeFileTreeNode[]
}

export interface FileQueryContract extends PaginationQueryContract {
  fileId?: string
  projectId?: string | null
  kind?: KnowledgeFileKind
  parentId?: string | null
  conversationId?: string
  outputType?: string
  type?: string
  summary?: boolean
}

export interface CreateFileRequest {
  name: string
  clientId?: string
  type?: 'file' | 'folder' | string
  kind?: KnowledgeFileKind
  parentId?: string | null
  content?: string
  textContent?: string
  r2Key?: string
  sizeBytes?: number
  projectId?: string | null
  mimeType?: string
  extension?: string
  conversationId?: string
  turnId?: string
  modelId?: string
  prompt?: string
  outputType?: string
  legacyOutputId?: string
  accessToken?: string
  userId?: string
}

export interface CreateFileResponse {
  id?: string
  ids?: string[]
  parts?: number
  file?: KnowledgeFile | null
  error?: string
}

export interface UpdateFileRequest {
  fileId: string
  name?: string
  content?: string
  textContent?: string
  parentId?: string | null
  projectId?: string | null
  accessToken?: string
  userId?: string
}

export interface FileUploadUrlRequest {
  name?: string
  mimeType?: string
  sizeBytes: number
  accessToken?: string
  userId?: string
}

export interface FileUploadUrlResponse {
  uploadUrl: string
  r2Key: string
  expiresIn: number
  maxSizeBytes: number
  error?: string
  message?: string
}

export interface FilePresignQuery {
  name: string
  mimeType?: string
  sizeBytes: number
}

export interface FilePresignResponse {
  r2Key: string
  presignedUrl: string
  expiresIn: number
  maxSizeBytes: number
  error?: string
  message?: string
}

export interface FileShareRequest {
  fileId: string
  visibility: 'private' | 'public'
  accessToken?: string
  userId?: string
}

export interface FileShareResponse {
  visibility: 'private' | 'public'
  token: string | null
  url: string | null
  error?: string
}

export type FileBulkAction = 'delete' | 'move' | 'share' | 'download'

export interface FileBulkActionRequest {
  action: FileBulkAction
  fileIds: readonly string[]
  targetParentId?: string | null
  targetProjectId?: string | null
  visibility?: 'private' | 'public'
}

export interface FileTextSearchRequest {
  fileIds: string[]
  query: string
  contextChars?: number
  maxMatchesPerFile?: number
  maxTotalSnippetChars?: number
  accessToken?: string
  userId?: string
}

export interface FileTextSearchMatch {
  fileId: string
  fileName: string
  matchIndexInFile: number
  charStart: number
  charEnd: number
  snippet: string
}

export interface FileTextSearchResponse {
  success: true
  matches: FileTextSearchMatch[]
  truncated: boolean
}

export interface MemoryRow {
  key: string
  memoryId: string
  segmentIndex: number
  content: string
  fullContent: string
  source: string
  type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  importance?: number
  projectId?: string
  conversationId?: string
  noteId?: string
  messageId?: string
  turnId?: string
  tags?: string[]
  actor?: 'user' | 'agent'
  status?: 'candidate' | 'approved' | 'rejected'
  createdAt: number
  updatedAt?: number
}

export interface MemoryQueryContract extends PaginationQueryContract {
  memoryId?: string
  raw?: boolean
  updatedSince?: number
  includeDeleted?: boolean
  projectId?: string
  conversationId?: string
  noteId?: string
}

export interface CreateMemoryRequest {
  content: string
  source?: 'chat' | 'note' | 'manual'
  clientId?: string
  type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  importance?: number
  projectId?: string
  conversationId?: string
  noteId?: string
  messageId?: string
  turnId?: string
  tags?: string[]
  actor?: 'user' | 'agent'
  accessToken?: string
  userId?: string
}

export interface CreateMemoryResponse {
  id: string
  ids: string[]
  count: number
  memory?: MemoryRow | null
  error?: string
}

export interface UpdateMemoryRequest extends Partial<Omit<CreateMemoryRequest, 'clientId'>> {
  memoryId: string
}

export type OutputType = string
export type OutputSource = string

export interface OutputSummary {
  _id: string
  type: OutputType
  source?: OutputSource
  status: 'pending' | 'completed' | 'failed'
  prompt: string
  modelId: string
  url?: string
  fileName?: string
  mimeType?: string
  sizeBytes?: number
  metadata?: Record<string, unknown>
  errorMessage?: string
  createdAt: number
  completedAt?: number
}

export interface OutputQueryContract extends PaginationQueryContract {
  outputId?: string
  type?: string
  limit?: number
  conversationId?: string
}

export type DeleteOutputResponse = MutationSuccessResponse

export interface OutputShareRequest {
  outputId: string
  visibility: 'private' | 'public'
}

export type OutputShareResponse = FileShareResponse
