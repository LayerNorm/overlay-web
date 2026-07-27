/**
 * Where a knowledge source came from, and how fresh its index is.
 *
 * Provenance is stored inside `KnowledgeSource.metadata` under `provenance` so it
 * works identically on Postgres and Convex without a schema change per origin
 * type. Freshness is derived, never stored, so it cannot go stale itself.
 */

export const KNOWLEDGE_SOURCE_ORIGINS = [
  'upload',
  'note',
  'memory',
  'text',
  'url',
  'connector',
  'drive',
  'project-promotion',
] as const
export type KnowledgeSourceOrigin = (typeof KNOWLEDGE_SOURCE_ORIGINS)[number]

export type KnowledgeSourceProvenance = {
  origin: KnowledgeSourceOrigin
  /** External identifier: URL, connector resource id, drive file id, file id. */
  ref?: string
  /** Human-readable origin label, e.g. a connector or site name. */
  label?: string
  /** Set when the source was promoted out of a project artifact. */
  promotedFromProjectId?: string
  promotedFromArtifactId?: string
  addedBy?: string
  /** When the content was first captured into the knowledge base. */
  ingestedAt?: number
  /** When the origin itself last changed, if the origin reports it. */
  originUpdatedAt?: number
}

export type EmbeddingIdentitySnapshot = {
  provider: string
  modelId: string
  modelVersion: string
}

export const KNOWLEDGE_FRESHNESS_STATES = ['fresh', 'never-indexed', 'stale', 'failed'] as const
export type KnowledgeFreshnessState = (typeof KNOWLEDGE_FRESHNESS_STATES)[number]

export type KnowledgeSourceFreshness = {
  state: KnowledgeFreshnessState
  lastIndexedAt?: number
  /** True when the content changed after the last successful index. */
  contentChangedSinceIndex: boolean
  /** True when chunks were embedded under a different embedding identity. */
  embeddingIdentityDrifted: boolean
  reason?: string
}

export function readSourceProvenance(
  metadata: Record<string, unknown> | undefined,
): KnowledgeSourceProvenance | undefined {
  const raw = metadata?.provenance
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const origin = value.origin
  if (typeof origin !== 'string' || !isKnownOrigin(origin)) return undefined
  return {
    origin,
    ref: optionalString(value.ref),
    label: optionalString(value.label),
    promotedFromProjectId: optionalString(value.promotedFromProjectId),
    promotedFromArtifactId: optionalString(value.promotedFromArtifactId),
    addedBy: optionalString(value.addedBy),
    ingestedAt: optionalNumber(value.ingestedAt),
    originUpdatedAt: optionalNumber(value.originUpdatedAt),
  }
}

/** Merges provenance into a metadata bag without disturbing other keys. */
export function withSourceProvenance(
  metadata: Record<string, unknown> | undefined,
  provenance: KnowledgeSourceProvenance,
): Record<string, unknown> {
  return {
    ...metadata,
    provenance: Object.fromEntries(
      Object.entries(provenance).filter(([, value]) => value !== undefined),
    ),
  }
}

/** Infers a provenance origin for sources created before provenance was tracked. */
export function inferOriginFromKind(kind: string): KnowledgeSourceOrigin {
  switch (kind) {
    case 'file': return 'upload'
    case 'note': return 'note'
    case 'memory': return 'memory'
    case 'url': return 'url'
    case 'connector': return 'connector'
    case 'drive': return 'drive'
    default: return 'text'
  }
}

/**
 * Decides whether a source's index can still be trusted.
 *
 * A source is stale when its content hash moved on from what was indexed, or
 * when its chunks were embedded under a different provider/model/version, since
 * vectors from different embedding spaces are not comparable.
 */
export function evaluateSourceFreshness(args: {
  status: string
  statusMessage?: string
  contentHash?: string
  indexedContentHash?: string
  lastIndexedAt?: number
  chunkCount?: number
  currentEmbeddingIdentity?: EmbeddingIdentitySnapshot
  indexedEmbeddingIdentities?: EmbeddingIdentitySnapshot[]
}): KnowledgeSourceFreshness {
  const contentChangedSinceIndex = Boolean(
    args.contentHash && args.indexedContentHash && args.contentHash !== args.indexedContentHash,
  )
  const embeddingIdentityDrifted = hasIdentityDrift(
    args.currentEmbeddingIdentity,
    args.indexedEmbeddingIdentities,
  )

  if (args.status === 'failed') {
    return {
      state: 'failed',
      lastIndexedAt: args.lastIndexedAt,
      contentChangedSinceIndex,
      embeddingIdentityDrifted,
      reason: args.statusMessage || 'Indexing failed',
    }
  }
  if (!args.lastIndexedAt || (args.chunkCount ?? 0) === 0) {
    return {
      state: 'never-indexed',
      lastIndexedAt: args.lastIndexedAt,
      contentChangedSinceIndex,
      embeddingIdentityDrifted,
      reason: args.status === 'ready'
        ? 'Marked ready but no indexed passages were found'
        : 'Not indexed yet',
    }
  }
  if (contentChangedSinceIndex || embeddingIdentityDrifted) {
    return {
      state: 'stale',
      lastIndexedAt: args.lastIndexedAt,
      contentChangedSinceIndex,
      embeddingIdentityDrifted,
      reason: contentChangedSinceIndex
        ? 'Content changed after the last successful index'
        : 'Embedded with a different embedding model',
    }
  }
  return {
    state: 'fresh',
    lastIndexedAt: args.lastIndexedAt,
    contentChangedSinceIndex: false,
    embeddingIdentityDrifted: false,
  }
}

export function embeddingIdentityKey(identity: EmbeddingIdentitySnapshot): string {
  return `${identity.provider}|${identity.modelId}|${identity.modelVersion}`
}

function hasIdentityDrift(
  current: EmbeddingIdentitySnapshot | undefined,
  indexed: EmbeddingIdentitySnapshot[] | undefined,
): boolean {
  if (!current || !indexed || indexed.length === 0) return false
  const expected = embeddingIdentityKey(current)
  return indexed.some((identity) => embeddingIdentityKey(identity) !== expected)
}

function isKnownOrigin(value: string): value is KnowledgeSourceOrigin {
  return (KNOWLEDGE_SOURCE_ORIGINS as readonly string[]).includes(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
