import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Id } from '../../../convex/_generated/dataModel'
import type {
  DeleteProjectTreeResult,
  ProjectRecord,
  ProjectRepository,
} from './ProjectRepository'

export class ConvexProjectRepository implements ProjectRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async getProject(args: {
    projectId: string
    userId: string
    workspaceId?: string
  }): Promise<ProjectRecord | null> {
    return await convex.query<ProjectRecord | null>('projects/projects:get', {
      projectId: args.projectId as Id<'projects'>,
      userId: args.userId,
      serverSecret: this.serverSecret,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    })
  }

  async listProjects(args: {
    includeDeleted?: boolean
    updatedSince?: number
    userId: string
    workspaceId?: string
  }): Promise<ProjectRecord[]> {
    return await convex.query<ProjectRecord[]>('projects/projects:list', {
      userId: args.userId,
      serverSecret: this.serverSecret,
      updatedSince: args.updatedSince,
      includeDeleted: args.includeDeleted,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    }) ?? []
  }

  async createProject(args: {
    clientId?: string
    instructions?: string
    name: string
    parentId?: string | null
    userId: string
    workspaceId?: string
  }): Promise<ProjectRecord> {
    const id = await convex.mutation<Id<'projects'>>('projects/projects:create', {
      userId: args.userId,
      serverSecret: this.serverSecret,
      clientId: args.clientId,
      instructions: args.instructions,
      name: args.name,
      parentId: args.parentId ?? undefined,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    }, { throwOnError: true })
    if (!id) throw new Error('Failed to create project')
    const project = await this.getProject({ projectId: id, userId: args.userId, ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}) })
    if (!project) throw new Error('Failed to create project')
    return project
  }

  async updateProject(args: {
    instructions?: string | null
    name?: string
    parentId?: string | null
    projectId: string
    userId: string
    workspaceId?: string
  }): Promise<ProjectRecord | null> {
    const existing = await this.getProject(args)
    if (!existing) return null
    await convex.mutation('projects/projects:update', {
      projectId: args.projectId as Id<'projects'>,
      userId: args.userId,
      serverSecret: this.serverSecret,
      instructions: args.instructions,
      name: args.name,
      parentId: args.parentId,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    }, { throwOnError: true })
    return await this.getProject(args)
  }

  async deleteProjectTree(args: {
    projectId: string
    userId: string
    workspaceId?: string
  }): Promise<DeleteProjectTreeResult | null> {
    const root = await this.getProject(args)
    if (!root) return null
    const allProjects = await this.listProjects({
      includeDeleted: true,
      userId: args.userId,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    })
    const deletedIds = collectDescendants(allProjects, args.projectId)
    for (const projectId of [...deletedIds].reverse()) {
      await convex.mutation('projects/projects:remove', {
        projectId: projectId as Id<'projects'>,
        userId: args.userId,
        serverSecret: this.serverSecret,
        ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
      }, { throwOnError: true })
    }
    return {
      deletedAt: Date.now(),
      deletedIds,
      deletedConversationIds: [],
      deletedFileIds: [],
      deletedMemoryIds: [],
      deletedNoteIds: [],
    }
  }
}

function collectDescendants(projects: ProjectRecord[], rootId: string): string[] {
  const result = [rootId]
  const seen = new Set(result)
  for (let index = 0; index < result.length; index += 1) {
    const current = result[index]!
    for (const project of projects) {
      if (project.parentId !== current || project.deletedAt || seen.has(project._id)) continue
      seen.add(project._id)
      result.push(project._id)
    }
  }
  return result
}
