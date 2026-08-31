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
    workspaceId?: string
  }): Promise<ProjectRecord | null>
  listProjects(args: {
    includeDeleted?: boolean
    updatedSince?: number
    archived?: boolean
    userId: string
    workspaceId?: string
  }): Promise<ProjectRecord[]>
  createProject(args: {
    clientId?: string
    instructions?: string
    name: string
    parentId?: string | null
    userId: string
    workspaceId?: string
  }): Promise<ProjectRecord>
  updateProject(args: {
    instructions?: string | null
    name?: string
    parentId?: string | null
    archived?: boolean
    projectId: string
    userId: string
    workspaceId?: string
  }): Promise<ProjectRecord | null>
  deleteProjectTree(args: {
    projectId: string
    userId: string
    workspaceId?: string
  }): Promise<DeleteProjectTreeResult | null>
}
