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
  constructor(
    private readonly repository: ProjectRepository,
    private readonly options: {
      assertKnowledgeBaseAccess?: (args: {
        knowledgeBaseId: string
        userId: string
      }) => Promise<void>
    } = {},
  ) {}

  getProject(args: {
    projectId: string
    userId: string
  }): Promise<ProjectRecord | null> {
    return this.repository.getProject(args)
  }

  listProjects(args: {
    includeArchived?: boolean
    includeDeleted?: boolean
    updatedSince?: number
    userId: string
  }): Promise<ProjectRecord[]> {
    return this.repository.listProjects(args)
  }

  async createProject(args: {
    clientId?: string
    instructions?: string
    knowledgeBaseId?: string | null
    name?: string
    parentId?: string | null
    userId: string
  }): Promise<ProjectRecord> {
    const name = requiredName(args.name)
    const knowledgeBaseId = normalizeNullableId(args.knowledgeBaseId)
    await this.assertKnowledgeBaseAccess({ knowledgeBaseId, userId: args.userId })
    return await this.mapRepositoryErrors(() => this.repository.createProject({
      clientId: normalizeOptional(args.clientId),
      instructions: normalizeOptional(args.instructions),
      ...(knowledgeBaseId !== undefined ? { knowledgeBaseId } : {}),
      name,
      parentId: normalizeParentId(args.parentId),
      userId: args.userId,
    }))
  }

  async updateProject(args: {
    archived?: boolean
    instructions?: string
    knowledgeBaseId?: string | null
    name?: string
    parentId?: string | null
    projectId: string
    userId: string
  }): Promise<ProjectRecord> {
    const knowledgeBaseId = normalizeNullableId(args.knowledgeBaseId)
    await this.assertKnowledgeBaseAccess({ knowledgeBaseId, userId: args.userId })
    const project = await this.mapRepositoryErrors(() => this.repository.updateProject({
      archivedAt: args.archived === undefined ? undefined : args.archived ? Date.now() : null,
      instructions: args.instructions === undefined
        ? undefined
        : normalizeOptional(args.instructions) ?? null,
      ...(knowledgeBaseId !== undefined ? { knowledgeBaseId } : {}),
      name: args.name === undefined ? undefined : requiredName(args.name),
      parentId: args.parentId === undefined ? undefined : normalizeParentId(args.parentId),
      projectId: args.projectId,
      userId: args.userId,
    }))
    if (!project) throw new ProjectServiceError('Not found', 404)
    return project
  }

  private async assertKnowledgeBaseAccess(args: {
    knowledgeBaseId?: string | null
    userId: string
  }): Promise<void> {
    if (!args.knowledgeBaseId || !this.options.assertKnowledgeBaseAccess) return
    await this.options.assertKnowledgeBaseAccess({
      knowledgeBaseId: args.knowledgeBaseId,
      userId: args.userId,
    })
  }

  async deleteProjectTree(args: {
    projectId: string
    userId: string
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

function normalizeNullableId(value: string | null | undefined): string | null | undefined {
  if (value === null) return null
  return normalizeOptional(value)
}
