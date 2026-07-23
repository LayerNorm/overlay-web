import type {
  KnowledgeBase,
  KnowledgeBaseSource,
  KnowledgeSource,
} from '@overlay/app-core'
import type { ResourceGrant } from '@overlay/authz-contracts'

export type KnowledgeBaseSourceDetail = {
  membership: KnowledgeBaseSource
  source: KnowledgeSource
}

export type KnowledgeBaseListResponse = { knowledgeBases: KnowledgeBase[] }
export type KnowledgeBaseDetailResponse = { knowledgeBase: KnowledgeBase }
export type KnowledgeBaseSourcesResponse = { sources: KnowledgeBaseSourceDetail[] }
export type KnowledgeBaseGrantsResponse = { grants: ResourceGrant[] }

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
