import 'server-only'

import type { ProjectSummary } from '@overlay/app-core'

export type ProjectRecord = ProjectSummary & {
  userId: string
  clientId?: string
}

export type ProjectRepositoryErrorCode =
  | 'invalid_parent'
  | 'parent_cycle'

export class ProjectRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: ProjectRepositoryErrorCode,
  ) {
    super(message)
    this.name = 'ProjectRepositoryError'
  }
}

export type DeleteProjectTreeResult = {
  deletedAt: number
  deletedIds: string[]
  deletedConversationIds: string[]
  deletedFileIds: string[]
  deletedMemoryIds: string[]
  deletedNoteIds: string[]
}

export interface ProjectRepository {
  getProject(args: {
    projectId: string
    userId: string
  }): Promise<ProjectRecord | null>
  listProjects(args: {
    includeArchived?: boolean
    includeDeleted?: boolean
    updatedSince?: number
    userId: string
  }): Promise<ProjectRecord[]>
  createProject(args: {
    clientId?: string
    instructions?: string
    knowledgeBaseId?: string | null
    name: string
    parentId?: string | null
    userId: string
  }): Promise<ProjectRecord>
  updateProject(args: {
    archivedAt?: number | null
    instructions?: string | null
    knowledgeBaseId?: string | null
    name?: string
    parentId?: string | null
    projectId: string
    userId: string
  }): Promise<ProjectRecord | null>
  deleteProjectTree(args: {
    projectId: string
    userId: string
  }): Promise<DeleteProjectTreeResult | null>
}
