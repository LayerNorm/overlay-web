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
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
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
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
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

  /**
   * Lists projects that are marked as reusable templates.
   * Stub implementation: returns all non-deleted projects for the user.
   */
  async listTemplates(args: {
    userId: string
  }): Promise<ProjectRecord[]> {
    return this.mapRepositoryErrors(() => this.repository.listProjects({
      userId: args.userId,
    }))
  }

  /**
   * Creates a new project by duplicating an existing project's configuration.
   * Working data (conversations, notes, files) is not carried across — only
   * the project metadata is copied. Knowledge bases are attached via the
   * caller-provided `attachKnowledgeBases` callback.
   */
  async duplicateProject(args: {
    sourceProjectId: string
    name?: string
    userId: string
    attachKnowledgeBases?: (args: { projectId: string }) => Promise<void>
  }): Promise<ProjectRecord> {
    const source = await this.mapRepositoryErrors(() => this.repository.getProject({
      projectId: args.sourceProjectId,
      userId: args.userId,
    }))
    if (!source) throw new ProjectServiceError('Source project not found', 404)

    const duplicate = await this.mapRepositoryErrors(() => this.repository.createProject({
      name: args.name ?? `${source.name} (copy)`,
      instructions: source.instructions,
      parentId: source.parentId ?? null,
      userId: args.userId,
    }))

    if (args.attachKnowledgeBases) {
      await args.attachKnowledgeBases({ projectId: duplicate._id })
    }

    return duplicate
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
