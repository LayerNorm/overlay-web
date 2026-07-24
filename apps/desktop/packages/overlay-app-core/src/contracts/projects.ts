import type { MutationSuccessResponse, PaginationQueryContract } from './common'
import type { ConversationSummary } from './conversations'
import type { KnowledgeFile } from './knowledge'
import type { NoteDoc } from './notes'

export interface ProjectSummary {
  _id: string
  name: string
  description?: string
  instructions?: string
  parentId?: string | null
  deletedAt?: number
  updatedAt: number
  createdAt: number
}

export interface ProjectQueryContract extends PaginationQueryContract {
  projectId?: string
  updatedSince?: number
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
  parentId?: string | null
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
