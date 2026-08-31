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
  archivedAt?: number | null
  updatedAt: number
  createdAt: number
}

export interface ProjectQueryContract extends PaginationQueryContract {
  projectId?: string
  updatedSince?: number
  includeDeleted?: boolean
  archived?: boolean
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

export type ProjectExportFile = Record<string, unknown>

export interface ProjectExport {
  format: 'overlay-project'
  version: number
  exportedAt: string
  project: ProjectSummary
  knowledgeBases: Array<{ id: string; title: string; description?: string }>
  conversations: Array<Record<string, unknown>>
  notes: Array<Record<string, unknown>>
  files: ProjectExportFile[]
}
