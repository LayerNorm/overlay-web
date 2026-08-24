import type { ConversationSummary } from '@overlay/app-core'
import type {
  ChannelCreateInput,
  ChannelSummary,
  ConversationParticipant,
  ConversationParticipantStateInput,
  ConversationPin,
  ConversationPresence,
  ConversationSavedMessage,
  ConversationThreadFollow,
  DirectMessageCreateInput,
  DirectMessageSummary,
  MessageReaction,
  WorkspaceNotification,
  WorkspaceNotificationFilter,
} from '@overlay/workspace-contracts'
import type { HttpContext } from '../shared/http'
import type { MutationRequestInit } from '../shared/mutation'
import type { PaginatedEnvelope, QueryParams } from '../shared/types'
import type {
  ActConversationRequest,
  AgentRunResource,
  AgentRunMetricsReport,
  ConversationGetResponse,
  ConversationMessageRequest,
  ConversationQuery,
  CreateConversationRequest,
  CreateConversationResponse,
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

  controlRemoteQueue(input: {
    workspaceId: string
    conversationId: string
    runId: string
    action: 'cancel' | 'retry' | 'resume' | 'start_fresh'
  }, init?: RequestInit) {
    const headers = new Headers(init?.headers)
    headers.set('x-overlay-workspace-id', input.workspaceId)
    return this.http.json<{ applied: boolean; messageId?: string }>(
      '/api/v1/conversations/run/remote',
      this.http.jsonRequest({
        conversationId: input.conversationId,
        runId: input.runId,
        action: input.action,
      }, { ...init, headers, method: 'POST' }),
    )
  }

  resolveRemoteRequest(input: {
    workspaceId: string
    conversationId: string
    runId: string
    requestKey: string
    decision: string
    response?: Record<string, unknown>
  }, init?: RequestInit) {
    const headers = new Headers(init?.headers)
    headers.set('x-overlay-workspace-id', input.workspaceId)
    return this.http.json<{ applied: boolean; messageId?: string; commandId?: string }>(
      '/api/v1/conversations/run/remote/request',
      this.http.jsonRequest({ conversationId: input.conversationId, runId: input.runId,
        requestKey: input.requestKey, decision: input.decision, response: input.response },
      { ...init, headers, method: 'POST' }),
    )
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

  deleteResponse(query: { conversationId: string; scope?: 'self' | 'everyone' }, init?: RequestInit) {
    return this.http.request(this.path(query), { ...init, method: 'DELETE' })
  }

  deleteAllResponse(init?: RequestInit) {
    return this.http.request('/api/v1/conversations?all=true', { ...init, method: 'DELETE' })
  }

  addMessage(body: ConversationMessageRequest, init?: MutationRequestInit) {
    return this.http.json<{ success: boolean; conversationId: string; turnId: string; messageId?: string }>(
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

  currentRun(conversationId: string, init?: RequestInit) {
    const path = this.http.appendQuery('/api/v1/conversations/run', { conversationId })
    return this.http.json<{ run: AgentRunResource | null }>(path, init)
  }

  runMetrics(query?: { from?: number; to?: number; limit?: number }, init?: RequestInit) {
    const path = this.http.appendQuery('/api/v1/conversations/run/metrics', query)
    return this.http.json<AgentRunMetricsReport>(path, init)
  }

  recordRunMetricEvent(body: {
    conversationId: string
    agentRunId: string
    event: 'browser_disconnected' | 'browser_reconnected'
  }, init?: MutationRequestInit) {
    return this.http.json<{ success: boolean }>(
      '/api/v1/conversations/run/metrics-event',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  submitRunApproval(body: {
    conversationId: string
    agentRunId: string
    token: string
    approved: boolean
    reason?: string
  }, init?: MutationRequestInit) {
    return this.http.json<{ success: boolean }>(
      '/api/v1/conversations/run/approval',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  // ---------------------------------------------------------------------------
  // Collaboration: notifications, participants, presence, reactions, pins,
  // saved messages, channels, and direct messages. These mirror the BFF routes
  // under `/api/v1/conversations` and return the same JSON envelopes the UI
  // destructures (e.g. `{ notifications }`, `{ participants, currentPrincipalId }`).
  // ---------------------------------------------------------------------------

  notifications(
    params: { filter?: WorkspaceNotificationFilter; unreadOnly?: boolean; limit?: number },
    init?: RequestInit,
  ) {
    return this.http.json<{ notifications: WorkspaceNotification[] }>(
      this.http.appendQuery('/api/v1/conversations/notifications', params as QueryParams | undefined),
      init,
    )
  }

  markNotificationsRead(notificationIds: string[], init?: MutationRequestInit) {
    return this.http.json<{ updated: number }>(
      '/api/v1/conversations/notifications',
      this.http.jsonRequest({ notificationIds }, { ...init, method: 'PATCH' }),
    )
  }

  markConversationNotificationsRead(conversationId: string, init?: MutationRequestInit) {
    return this.http.json<{ updated: number }>(
      '/api/v1/conversations/notifications',
      this.http.jsonRequest({ conversationId }, { ...init, method: 'PATCH' }),
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
    state: ConversationParticipantStateInput,
    init?: MutationRequestInit,
  ) {
    return this.http.json<{ participant: ConversationParticipant }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/state`,
      this.http.jsonRequest(state, { ...init, method: 'PATCH' }),
    )
  }

  presence(conversationId: string, init?: RequestInit) {
    return this.http.json<{ presence: ConversationPresence[] }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/presence`,
      init,
    )
  }

  reactions(conversationId: string, init?: RequestInit) {
    return this.http.json<{ reactions: MessageReaction[] }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/reactions`,
      init,
    )
  }

  setReaction(
    conversationId: string,
    body: { messageId: string; emoji: string; enabled: boolean },
    init?: MutationRequestInit,
  ) {
    return this.http.json<{ reactions: MessageReaction[] }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/reactions`,
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  pins(conversationId: string, init?: RequestInit) {
    return this.http.json<{ pins: ConversationPin[] }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/pins`,
      init,
    )
  }

  setPinned(
    conversationId: string,
    body: { messageId: string; pinned: boolean },
    init?: MutationRequestInit,
  ) {
    return this.http.json<{ pinned: boolean }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/pins`,
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  savedMessages(init?: RequestInit) {
    return this.http.json<{ savedMessages: ConversationSavedMessage[] }>(
      '/api/v1/conversations/saved-messages',
      init,
    )
  }

  setSaved(
    body: { conversationId: string; messageId: string; saved: boolean },
    init?: MutationRequestInit,
  ) {
    return this.http.json<{ saved: boolean }>(
      '/api/v1/conversations/saved-messages',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  reportMessage(
    conversationId: string,
    body: { messageId?: string; reason: string; note?: string },
    init?: MutationRequestInit,
  ) {
    return this.http.json<{ recorded: boolean }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/reports`,
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  channels(init?: RequestInit) {
    return this.http.json<{ channels: ChannelSummary[] }>(
      '/api/v1/conversations/channels',
      init,
    )
  }

  createChannel(body: ChannelCreateInput, init?: MutationRequestInit) {
    return this.http.json<{ channel?: ChannelSummary; error?: string }>(
      '/api/v1/conversations/channels',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  createDirectMessage(body: DirectMessageCreateInput, init?: MutationRequestInit) {
    return this.http.json<{ directMessage: DirectMessageSummary; error?: string }>(
      '/api/v1/conversations/direct-messages',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  updatePresence(
    conversationId: string,
    body: { status: 'online' | 'away' | 'offline'; sessionId?: string; typing?: boolean },
    init?: MutationRequestInit,
  ) {
    return this.http.json<{ presence: ConversationPresence }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/presence`,
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  threadFollow(conversationId: string, threadRootMessageId: string, init?: RequestInit) {
    return this.http.json<{ following: boolean; follows: ConversationThreadFollow[] }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/threads/${encodeURIComponent(threadRootMessageId)}/follow`,
      init,
    )
  }

  setThreadFollow(
    conversationId: string,
    threadRootMessageId: string,
    followed: boolean,
    init?: MutationRequestInit,
  ) {
    return this.http.json<{ followed: boolean }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/threads/${encodeURIComponent(threadRootMessageId)}/follow`,
      this.http.jsonRequest({ followed }, { ...init, method: 'PATCH' }),
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
      this.http.jsonRequest(undefined, { ...init, method: 'DELETE' }),
    )
  }
}
