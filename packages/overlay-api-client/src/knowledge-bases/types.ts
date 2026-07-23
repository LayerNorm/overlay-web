import type {
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
  grantCount: number
  sourceCount: number
}
export type AdministrativeKnowledgeBaseListResponse = {
  knowledgeBases: AdministrativeKnowledgeBase[]
}
export type KnowledgeBaseSearchResponse = {
  chunks: KnowledgeBaseSearchChunk[]
  citations: KnowledgeBaseCitation[]
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
  title: string
  content: string
  mimeType?: string
  sourceRef?: string
}
