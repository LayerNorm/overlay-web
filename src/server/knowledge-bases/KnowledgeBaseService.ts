import 'server-only'

import { randomUUID } from 'node:crypto'
import type {
  KnowledgeBase,
  KnowledgeBaseConversation,
  KnowledgeBaseRepositories,
  KnowledgeBaseSource,
  KnowledgeSource,
  KnowledgeSourceKind,
} from '@overlay/app-core'
import type {
  AuthorizationCapability,
  AuthorizationRepositories,
  AuthorizationSubject,
  ResourceAction,
} from '@overlay/authz-contracts'
import {
  AuthorizationDeniedError,
  AuthorizationService,
} from '@/server/authorization/AuthorizationService'

export const KNOWLEDGE_BASE_RESOURCE_TYPE = 'knowledge_base'

export type KnowledgeBaseSourceDetail = {
  membership: KnowledgeBaseSource
  source: KnowledgeSource
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
    if (!await this.deps.repositories.memberships.setEnabled(args)) throw notFound('Knowledge source')
  }

  async removeSource(args: {
    knowledgeBaseId: string
    sourceId: string
    userId: string
  }): Promise<void> {
    const base = await this.requiredBase(args.knowledgeBaseId)
    await this.assertBaseAccess('edit', 'knowledge.edit', base, args.userId)
    if (!await this.deps.repositories.memberships.remove(args)) throw notFound('Knowledge source')
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
      this.assertBaseAccess('edit', 'knowledge.edit', base, args.userId),
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
