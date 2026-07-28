import type { MutationSuccessResponse, PaginationQueryContract } from './common'
import type { ConversationSummary } from './conversations'
import type { KnowledgeFile } from './knowledge'
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
  accessToken?: string
  userId?: string
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
