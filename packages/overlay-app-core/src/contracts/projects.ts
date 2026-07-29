import type { MutationSuccessResponse, PaginationQueryContract } from './common'
import type { ConversationSummary } from './conversations'
import type { KnowledgeFile } from './knowledge'
import type { KnowledgeBase } from './knowledge-bases'
import type { NoteDoc } from './notes'

export interface ProjectSummary {
  _id: string
  name: string
  description?: string
  instructions?: string
  knowledgeBaseId?: string | null
  parentId?: string | null
  /** Per-project configuration; see @/shared/projects/project-settings. */
  settings?: Record<string, unknown>
  archivedAt?: number
  deletedAt?: number
  updatedAt: number
  createdAt: number
}

export interface ProjectQueryContract extends PaginationQueryContract {
  projectId?: string
  updatedSince?: number
  includeArchived?: boolean
  includeDeleted?: boolean
}

export interface ProjectTreeNode extends ProjectSummary {
  depth: number
  path: readonly string[]
  children: ProjectTreeNode[]
}

export interface ProjectResourceSummary {
  conversations: ConversationSummary[]
  notes: NoteDoc[]
  files: KnowledgeFile[]
}

export interface CreateProjectRequest {
  name: string
  parentId?: string | null
  instructions?: string
  settings?: Record<string, unknown>
  knowledgeBaseId?: string | null
  clientId?: string
  accessToken?: string
  userId?: string
}

export interface CreateProjectResponse {
  id: string
  project?: ProjectSummary | null
  error?: string
}

export interface UpdateProjectRequest {
  projectId: string
  name?: string
  instructions?: string
  knowledgeBaseId?: string | null
  parentId?: string | null
  archived?: boolean
  settings?: Record<string, unknown>
  accessToken?: string
  userId?: string
}

export interface ProjectKnowledgeTransferRequest {
  projectId?: string
  knowledgeBaseId: string
  direction: 'promote' | 'copy' | 'save-answer'
  fileId?: string
  sourceId?: string
  conversationId?: string
  messageId?: string
  content?: string
  title?: string
}

export interface ProjectExportFile {
  id: string
  name: string
  kind?: string
  content?: string
  textContent?: string
  mimeType?: string
  sizeBytes?: number
  createdAt?: number
  updatedAt?: number
}

export interface ProjectExportConversation extends ConversationSummary {
  messages: Array<Record<string, unknown>>
}

export interface ProjectExport {
  format: 'overlay-project'
  version: 1
  exportedAt: string
  project: ProjectSummary
  knowledgeBases: Array<Pick<KnowledgeBase, 'id' | 'title' | 'description'>>
  conversations: ProjectExportConversation[]
  notes: NoteDoc[]
  files: ProjectExportFile[]
}

export interface UpdateProjectResponse {
  success: boolean
  project?: ProjectSummary | null
  error?: string
}

export interface DeleteProjectResponse extends MutationSuccessResponse {
  deletedIds?: string[]
  deletedAt?: number
}
