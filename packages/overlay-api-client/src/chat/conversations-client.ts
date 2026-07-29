import type { ConversationSummary } from '@overlay/app-core'
import type {
  ConversationParticipant,
  ConversationParticipantStateInput,
  ConversationPresence,
  DirectMessageCreateInput,
  DirectMessageSummary,
  WorkspaceNotification,
} from '@overlay/workspace-contracts'
import type { HttpContext } from '../shared/http'
import type { MutationRequestInit } from '../shared/mutation'
import type { PaginatedEnvelope, QueryParams } from '../shared/types'
import type {
  ActConversationRequest,
  ConversationGetResponse,
  ConversationMessageRequest,
  ConversationQuery,
  CreateConversationRequest,
  CreateConversationResponse,
  StreamAuthRequest,
  StreamAuthResponse,
  UpdateConversationRequest,
} from './types'

export class ConversationsClient {
  constructor(private readonly http: HttpContext) {}

  private path(query?: ConversationQuery): string {
    return this.http.appendQuery('/api/v1/conversations', query as QueryParams | undefined)
  }

  get<T = ConversationGetResponse>(query?: ConversationQuery, init?: RequestInit) {
    return this.http.jsonData<T>(this.path(query), init)
  }

  getPage<T = ConversationSummary>(query?: ConversationQuery, init?: RequestInit) {
    return this.http.json<PaginatedEnvelope<T>>(this.path(query), init)
  }

  getResponse(query?: ConversationQuery, init?: RequestInit) {
    return this.http.request(this.path(query), init)
  }

  events<T = {
    cursor: number
    events: Array<{
      sequence: number
      conversationId: string
      type: string
      messageId?: string
      payload?: Record<string, unknown>
      createdAt: number
    }>
  }>(after?: number, init?: RequestInit) {
    const path = this.http.appendQuery('/api/v1/conversations/events', (
      after === undefined ? undefined : { after }
    ))
    return this.http.json<T>(path, init)
  }

  eventsResponse(after?: number, init?: RequestInit) {
    const path = this.http.appendQuery('/api/v1/conversations/events', (
      after === undefined ? undefined : { after }
    ))
    return this.http.request(path, init)
  }

  create(body: CreateConversationRequest, init?: MutationRequestInit) {
    return this.http.json<CreateConversationResponse>(
      '/api/v1/conversations',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  createResponse(body: CreateConversationRequest, init?: MutationRequestInit) {
    return this.http.request('/api/v1/conversations', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  update(body: UpdateConversationRequest, init?: RequestInit) {
    return this.http.json<ConversationSummary>(
      '/api/v1/conversations',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  updateResponse(body: UpdateConversationRequest, init?: RequestInit) {
    return this.http.request('/api/v1/conversations', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  deleteResponse(query: { conversationId: string }, init?: RequestInit) {
    return this.http.request(this.path(query), { ...init, method: 'DELETE' })
  }

  addMessage(body: ConversationMessageRequest, init?: MutationRequestInit) {
    return this.http.json<{ success: boolean; conversationId: string; turnId: string }>(
      '/api/v1/conversations/message',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  addMessageResponse(body: ConversationMessageRequest, init?: MutationRequestInit) {
    return this.http.request('/api/v1/conversations/message', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  actResponse(body: ActConversationRequest, init?: MutationRequestInit) {
    return this.http.request('/api/v1/conversations/act', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  extensionPlanResponse(body: ActConversationRequest, init?: MutationRequestInit) {
    return this.http.request(
      '/api/v1/conversations/act/extension-plan',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  streamAuth<T = StreamAuthResponse>(body: StreamAuthRequest, init?: MutationRequestInit) {
    return this.http.json<T>(
      '/api/v1/conversations/stream-auth',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  streamAuthResponse(body: StreamAuthRequest, init?: MutationRequestInit) {
    return this.http.request(
      '/api/v1/conversations/stream-auth',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  deleteMessageResponse(
    body: { conversationId?: string; turnId?: string; accessToken?: string; userId?: string },
    init?: RequestInit,
  ) {
    return this.http.request('/api/v1/conversations/message', this.http.jsonRequest(body, { ...init, method: 'DELETE' }))
  }

  updateMessageUiPartResponse(
    body: {
      conversationId: string
      messageId: string
      partId: string
      data: unknown
    },
    init?: RequestInit,
  ) {
    return this.http.request('/api/v1/conversations/message', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  stopResponse(
    body: {
      conversationId?: string
      messageId?: string
      partialContent?: string
      partialParts?: Array<Record<string, unknown>>
    },
    init?: MutationRequestInit,
  ) {
    return this.http.request('/api/v1/conversations/stop', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  createDirectMessage(body: DirectMessageCreateInput, init?: MutationRequestInit) {
    return this.http.json<{ directMessage: DirectMessageSummary }>(
      '/api/v1/conversations/direct-messages',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  participants(conversationId: string, init?: RequestInit) {
    return this.http.json<{ participants: ConversationParticipant[]; currentPrincipalId: string }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/participants`,
      init,
    )
  }

  addParticipant(conversationId: string, principalId: string, init?: MutationRequestInit) {
    return this.http.json<{ participant: ConversationParticipant }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/participants`,
      this.http.jsonRequest({ principalId }, { ...init, method: 'POST' }),
    )
  }

  removeParticipant(conversationId: string, principalId: string, init?: MutationRequestInit) {
    return this.http.json<{ removed: boolean }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/participants`,
      this.http.jsonRequest({ principalId }, { ...init, method: 'DELETE' }),
    )
  }

  updateParticipantState(
    conversationId: string,
    body: ConversationParticipantStateInput,
    init?: MutationRequestInit,
  ) {
    return this.http.json<{ participant: ConversationParticipant }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/state`,
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  presence(conversationId: string, init?: RequestInit) {
    return this.http.json<{ presence: ConversationPresence[] }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/presence`,
      init,
    )
  }

  updatePresence(
    conversationId: string,
    body: { status: 'online' | 'away' | 'offline'; typing?: boolean },
    init?: MutationRequestInit,
  ) {
    return this.http.json<{ presence: ConversationPresence }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/presence`,
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  editCollaborativeMessage(
    conversationId: string,
    messageId: string,
    content: string,
    init?: MutationRequestInit,
  ) {
    return this.http.json<{ updated: boolean }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      this.http.jsonRequest({ content }, { ...init, method: 'PATCH' }),
    )
  }

  deleteCollaborativeMessage(
    conversationId: string,
    messageId: string,
    init?: MutationRequestInit,
  ) {
    return this.http.json<{ deleted: boolean }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      { ...init, method: 'DELETE' },
    )
  }

  notifications(query?: { unreadOnly?: boolean; limit?: number }, init?: RequestInit) {
    return this.http.json<{ notifications: WorkspaceNotification[] }>(
      this.http.appendQuery('/api/v1/conversations/notifications', query),
      init,
    )
  }

  markNotificationsRead(notificationIds?: string[], init?: MutationRequestInit) {
    return this.http.json<{ updated: number }>(
      '/api/v1/conversations/notifications',
      this.http.jsonRequest({ notificationIds }, { ...init, method: 'PATCH' }),
    )
  }
}
