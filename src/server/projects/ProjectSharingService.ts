import 'server-only'

import { randomUUID } from 'node:crypto'
import type {
  AuthorizationPrincipalType,
  AuthorizationRepositories,
  ResourceAccessRole,
  ResourceGrant,
} from '@overlay/authz-contracts'
import type { AuditService } from '@/server/admin'
import {
  AuthorizationDeniedError,
  type AuthorizationService,
} from '@/server/authorization/AuthorizationService'
import type { UserDirectoryEntry, UserRepository } from '@/server/users'
import type { ProjectRepository } from './ProjectRepository'
import { ProjectServiceError } from './ProjectService'

const PROJECT_RESOURCE_TYPE = 'project'

export type ProjectShareDirectory = {
  users: UserDirectoryEntry[]
  groups: Array<{ id: string; name: string; description?: string }>
  roles: Array<{ id: string; name: string; description?: string }>
}

export class ProjectSharingService {
  constructor(private readonly deps: {
    audit?: AuditService
    authorization: AuthorizationService
    authorizationRepositories: AuthorizationRepositories
    projects: ProjectRepository
    users: UserRepository
  }) {}

  async listDirectory(userId: string): Promise<ProjectShareDirectory> {
    await this.requireShareCapability(userId)
    if (!this.deps.users.listDirectory) {
      throw new ProjectServiceError('User directory is not available', 503)
    }
    const [users, groups, roles] = await Promise.all([
      this.deps.users.listDirectory(),
      this.deps.authorizationRepositories.groups.list(),
      this.deps.authorizationRepositories.roles.list(),
    ])
    return {
      users,
      groups: groups
        .filter(({ archivedAt }) => !archivedAt)
        .map(({ id, name, description }) => ({ id, name, description })),
      roles: roles
        .filter(({ archivedAt }) => !archivedAt)
        .map(({ id, name, description }) => ({ id, name, description })),
    }
  }

  async listShares(args: {
    projectId: string
    userId: string
  }): Promise<ResourceGrant[]> {
    await this.requireOwnedProject(args)
    return await this.deps.authorizationRepositories.resourceGrants.listForResource({
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: args.projectId,
    })
  }

  async shareProject(args: {
    accessRole: Exclude<ResourceAccessRole, 'owner'>
    principalId: string
    principalType: AuthorizationPrincipalType
    projectId: string
    userId: string
  }): Promise<ResourceGrant> {
    await this.requireOwnedProject(args)
    const principalId = args.principalId.trim()
    if (!principalId) throw new ProjectServiceError('principalId is required', 400)
    if (args.accessRole !== 'viewer' && args.accessRole !== 'editor') {
      throw new ProjectServiceError('Projects can be shared as viewer or editor', 400)
    }
    await this.requirePrincipal(args.principalType, principalId)
    const grant = await this.deps.authorizationRepositories.resourceGrants.upsert({
      id: randomUUID(),
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: args.projectId,
      principalType: args.principalType,
      principalId,
      accessRole: args.accessRole,
      grantedBy: args.userId,
    })
    await this.audit('project.share.grant', args, {
      grantId: grant.id,
      principalType: args.principalType,
      principalId,
      accessRole: args.accessRole,
    })
    return grant
  }

  async revokeProjectShare(args: {
    grantId: string
    projectId: string
    userId: string
  }): Promise<void> {
    const grants = await this.listShares(args)
    const grant = grants.find(({ id }) => id === args.grantId)
    if (!grant) throw new ProjectServiceError('Project share not found', 404)
    if (!await this.deps.authorizationRepositories.resourceGrants.remove(grant.id)) {
      throw new ProjectServiceError('Project share not found', 404)
    }
    await this.audit('project.share.revoke', args, {
      grantId: grant.id,
      principalType: grant.principalType,
      principalId: grant.principalId,
      accessRole: grant.accessRole,
    })
  }

  private async requireOwnedProject(args: {
    projectId: string
    userId: string
  }): Promise<void> {
    await this.requireShareCapability(args.userId)
    const project = await this.deps.projects.getProject(args)
    if (!project) throw new ProjectServiceError('Not found', 404)
  }

  private async requireShareCapability(userId: string): Promise<void> {
    try {
      await this.deps.authorization.assertCapability({
        capability: 'projects.share',
        userId,
      })
    } catch (error) {
      if (error instanceof AuthorizationDeniedError) {
        throw new ProjectServiceError('Not found', 404)
      }
      throw error
    }
  }

  private async requirePrincipal(
    principalType: AuthorizationPrincipalType,
    principalId: string,
  ): Promise<void> {
    if (principalType === 'user') {
      const users = await this.deps.users.listDirectory?.()
      if (!users?.some(({ id }) => id === principalId)) {
        throw new ProjectServiceError('User not found', 404)
      }
      return
    }
    if (principalType === 'group') {
      const group = await this.deps.authorizationRepositories.groups.get(principalId)
      if (!group || group.archivedAt) throw new ProjectServiceError('Group not found', 404)
      return
    }
    const role = await this.deps.authorizationRepositories.roles.get(principalId)
    if (!role || role.archivedAt) throw new ProjectServiceError('Role not found', 404)
  }

  private async audit(
    action: string,
    args: { projectId: string; userId: string },
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit?.record({
      action,
      actorType: 'user',
      actorUserId: args.userId,
      outcome: 'success',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: args.projectId,
      metadata,
    })
  }
}
