import type { ConversationMessage, ConversationSummary } from '@overlay/app-core'
import type { PaginationQuery } from '../shared/types'

export interface ConversationQuery extends PaginationQuery {
  view?: 'personal' | 'dms' | 'channels' | 'all'
  conversationId?: string
  messages?: boolean
  projectId?: string
  updatedSince?: number
  includeDeleted?: boolean
  limit?: number
  beforeCreatedAt?: number
  mainOnly?: boolean
  threadRootMessageId?: string
  messageId?: string
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
  conversationType?: 'personal' | 'dm' | 'channel'
  title?: string
  projectId?: string
  askModelIds?: string[]
  actModelId?: string
  lastMode?: 'ask' | 'act'
  clientId?: string
  knowledgeBaseId?: string
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
  knowledgeBaseId?: string | null
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
  clientNonce?: string
  threadRootMessageId?: string
  mentionedPrincipalIds?: string[]
  /** Caller streams the agent reply itself via `agentReplyStream`. */
  deferAgentReply?: boolean
}

export type ActConversationRequest = Record<string, unknown>

export type AgentRunResource = {
  id: string
  conversationId: string
  turnId: string
  userId: string
  userMessageId: string
  assistantMessageId: string
  mode: 'chat' | 'work'
  runner: 'tool_loop' | 'workflow'
  status: 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'cancelled'
  variantIndex?: number
  workflowRunId?: string
  leaseExpiresAt?: number
  startedAt?: number
  completedAt?: number
  failedAt?: number
  cancelledAt?: number
  terminalError?: { code: string; message: string; retryable: boolean }
  approval?: {
    token: string
    requestedAt: number
    requests: Array<{
      approvalId: string
      toolCallId: string
      toolName: string
      input: unknown
    }>
  }
  createdAt: number
  updatedAt: number
}
