import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import type {
  KnowledgeBaseRepositories,
  KnowledgeSource,
  KnowledgeSourceKind,
  KnowledgeSourceVersion,
} from '@overlay/app-core'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import { KnowledgeBaseService, KnowledgeBaseServiceError } from './KnowledgeBaseService'

export type CanonicalKnowledgeIndexRequest = {
  contentHash: string
  sourceId: string
  sourceVersionId: string
  userId: string
}

export interface CanonicalKnowledgeIndexQueue {
  enqueue(request: CanonicalKnowledgeIndexRequest): Promise<string>
  purge(request: { sourceId: string; userId: string }): Promise<void>
}

export class KnowledgeSourceIngestionService {
  constructor(private readonly deps: {
    authorization: AuthorizationService
    bases: KnowledgeBaseService
    indexQueue: CanonicalKnowledgeIndexQueue
    repositories: KnowledgeBaseRepositories
  }) {}

  async createTextSource(args: {
    content: string
    knowledgeBaseId: string
    kind?: KnowledgeSourceKind
    mimeType?: string
    title: string
    userId: string
  }): Promise<{ source: KnowledgeSource; version: KnowledgeSourceVersion; jobId: string }> {
    const content = requiredContent(args.content)
    const contentHash = hash(content)
    const detail = await this.deps.bases.createAndAttachSource({
      knowledgeBaseId: args.knowledgeBaseId,
      kind: args.kind ?? 'text',
      metadata: { content },
      mimeType: args.mimeType ?? 'text/plain',
      title: args.title,
      userId: args.userId,
    })
    try {
      const version = await this.deps.repositories.sources.createVersion({
        id: randomUUID(),
        sourceId: detail.source.id,
        version: 1,
        contentHash,
        status: 'indexing',
        metadata: { content },
      })
      const source = await this.requireUpdatedSource(detail.source.id, {
        contentHash,
        metadata: { content },
        status: 'indexing',
        statusMessage: undefined,
      })
      const jobId = await this.deps.indexQueue.enqueue({
        contentHash,
        sourceId: source.id,
        sourceVersionId: version.id,
        userId: args.userId,
      })
      return { source, version, jobId }
    } catch (error) {
      await this.deps.bases.deleteCanonicalSource({ sourceId: detail.source.id, userId: args.userId })
        .catch((_error) => {})
      throw error
    }
  }

  async replaceTextSource(args: {
    content: string
    sourceId: string
    userId: string
  }): Promise<{ source: KnowledgeSource; version: KnowledgeSourceVersion; jobId?: string; unchanged: boolean }> {
    const source = await this.requireOwnedEditableSource(args.sourceId, args.userId)
    const content = requiredContent(args.content)
    const contentHash = hash(content)
    const versions = await this.deps.repositories.sources.listVersions(source.id)
    const existing = versions.find((version) => version.contentHash === contentHash)
    if (existing?.status === 'ready' && source.contentHash === contentHash) {
      return { source, version: existing, unchanged: true }
    }
    const version = existing ?? await this.deps.repositories.sources.createVersion({
      id: randomUUID(),
      sourceId: source.id,
      version: Math.max(0, ...versions.map((entry) => entry.version)) + 1,
      contentHash,
      status: 'indexing',
      metadata: { ...source.metadata, content },
    })
    if (existing) {
      await this.deps.repositories.sources.updateVersion({
        id: existing.id,
        status: 'indexing',
        metadata: { ...existing.metadata, content },
      })
    }
    const updated = await this.requireUpdatedSource(source.id, {
      contentHash,
      metadata: { ...source.metadata, content },
      status: 'indexing',
      statusMessage: undefined,
    })
    const jobId = await this.deps.indexQueue.enqueue({
      contentHash,
      sourceId: source.id,
      sourceVersionId: version.id,
      userId: args.userId,
    })
    return { source: updated, version: { ...version, status: 'indexing' }, jobId, unchanged: false }
  }

  async retry(args: { sourceId: string; userId: string }): Promise<string> {
    const source = await this.requireOwnedEditableSource(args.sourceId, args.userId)
    const [version] = await this.deps.repositories.sources.listVersions(source.id)
    if (!version) throw new KnowledgeBaseServiceError('Knowledge source has no version to retry', 409)
    await Promise.all([
      this.deps.repositories.sources.update({
        id: source.id,
        status: 'indexing',
        statusMessage: undefined,
      }),
      this.deps.repositories.sources.updateVersion({ id: version.id, status: 'indexing' }),
    ])
    return await this.deps.indexQueue.enqueue({
      contentHash: version.contentHash,
      sourceId: source.id,
      sourceVersionId: version.id,
      userId: args.userId,
    })
  }

  async delete(args: { sourceId: string; userId: string }): Promise<void> {
    const source = await this.requireOwnedEditableSource(args.sourceId, args.userId, 'knowledge.delete')
    await this.deps.bases.deleteCanonicalSource(args)
    await this.deps.indexQueue.purge({ sourceId: source.id, userId: args.userId })
  }

  private async requireOwnedEditableSource(
    sourceId: string,
    userId: string,
    capability: 'knowledge.edit' | 'knowledge.delete' = 'knowledge.edit',
  ): Promise<KnowledgeSource> {
    const [source, subject] = await Promise.all([
      this.deps.repositories.sources.get(sourceId),
      this.deps.authorization.assertCapability({ userId, capability }),
    ])
    if (!source || (source.ownerUserId !== userId && !subject.isDeploymentOwner)) {
      throw new KnowledgeBaseServiceError('Knowledge source not found', 404)
    }
    return source
  }

  private async requireUpdatedSource(
    id: string,
    patch: Omit<Parameters<KnowledgeBaseRepositories['sources']['update']>[0], 'id'>,
  ): Promise<KnowledgeSource> {
    const updated = await this.deps.repositories.sources.update({ ...patch, id })
    if (!updated) throw new KnowledgeBaseServiceError('Knowledge source not found', 404)
    return updated
  }
}

function requiredContent(value: string): string {
  const content = value.trim()
  if (!content) throw new KnowledgeBaseServiceError('source content is required', 400)
  if (Buffer.byteLength(content, 'utf8') > 12 * 1024 * 1024) {
    throw new KnowledgeBaseServiceError('source content exceeds the 12 MB extraction limit', 413)
  }
  return content
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
