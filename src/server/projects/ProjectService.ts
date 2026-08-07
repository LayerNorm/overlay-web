import 'server-only'

import type {
  DeleteProjectTreeResult,
  ProjectRecord,
  ProjectRepository,
} from './ProjectRepository'
import { ProjectRepositoryError } from './ProjectRepository'

export class ProjectServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'ProjectServiceError'
  }
}

export class ProjectService {
  constructor(private readonly repository: ProjectRepository) {}

  getProject(args: {
    projectId: string
    userId: string
    workspaceId?: string
  }): Promise<ProjectRecord | null> {
    return this.repository.getProject(args)
  }

  listProjects(args: {
    includeDeleted?: boolean
    updatedSince?: number
    userId: string
    workspaceId?: string
  }): Promise<ProjectRecord[]> {
    return this.repository.listProjects(args)
  }

  async createProject(args: {
    clientId?: string
    instructions?: string
    name?: string
    parentId?: string | null
    userId: string
    workspaceId?: string
  }): Promise<ProjectRecord> {
    const name = requiredName(args.name)
    return await this.mapRepositoryErrors(() => this.repository.createProject({
      clientId: normalizeOptional(args.clientId),
      instructions: normalizeOptional(args.instructions),
      name,
      parentId: normalizeParentId(args.parentId),
      userId: args.userId,
    }))
  }

  async updateProject(args: {
    instructions?: string
    name?: string
    parentId?: string | null
    projectId: string
    userId: string
    workspaceId?: string
  }): Promise<ProjectRecord> {
    const project = await this.mapRepositoryErrors(() => this.repository.updateProject({
      instructions: args.instructions === undefined
        ? undefined
        : normalizeOptional(args.instructions) ?? null,
      name: args.name === undefined ? undefined : requiredName(args.name),
      parentId: args.parentId === undefined ? undefined : normalizeParentId(args.parentId),
      projectId: args.projectId,
      userId: args.userId,
    }))
    if (!project) throw new ProjectServiceError('Not found', 404)
    return project
  }

  async deleteProjectTree(args: {
    projectId: string
    userId: string
    workspaceId?: string
  }): Promise<DeleteProjectTreeResult> {
    const result = await this.mapRepositoryErrors(() => this.repository.deleteProjectTree(args))
    if (!result) throw new ProjectServiceError('Not found', 404)
    return result
  }

  private async mapRepositoryErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ProjectRepositoryError) {
        throw new ProjectServiceError(error.message, 400)
      }
      throw error
    }
  }
}

function requiredName(value: string | undefined): string {
  const name = value?.trim()
  if (!name) throw new ProjectServiceError('name required', 400)
  return name
}

function normalizeOptional(value: string | undefined): string | undefined {
  return value?.trim() || undefined
}

function normalizeParentId(value: string | null | undefined): string | null | undefined {
  if (value === null) return null
  return normalizeOptional(value)
}
