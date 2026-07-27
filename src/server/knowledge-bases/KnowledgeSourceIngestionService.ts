import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import {
  isExternalKnowledgeSourceKind,
  type ExternalKnowledgeSourceKind,
  type KnowledgeBaseRepositories,
  type KnowledgeSource,
  type KnowledgeSourceKind,
  type KnowledgeSourceVersion,
} from '@overlay/app-core'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import {
  inferOriginFromKind,
  readSourceProvenance,
  withSourceProvenance,
  type KnowledgeSourceProvenance,
} from '@/shared/knowledge/source-provenance'
import type { KnowledgeSourceFetcherRegistry } from './KnowledgeSourceFetcher'
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
    /** Absent when the deployment has no external source fetchers enabled. */
    fetchers?: KnowledgeSourceFetcherRegistry
    indexQueue: CanonicalKnowledgeIndexQueue
    repositories: KnowledgeBaseRepositories
  }) {}

  async createTextSource(args: {
    content: string
    knowledgeBaseId: string
    kind?: KnowledgeSourceKind
    metadata?: Record<string, unknown>
    mimeType?: string
    /** Where this content came from; recorded so citations stay attributable. */
    provenance?: Partial<KnowledgeSourceProvenance>
    sourceRef?: string
    title: string
    userId: string
  }): Promise<{ source: KnowledgeSource; version: KnowledgeSourceVersion; jobId: string }> {
    const content = requiredContent(args.content)
    const contentHash = hash(content)
    const kind = args.kind ?? 'text'
    const metadata = withSourceProvenance({ ...args.metadata, content }, {
      origin: args.provenance?.origin ?? inferOriginFromKind(kind),
      ref: args.provenance?.ref ?? args.sourceRef,
      label: args.provenance?.label,
      promotedFromProjectId: args.provenance?.promotedFromProjectId,
      promotedFromArtifactId: args.provenance?.promotedFromArtifactId,
      addedBy: args.userId,
      ingestedAt: Date.now(),
      originUpdatedAt: args.provenance?.originUpdatedAt,
    })
    const detail = await this.deps.bases.createAndAttachSource({
      knowledgeBaseId: args.knowledgeBaseId,
      kind,
      metadata,
      mimeType: args.mimeType ?? 'text/plain',
      sourceRef: args.sourceRef,
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
        metadata,
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

  /**
   * Ingests an external source by fetching its content, then storing it through
   * the same text path so extraction, chunking, indexing, and retrieval behave
   * identically regardless of origin.
   */
  async createExternalSource(args: {
    kind: ExternalKnowledgeSourceKind
    knowledgeBaseId: string
    ref: string
    title?: string
    userId: string
  }): Promise<{ source: KnowledgeSource; version: KnowledgeSourceVersion; jobId: string }> {
    if (!this.deps.fetchers) {
      throw new KnowledgeBaseServiceError('External knowledge sources are not enabled', 501)
    }
    const fetched = await this.deps.fetchers.require(args.kind).fetch({
      ref: args.ref,
      userId: args.userId,
    })
    return await this.createTextSource({
      content: fetched.content,
      knowledgeBaseId: args.knowledgeBaseId,
      kind: args.kind,
      mimeType: fetched.mimeType,
      provenance: {
        origin: args.kind,
        ref: fetched.ref,
        label: fetched.label,
        originUpdatedAt: fetched.originUpdatedAt,
      },
      sourceRef: fetched.ref,
      title: args.title?.trim() || fetched.title || fetched.ref,
      userId: args.userId,
    })
  }

  /**
   * Re-fetches an external source and replaces its content when the origin has
   * changed. Unchanged content is a no-op so refreshing is cheap.
   */
  async refreshExternalSource(args: { sourceId: string; userId: string }): Promise<{
    unchanged: boolean
    source: KnowledgeSource
  }> {
    const source = await this.requireOwnedEditableSource(args.sourceId, args.userId)
    if (!isExternalKnowledgeSourceKind(source.kind)) {
      throw new KnowledgeBaseServiceError('Only external sources can be refreshed', 400)
    }
    if (!this.deps.fetchers) {
      throw new KnowledgeBaseServiceError('External knowledge sources are not enabled', 501)
    }
    const ref = readSourceProvenance(source.metadata)?.ref ?? source.sourceRef
    if (!ref) {
      throw new KnowledgeBaseServiceError('Source has no origin reference to refresh from', 409)
    }
    const fetched = await this.deps.fetchers.require(source.kind).fetch({ ref, userId: args.userId })
    const result = await this.replaceTextSource({
      content: fetched.content,
      sourceId: source.id,
      userId: args.userId,
    })
    return { unchanged: result.unchanged, source: result.source }
  }

  /**
   * Re-embeds a source from its current content without changing its version
   * history. Used after an embedding-model change, or to recover a source whose
   * chunks were purged.
   */
  async reindexSource(args: { sourceId: string; userId: string }): Promise<{
    jobId: string
    sourceVersionId: string
  }> {
    const source = await this.requireOwnedEditableSource(args.sourceId, args.userId)
    const version = await this.currentVersion(source)
    await Promise.all([
      this.deps.repositories.sources.update({
        id: source.id,
        status: 'indexing',
        statusMessage: undefined,
      }),
      this.deps.repositories.sources.updateVersion({ id: version.id, status: 'indexing' }),
    ])
    const jobId = await this.deps.indexQueue.enqueue({
      contentHash: version.contentHash,
      sourceId: source.id,
      sourceVersionId: version.id,
      userId: args.userId,
    })
    return { jobId, sourceVersionId: version.id }
  }

  /**
   * Re-embeds every source in a base. `onlyStale` limits the sweep to sources
   * whose index no longer matches the current content or embedding identity,
   * which is the normal path for an embedding-model migration.
   */
  async reindexKnowledgeBase(args: {
    knowledgeBaseId: string
    onlyStale?: boolean
    userId: string
  }): Promise<{
    queued: Array<{ sourceId: string; jobId: string }>
    skipped: Array<{ sourceId: string; reason: string }>
  }> {
    const diagnostics = await this.deps.bases.listSourceDiagnostics({
      knowledgeBaseId: args.knowledgeBaseId,
      userId: args.userId,
    })
    const queued: Array<{ sourceId: string; jobId: string }> = []
    const skipped: Array<{ sourceId: string; reason: string }> = []
    for (const entry of diagnostics) {
      if (args.onlyStale && entry.freshness.state === 'fresh') {
        skipped.push({ sourceId: entry.sourceId, reason: 'already fresh' })
        continue
      }
      try {
        const { jobId } = await this.reindexSource({ sourceId: entry.sourceId, userId: args.userId })
        queued.push({ sourceId: entry.sourceId, jobId })
      } catch (error) {
        skipped.push({
          sourceId: entry.sourceId,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return { queued, skipped }
  }

  /** Sources in a base whose index cannot be trusted, with the reason. */
  async listStaleSources(args: {
    knowledgeBaseId: string
    userId: string
  }): Promise<Array<{ sourceId: string; title: string; state: string; reason?: string }>> {
    const diagnostics = await this.deps.bases.listSourceDiagnostics(args)
    return diagnostics
      .filter(({ freshness }) => freshness.state !== 'fresh')
      .map(({ sourceId, title, freshness }) => ({
        sourceId,
        title,
        state: freshness.state,
        reason: freshness.reason,
      }))
  }

  private async currentVersion(source: KnowledgeSource): Promise<KnowledgeSourceVersion> {
    const versions = await this.deps.repositories.sources.listVersions(source.id)
    if (versions.length === 0) {
      throw new KnowledgeBaseServiceError('Knowledge source has no version to index', 409)
    }
    // Prefer the version matching the source's current content hash; fall back to
    // the highest version so a source with a drifted hash is still recoverable.
    return versions.find((version) => version.contentHash === source.contentHash)
      ?? versions.reduce((latest, version) => (version.version > latest.version ? version : latest))
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
