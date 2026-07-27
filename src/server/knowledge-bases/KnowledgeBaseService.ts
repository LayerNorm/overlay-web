import 'server-only'

import { randomUUID } from 'node:crypto'
import { MAX_KNOWLEDGE_BASES_PER_TURN } from '@overlay/app-core'
import type {
  KnowledgeBase,
  KnowledgeBaseConversation,
  KnowledgeBaseRepositories,
  KnowledgeBaseSource,
  KnowledgeSource,
  KnowledgeSourceKind,
  ProjectKnowledgeBase,
} from '@overlay/app-core'
import type {
  AuthorizationCapability,
  AuthorizationPrincipalType,
  AuthorizationRepositories,
  AuthorizationSubject,
  ResourceAccessRole,
  ResourceAction,
  ResourceGrant,
} from '@overlay/authz-contracts'
import {
  AuthorizationDeniedError,
  AuthorizationService,
} from '@/server/authorization/AuthorizationService'
import type { UserDirectoryEntry, UserRepository } from '@/server/users'

export const KNOWLEDGE_BASE_RESOURCE_TYPE = 'knowledge_base'

export type KnowledgeBaseSourceDetail = {
  membership: KnowledgeBaseSource
  source: KnowledgeSource
}

export type KnowledgeBaseShareDirectory = {
  users: UserDirectoryEntry[]
  groups: Array<{ id: string; name: string; description?: string }>
  roles: Array<{ id: string; name: string; description?: string }>
}

export type AdministrativeKnowledgeBase = KnowledgeBase & {
  grantCount: number
  sourceCount: number
}

export class KnowledgeBaseServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message)
    this.name = 'KnowledgeBaseServiceError'
  }
}

export class KnowledgeBaseService {
  constructor(private readonly deps: {
    authorization: AuthorizationService
    authorizationRepositories: AuthorizationRepositories
    repositories: KnowledgeBaseRepositories
    users?: UserRepository
  }) {}

  async listKnowledgeBases(userId: string): Promise<KnowledgeBase[]> {
    const subject = await this.requireCapability(userId, 'knowledge.read')
    const [owned, sharedIds] = await Promise.all([
      this.deps.repositories.bases.listForOwner(userId),
      this.deps.authorization.listAccessibleResourceIds({
        action: 'view',
        resourceType: KNOWLEDGE_BASE_RESOURCE_TYPE,
        subject,
      }),
    ])
    const ownedIds = new Set(owned.map(({ id }) => id))
    const shared = (await Promise.all(sharedIds
      .filter((id) => !ownedIds.has(id))
      .map((id) => this.deps.repositories.bases.get(id))))
      .filter((value): value is KnowledgeBase => Boolean(value?.status === 'active'))
    return [...owned, ...shared]
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  }

  async listAdministrativeKnowledgeBases(userId: string): Promise<AdministrativeKnowledgeBase[]> {
    await Promise.all([
      this.requireCapability(userId, 'administration.access'),
      this.requireCapability(userId, 'knowledge.publish'),
    ])
    const bases = await this.deps.repositories.bases.listAll({ includeArchived: true })
    return await Promise.all(bases.map(async (base) => {
      const [memberships, grants] = await Promise.all([
        this.deps.repositories.memberships.listForBase(base.id),
        this.deps.authorizationRepositories.resourceGrants.listForResource({
          resourceType: KNOWLEDGE_BASE_RESOURCE_TYPE,
          resourceId: base.id,
        }),
      ])
      return { ...base, sourceCount: memberships.length, grantCount: grants.length }
    }))
  }

  async listShareDirectory(userId: string): Promise<KnowledgeBaseShareDirectory> {
    await this.requireCapability(userId, 'knowledge.share')
    if (!this.deps.users?.listDirectory) {
      throw new KnowledgeBaseServiceError('User directory is not available', 503)
    }
    const [users, groups, roles] = await Promise.all([
      this.deps.users.listDirectory(),
      this.deps.authorizationRepositories.groups.list(),
      this.deps.authorizationRepositories.roles.list(),
    ])
    return {
      users,
      groups: groups.map(({ id, name, description }) => ({ id, name, description })),
      roles: roles.map(({ id, name, description }) => ({ id, name, description })),
    }
  }

  async getKnowledgeBase(args: { knowledgeBaseId: string; userId: string }): Promise<KnowledgeBase> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('view', 'knowledge.read', base, args.userId)
    return base
  }

  async createKnowledgeBase(args: {
    description?: string
    kind?: 'personal' | 'organization'
    title: string
    userId: string
  }): Promise<KnowledgeBase> {
    await this.requireCapability(args.userId, 'knowledge.create')
    if (args.kind === 'organization') {
      await this.requireCapability(args.userId, 'knowledge.publish')
    }
    return await this.deps.repositories.bases.create({
      id: randomUUID(),
      ownerUserId: args.userId,
      title: requiredTitle(args.title),
      description: normalizeOptional(args.description),
      kind: args.kind ?? 'personal',
      createdBy: args.userId,
    })
  }

  async updateKnowledgeBase(args: {
    description?: string
    kind?: 'personal' | 'organization'
    knowledgeBaseId: string
    title?: string
    userId: string
  }): Promise<KnowledgeBase> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('edit', 'knowledge.edit', base, args.userId)
    if (args.kind === 'organization' && base.kind !== 'organization') {
      await this.requireCapability(args.userId, 'knowledge.publish')
    }
    const updated = await this.deps.repositories.bases.update({
      id: base.id,
      title: args.title === undefined ? undefined : requiredTitle(args.title),
      description: args.description === undefined ? undefined : normalizeOptional(args.description),
      kind: args.kind,
    })
    if (!updated) throw notFound('Knowledge base')
    return updated
  }

  async archiveKnowledgeBase(args: { knowledgeBaseId: string; userId: string }): Promise<void> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('delete', 'knowledge.delete', base, args.userId)
    if (!await this.deps.repositories.bases.archive(base.id)) throw notFound('Knowledge base')
  }

  async deleteKnowledgeBase(args: { knowledgeBaseId: string; userId: string }): Promise<void> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('delete', 'knowledge.delete', base, args.userId)
    const grants = await this.deps.authorizationRepositories.resourceGrants.listForResource({
      resourceType: KNOWLEDGE_BASE_RESOURCE_TYPE,
      resourceId: base.id,
    })
    await Promise.all(grants.map(({ id }) => (
      this.deps.authorizationRepositories.resourceGrants.remove(id)
    )))
    if (!await this.deps.repositories.bases.remove(base.id)) throw notFound('Knowledge base')
  }

  async createAndAttachSource(args: {
    knowledgeBaseId: string
    kind: KnowledgeSourceKind
    metadata?: Record<string, unknown>
    mimeType?: string
    sourceRef?: string
    title: string
    userId: string
  }): Promise<KnowledgeBaseSourceDetail> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('edit', 'knowledge.edit', base, args.userId)
    const source = await this.deps.repositories.sources.create({
      id: randomUUID(),
      ownerUserId: args.userId,
      kind: args.kind,
      sourceRef: normalizeOptional(args.sourceRef),
      title: requiredTitle(args.title),
      mimeType: normalizeOptional(args.mimeType),
      metadata: args.metadata ?? {},
      createdBy: args.userId,
    })
    try {
      const membership = await this.deps.repositories.memberships.add({
        knowledgeBaseId: base.id,
        sourceId: source.id,
        addedBy: args.userId,
        enabled: true,
      })
      return { membership, source }
    } catch (error) {
      await this.deps.repositories.sources.markDeleted(source.id).catch((_error) => {})
      throw error
    }
  }

  async attachExistingSource(args: {
    knowledgeBaseId: string
    sourceId: string
    userId: string
  }): Promise<KnowledgeBaseSourceDetail> {
    const [base, source, subject] = await Promise.all([
      this.requiredBase(args.knowledgeBaseId),
      this.requiredSource(args.sourceId),
      this.deps.authorization.resolveSubject(args.userId),
    ])
    await this.assertResolvedBaseAccess('edit', 'knowledge.edit', base, subject)
    if (source.ownerUserId !== args.userId && !subject.isDeploymentOwner) {
      throw notFound('Knowledge source')
    }
    const membership = await this.deps.repositories.memberships.add({
      knowledgeBaseId: base.id,
      sourceId: source.id,
      addedBy: args.userId,
      enabled: true,
    })
    return { membership, source }
  }

  async listSources(args: {
    knowledgeBaseId: string
    userId: string
  }): Promise<KnowledgeBaseSourceDetail[]> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('view', 'knowledge.read', base, args.userId)
    const memberships = await this.deps.repositories.memberships.listForBase(base.id)
    const details = await Promise.all(memberships.map(async (membership) => ({
      membership,
      source: await this.deps.repositories.sources.get(membership.sourceId),
    })))
    return details
      .filter((value): value is KnowledgeBaseSourceDetail => Boolean(value.source))
      .sort((a, b) => a.membership.createdAt - b.membership.createdAt)
  }

  async setSourceEnabled(args: {
    enabled: boolean
    knowledgeBaseId: string
    sourceId: string
    userId: string
  }): Promise<void> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('edit', 'knowledge.edit', base, args.userId)
    if (!await this.deps.repositories.memberships.setEnabled({
      knowledgeBaseId: args.knowledgeBaseId,
      sourceId: args.sourceId,
      enabled: args.enabled,
    })) throw notFound('Knowledge source')
  }

  async removeSource(args: {
    knowledgeBaseId: string
    sourceId: string
    userId: string
  }): Promise<void> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('edit', 'knowledge.edit', base, args.userId)
    if (!await this.deps.repositories.memberships.remove({
      knowledgeBaseId: args.knowledgeBaseId,
      sourceId: args.sourceId,
    })) throw notFound('Knowledge source')
  }

  async deleteCanonicalSource(args: { sourceId: string; userId: string }): Promise<void> {
    const [source, subject] = await Promise.all([
      this.requiredSource(args.sourceId),
      this.requireCapability(args.userId, 'knowledge.delete'),
    ])
    if (source.ownerUserId !== args.userId && !subject.isDeploymentOwner) {
      throw notFound('Knowledge source')
    }
    const memberships = await this.deps.repositories.memberships.listBasesForSource(source.id)
    await Promise.all(memberships.map((membership) => (
      this.deps.repositories.memberships.remove(membership)
    )))
    if (!await this.deps.repositories.sources.markDeleted(source.id)) throw notFound('Knowledge source')
  }

  async attachConversation(args: {
    conversationId: string
    knowledgeBaseId: string
    userId: string
  }): Promise<KnowledgeBaseConversation> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    const conversationOwnerUserId = await this.deps.authorization.getResourceOwner({
      resourceId: args.conversationId,
      resourceType: 'conversation',
    })
    if (!conversationOwnerUserId) throw notFound('Conversation')
    await Promise.all([
      this.assertBaseAccess('view', 'knowledge.read', base, args.userId),
      this.deps.authorization.assertResourceAccess({
        action: 'edit',
        capability: 'conversations.edit',
        ownerUserId: conversationOwnerUserId,
        resourceId: args.conversationId,
        resourceType: 'conversation',
        userId: args.userId,
      }).catch(mapAuthorizationError),
    ])
    return await this.deps.repositories.conversations.attach({
      knowledgeBaseId: base.id,
      conversationId: args.conversationId,
      createdBy: args.userId,
    })
  }

  /**
   * @deprecated A conversation may ground against several bases.
   * Prefer {@link listConversationKnowledgeBases}.
   */
  async getConversationKnowledgeBase(args: {
    conversationId: string
    userId: string
  }): Promise<KnowledgeBase | null> {
    const [first] = await this.listConversationKnowledgeBases(args)
    return first ?? null
  }

  /**
   * Bases attached to a conversation that this user may actually read. Bases the
   * caller cannot see are omitted rather than raising, so a revoked share does
   * not break an existing chat.
   */
  async listConversationKnowledgeBases(args: {
    conversationId: string
    userId: string
  }): Promise<KnowledgeBase[]> {
    const attachments = await this.deps.repositories.conversations
      .listForConversation(args.conversationId)
    if (attachments.length === 0) return []
    const conversationOwnerUserId = await this.deps.authorization.getResourceOwner({
      resourceId: args.conversationId,
      resourceType: 'conversation',
    })
    if (!conversationOwnerUserId) throw notFound('Conversation')
    await this.deps.authorization.assertResourceAccess({
      action: 'view',
      capability: 'conversations.read',
      ownerUserId: conversationOwnerUserId,
      resourceId: args.conversationId,
      resourceType: 'conversation',
      userId: args.userId,
    }).catch(mapAuthorizationError)
    return await this.readableBases(attachments.map(({ knowledgeBaseId }) => knowledgeBaseId), args.userId)
  }

  async listProjectKnowledgeBases(args: {
    projectId: string
    userId: string
  }): Promise<KnowledgeBase[]> {
    const attachments = await this.deps.repositories.projects.listForProject(args.projectId)
    if (attachments.length === 0) return []
    return await this.readableBases(attachments.map(({ knowledgeBaseId }) => knowledgeBaseId), args.userId)
  }

  /**
   * Attaches a base to a project. Requires read access to the base, so a user
   * cannot widen a project's corpus with knowledge they cannot see themselves.
   * Project ownership is verified by the caller.
   */
  async attachProjectKnowledgeBase(args: {
    knowledgeBaseId: string
    projectId: string
    userId: string
  }): Promise<ProjectKnowledgeBase> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('view', 'knowledge.read', base, args.userId)
    const existing = await this.deps.repositories.projects.listForProject(args.projectId)
    if (
      existing.length >= MAX_KNOWLEDGE_BASES_PER_TURN
      && !existing.some(({ knowledgeBaseId }) => knowledgeBaseId === base.id)
    ) {
      throw new KnowledgeBaseServiceError(
        `A project can attach at most ${MAX_KNOWLEDGE_BASES_PER_TURN} knowledge bases`,
        400,
      )
    }
    return await this.deps.repositories.projects.attach({
      knowledgeBaseId: base.id,
      projectId: args.projectId,
      attachedBy: args.userId,
    })
  }

  async detachProjectKnowledgeBase(args: {
    knowledgeBaseId: string
    projectId: string
  }): Promise<void> {
    if (!await this.deps.repositories.projects.detach({
      knowledgeBaseId: args.knowledgeBaseId,
      projectId: args.projectId,
    })) throw notFound('Project knowledge base')
  }

  /** Filters to bases that exist, are active, and are readable by this user. */
  private async readableBases(ids: string[], userId: string): Promise<KnowledgeBase[]> {
    const bases = await Promise.all(ids.map(async (knowledgeBaseId) => {
      try {
        return await this.getKnowledgeBase({ knowledgeBaseId, userId })
      } catch (_error) {
        return null
      }
    }))
    return bases.filter((base): base is KnowledgeBase => Boolean(base))
  }

  async listUserConversationAttachments(args: {
    knowledgeBaseId: string
    userId: string
  }): Promise<KnowledgeBaseConversation[]> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('view', 'knowledge.read', base, args.userId)
    const attachments = await this.deps.repositories.conversations.listForBase(base.id)
    const owned = await Promise.all(attachments.map(async (attachment) => ({
      attachment,
      ownerUserId: await this.deps.authorization.getResourceOwner({
        resourceId: attachment.conversationId,
        resourceType: 'conversation',
      }),
    })))
    return owned
      .filter(({ ownerUserId }) => ownerUserId === args.userId)
      .map(({ attachment }) => attachment)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Detaches one base when `knowledgeBaseId` is given, otherwise all of them. */
  async detachConversation(args: {
    conversationId: string
    knowledgeBaseId?: string
    userId: string
  }): Promise<void> {
    const attachments = await this.deps.repositories.conversations
      .listForConversation(args.conversationId)
    if (attachments.length === 0) return
    const conversationOwnerUserId = await this.deps.authorization.getResourceOwner({
      resourceId: args.conversationId,
      resourceType: 'conversation',
    })
    if (!conversationOwnerUserId) throw notFound('Conversation')
    await this.deps.authorization.assertResourceAccess({
      action: 'edit',
      capability: 'conversations.edit',
      ownerUserId: conversationOwnerUserId,
      resourceId: args.conversationId,
      resourceType: 'conversation',
      userId: args.userId,
    }).catch(mapAuthorizationError)
    if (!args.knowledgeBaseId) {
      await this.deps.repositories.conversations.detach(args.conversationId)
      return
    }
    if (!attachments.some(({ knowledgeBaseId }) => knowledgeBaseId === args.knowledgeBaseId)) {
      throw notFound('Knowledge base')
    }
    await this.deps.repositories.conversations.detachOne({
      conversationId: args.conversationId,
      knowledgeBaseId: args.knowledgeBaseId,
    })
  }

  async listShares(args: {
    knowledgeBaseId: string
    userId: string
  }): Promise<ResourceGrant[]> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('share', 'knowledge.share', base, args.userId)
    return await this.deps.authorizationRepositories.resourceGrants.listForResource({
      resourceType: KNOWLEDGE_BASE_RESOURCE_TYPE,
      resourceId: base.id,
    })
  }

  async shareKnowledgeBase(args: {
    accessRole: Exclude<ResourceAccessRole, 'owner'>
    knowledgeBaseId: string
    principalId: string
    principalType: AuthorizationPrincipalType
    userId: string
  }): Promise<ResourceGrant> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('share', 'knowledge.share', base, args.userId)
    const principalId = args.principalId.trim()
    if (!principalId) throw new KnowledgeBaseServiceError('principalId is required', 400)
    if (args.accessRole !== 'viewer' && args.accessRole !== 'editor') {
      throw new KnowledgeBaseServiceError('Knowledge bases can be shared as viewer or editor', 400)
    }
    await this.requireSharePrincipal(args.principalType, principalId)
    return await this.deps.authorizationRepositories.resourceGrants.upsert({
      id: randomUUID(),
      resourceType: KNOWLEDGE_BASE_RESOURCE_TYPE,
      resourceId: base.id,
      principalType: args.principalType,
      principalId,
      accessRole: args.accessRole,
      grantedBy: args.userId,
    })
  }

  async revokeKnowledgeBaseShare(args: {
    grantId: string
    knowledgeBaseId: string
    userId: string
  }): Promise<void> {
    const shares = await this.listShares(args)
    const grant = shares.find(({ id }) => id === args.grantId)
    if (!grant) throw notFound('Knowledge base share')
    if (!await this.deps.authorizationRepositories.resourceGrants.remove(grant.id)) {
      throw notFound('Knowledge base share')
    }
  }

  private async requireSharePrincipal(
    principalType: AuthorizationPrincipalType,
    principalId: string,
  ): Promise<void> {
    if (principalType === 'user') {
      if (this.deps.users?.listDirectory) {
        const users = await this.deps.users.listDirectory()
        if (!users.some(({ id }) => id === principalId)) throw notFound('User')
      }
      return
    }
    if (principalType === 'group') {
      const group = await this.deps.authorizationRepositories.groups.get(principalId)
      if (!group || group.archivedAt) throw notFound('Authorization group')
      return
    }
    const role = await this.deps.authorizationRepositories.roles.get(principalId)
    if (!role || role.archivedAt) throw notFound('Authorization role')
  }

  private async requiredBase(id: string): Promise<KnowledgeBase> {
    const base = await this.deps.repositories.bases.get(id)
    if (!base || base.status !== 'active') throw notFound('Knowledge base')
    return base
  }

  private async requiredSource(id: string): Promise<KnowledgeSource> {
    const source = await this.deps.repositories.sources.get(id)
    if (!source) throw notFound('Knowledge source')
    return source
  }

  private async requireCapability(
    userId: string,
    capability: AuthorizationCapability,
  ): Promise<AuthorizationSubject> {
    try {
      return await this.deps.authorization.assertCapability({ userId, capability })
    } catch (error) {
      mapAuthorizationError(error)
    }
  }

  private async assertBaseAccess(
    action: ResourceAction,
    capability: AuthorizationCapability,
    base: KnowledgeBase,
    userId: string,
  ): Promise<void> {
    try {
      await this.deps.authorization.assertResourceAccess({
        action,
        capability,
        ownerUserId: base.ownerUserId,
        resourceId: base.id,
        resourceType: KNOWLEDGE_BASE_RESOURCE_TYPE,
        userId,
      })
    } catch (error) {
      mapAuthorizationError(error)
    }
  }

  private async assertResolvedBaseAccess(
    action: ResourceAction,
    capability: AuthorizationCapability,
    base: KnowledgeBase,
    subject: AuthorizationSubject,
  ): Promise<void> {
    const decision = await this.deps.authorization.checkResolvedResourceAccess({
      action,
      capability,
      ownerUserId: base.ownerUserId,
      resourceId: base.id,
      resourceType: KNOWLEDGE_BASE_RESOURCE_TYPE,
      subject,
    })
    if (!decision.allowed) mapAuthorizationError(new AuthorizationDeniedError(decision))
  }
}

function requiredTitle(value: string): string {
  const title = value.trim()
  if (!title) throw new KnowledgeBaseServiceError('title is required', 400)
  if (title.length > 160) throw new KnowledgeBaseServiceError('title must be 160 characters or fewer', 400)
  return title
}

function normalizeOptional(value: string | undefined): string | undefined {
  return value?.trim() || undefined
}

function notFound(resource: string): KnowledgeBaseServiceError {
  return new KnowledgeBaseServiceError(`${resource} not found`, 404)
}

function mapAuthorizationError(error: unknown): never {
  if (error instanceof AuthorizationDeniedError) throw notFound('Knowledge base')
  throw error
}
