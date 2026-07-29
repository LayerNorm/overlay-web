import type {
  GroupKnowledgeBaseDefault,
  KnowledgeBase,
  KnowledgeBaseSource,
  KnowledgeSource,
} from '@overlay/app-core'
import type { ResourceGrant } from '@overlay/authz-contracts'

export type KnowledgeBaseSearchChunk = {
  chunkIndex: number
  knowledgeSourceId?: string
  knowledgeSourceVersionId?: string
  score: number
  sourceId: string
  sourceKind: 'file' | 'memory'
  text: string
  title?: string
}

export type KnowledgeBaseCitation = {
  sourceId: string
  sourceVersionId?: string
  title: string
}

export type KnowledgeBaseSourceDetail = {
  membership: KnowledgeBaseSource
  source: KnowledgeSource & { contentPreview?: string }
}

export type KnowledgeBaseListResponse = { knowledgeBases: KnowledgeBase[] }
export type KnowledgeBaseDetailResponse = { knowledgeBase: KnowledgeBase }
export type KnowledgeBaseSourcesResponse = { sources: KnowledgeBaseSourceDetail[] }
export type KnowledgeBaseGrantsResponse = { grants: ResourceGrant[] }
export type KnowledgeBaseShareDirectoryEntry = {
  id: string
  name: string
  description?: string
  email?: string
  profilePictureUrl?: string
}
export type KnowledgeBaseShareDirectoryResponse = {
  users: KnowledgeBaseShareDirectoryEntry[]
  groups: KnowledgeBaseShareDirectoryEntry[]
  roles: KnowledgeBaseShareDirectoryEntry[]
}
export type AdministrativeKnowledgeBase = KnowledgeBase & {
  defaultGroupCount: number
  grantCount: number
  indexHealth: {
    failed: number
    fresh: number
    neverIndexed: number
    stale: number
  }
  indexUsage: {
    chunkCount: number
    embeddedCount: number
    indexedChars: number
  }
  sourceCount: number
}
export type AdministrativeKnowledgeBaseListResponse = {
  knowledgeBases: AdministrativeKnowledgeBase[]
}
export type GroupKnowledgeBaseDefaultsResponse = {
  defaults: GroupKnowledgeBaseDefault[]
}
export type KnowledgeBaseSearchResponse = {
  chunks: KnowledgeBaseSearchChunk[]
  citations: KnowledgeBaseCitation[]
}

export type KnowledgeSourceFreshness = {
  state: 'fresh' | 'never-indexed' | 'stale' | 'failed'
  lastIndexedAt?: number
  contentChangedSinceIndex: boolean
  embeddingIdentityDrifted: boolean
  reason?: string
}

export type KnowledgeSourceDiagnostics = {
  sourceId: string
  title: string
  kind: KnowledgeSource['kind']
  status: string
  statusMessage?: string
  enabled: boolean
  mimeType?: string
  contentHash?: string
  chunkCount: number
  embeddedCount: number
  indexedChars: number
  updatedAt: number
  provenance: Record<string, unknown>
  embeddingIdentities: Array<{
    provider: string
    modelId: string
    modelVersion: string
    count: number
  }>
  freshness: KnowledgeSourceFreshness
}

export type KnowledgeBaseDiagnosticsResponse = {
  sources: KnowledgeSourceDiagnostics[]
}

export type KnowledgeSourcePreviewResponse = {
  preview: {
    sourceId: string
    text: string
    totalChars: number
    truncated: boolean
  }
}

export type ReindexKnowledgeBaseResponse = {
  success: true
  queued: Array<{ sourceId: string; jobId?: string }>
  skipped?: Array<{ sourceId: string; reason: string }>
}

export type CreateKnowledgeBaseInput = {
  title: string
  description?: string
  kind?: 'personal' | 'organization'
}

export type UpdateKnowledgeBaseInput = Partial<CreateKnowledgeBaseInput> & {
  knowledgeBaseId: string
}

export type CreateKnowledgeBaseSourceInput = {
  title?: string
  content?: string
  mimeType?: string
  sourceRef?: string
  kind?: 'text' | 'url' | 'connector' | 'drive'
  ref?: string
}
