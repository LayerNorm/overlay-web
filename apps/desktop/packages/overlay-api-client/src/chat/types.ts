import type { ConversationMessage, ConversationSummary } from '@overlay/app-core'
import type { PaginationQuery } from '../shared/types'

export interface ConversationQuery extends PaginationQuery {
  conversationId?: string
  messages?: boolean
  projectId?: string
  updatedSince?: number
  includeDeleted?: boolean
  limit?: number
  beforeCreatedAt?: number
  compactToolPayloads?: boolean
}

export type ConversationGetResponse =
  | ConversationSummary[]
  | ConversationSummary
  | {
      messages: ConversationMessage[]
      limit?: number
      hasMore?: boolean
      earliestCreatedAt?: number
    }

export interface CreateConversationRequest {
  title?: string
  projectId?: string
  askModelIds?: string[]
  actModelId?: string
  lastMode?: 'ask' | 'act'
  clientId?: string
}

export interface CreateConversationResponse {
  id?: string
  conversation?: ConversationSummary
  error?: string
}

export interface UpdateConversationRequest {
  conversationId?: string
  title?: string
  projectId?: string | null
  lastMode?: 'ask' | 'act'
  askModelIds?: string[]
  actModelId?: string
  lastModified?: number
}

export interface ConversationMessageRequest {
  conversationId?: string
  turnId?: string
  mode?: 'ask' | 'act'
  role?: 'user' | 'assistant'
  content?: string
  parts?: Array<Record<string, unknown>>
  attachmentNames?: string[]
  model?: string
  modelId?: string
  contentType?: 'text' | 'image' | 'video'
  variantIndex?: number
  replyToTurnId?: string
  replySnippet?: string
  accessToken?: string
  userId?: string
}

export type ActConversationRequest = Record<string, unknown>

export interface StreamAuthRequest {
  conversationId?: string
  accessToken?: string
  userId?: string
  [key: string]: unknown
}

export interface StreamAuthResponse {
  token?: string
  streamToken?: string
  expiresAt?: number
  expiresIn?: number
  [key: string]: unknown
}
