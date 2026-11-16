import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { HydratedRemoteMessage } from '../../../../../convex/lib/remoteMessageText'
import type { GenerationResult } from '../chat-interface/types'

export type PersonalTranscriptRow = {
  message: HydratedRemoteMessage
  contextUser: HydratedRemoteMessage | null
  outputs?: PersonalTranscriptOutput[]
}

export type PersonalTranscriptOutput = {
  _id: string
  type: string
  status: 'pending' | 'completed' | 'failed'
  prompt: string
  modelId: string
  createdAt: number
  turnId: string
  url?: string
}

export type PersonalTranscriptMessage = UIMessage & {
  turnId: string
  mode: 'ask' | 'act'
  model?: string
  variantIndex?: number
  createdAt: number
  updatedAt?: number
  status?: 'generating' | 'completed' | 'error'
  persistedId?: string
  nativeRunId?: string
  nativeProgressSequence?: number
  contentType: 'text' | 'image' | 'video'
  deletedAt?: number
}

export type PersonalPendingTurn = {
  turnId: string
  user: PersonalTranscriptMessage
  responses: PersonalTranscriptMessage[]
  userAcknowledged: boolean
  ownerId?: string
  workspaceId?: string
  submissionKey?: string
  submitArgs?: Record<string, unknown>
  localGenerationResults?: GenerationResult[]
}

export type PersonalTranscriptExchange = {
  turnId: string
  user: PersonalTranscriptMessage | null
  responses: PersonalTranscriptMessage[]
}

function isAtLeastAsRecent(message: HydratedRemoteMessage, previous: HydratedRemoteMessage) {
  if (message.nativeRunId && message.nativeRunId === previous.nativeRunId) {
    const terminal = (row: HydratedRemoteMessage) => row.status === 'completed' || row.status === 'error'
    if (terminal(message) !== terminal(previous)) return terminal(message)
    if (message.nativeProgressSequence !== previous.nativeProgressSequence) {
      return (message.nativeProgressSequence ?? -1) > (previous.nativeProgressSequence ?? -1)
    }
    return (message.updatedAt ?? message.createdAt) >= (previous.updatedAt ?? previous.createdAt)
  }
  if (message.eventSequence !== undefined && previous.eventSequence !== undefined) {
    return message.eventSequence >= previous.eventSequence
  }
  if (message.eventSequence !== undefined) return true
  if (previous.eventSequence !== undefined) return false
  return (message.updatedAt ?? message.createdAt) >= (previous.updatedAt ?? previous.createdAt)
}

export function personalMessageToUi(message: HydratedRemoteMessage): PersonalTranscriptMessage {
  const parts = message.deletedAt !== undefined ? [{ type: 'text', text: 'Message deleted' }]
    : message.parts?.length ? message.parts : [{ type: 'text', text: message.content }]
  return {
    id: message.role === 'user' ? message.turnId : message._id,
    persistedId: message._id,
    nativeRunId: message.nativeRunId,
    nativeProgressSequence: message.nativeProgressSequence,
    turnId: message.turnId,
    role: message.role,
    mode: message.mode,
    model: message.modelId,
    variantIndex: message.variantIndex ?? 0,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    contentType: message.contentType,
    deletedAt: message.deletedAt,
    status: message.status,
    parts: parts as UIMessage['parts'],
    metadata: {
      ...message.userMetadata,
      replyToTurnId: message.replyToTurnId,
      replySnippet: message.replySnippet,
      routedModelId: message.routedModelId,
      agentPlan: message.agentPlan,
      ...(message.deletedAt !== undefined ? { deletedAt: message.deletedAt } : {}),
    },
  }
}

function responseKey(message: PersonalTranscriptMessage) {
  return JSON.stringify([message.turnId, message.variantIndex ?? 0, message.model ?? ''])
}

export function createPersonalMessageProjector() {
  // Weak keys retain no history independently of the immutable live rows.
  const messages = new WeakMap<HydratedRemoteMessage, PersonalTranscriptMessage>()
  return (message: HydratedRemoteMessage) => {
    const existing = messages.get(message)
    if (existing) return existing
    const projected = personalMessageToUi(message)
    messages.set(message, projected)
    return projected
  }
}

// Local stream responses may not carry the model recorded on their canonical row.
function pendingResponseKey(responses: ReadonlyMap<string, PersonalTranscriptMessage>, response: PersonalTranscriptMessage) {
  const key = responseKey(response)
  if (responses.has(key) || response.persistedId) return key
  for (const [canonicalKey, canonical] of responses) {
    if (canonical.persistedId && canonical.turnId === response.turnId
      && (canonical.variantIndex ?? 0) === (response.variantIndex ?? 0)) return canonicalKey
  }
  return key
}

function applyPendingTurn(exchanges: Map<string, PersonalTranscriptExchange>, pending: PersonalPendingTurn) {
  const existing = exchanges.get(pending.turnId)
  // An acknowledged row disappearing is not a reason to resurrect a local draft.
  if (!existing?.user && pending.userAcknowledged) return
  const exchange = existing ?? { turnId: pending.turnId, user: pending.user, responses: [] }
  if (!exchange.user) exchange.user = pending.user
  const responses = new Map(exchange.responses.map(response => [responseKey(response), response]))
  for (const response of pending.responses) {
    const key = pendingResponseKey(responses, response)
    const canonical = responses.get(key)
    if (canonical?.status === 'completed' || canonical?.status === 'error') continue
    if (canonical?.nativeProgressSequence !== undefined) continue
    if (canonical?.status === 'generating' && response.status === 'error') continue
    responses.set(key, canonical ? {
      ...canonical, ...response, id: canonical.id, persistedId: canonical.persistedId, model: canonical.model ?? response.model,
      nativeRunId: canonical.nativeRunId, nativeProgressSequence: canonical.nativeProgressSequence,
      metadata: {
        ...(canonical.metadata as Record<string, unknown> | undefined),
        ...(response.metadata as Record<string, unknown> | undefined),
      },
    } : response)
  }
  exchange.responses = [...responses.values()]
  exchanges.set(pending.turnId, exchange)
}

export function projectPersonalTranscript(
  rows: readonly PersonalTranscriptRow[],
  pendingTurns: readonly PersonalPendingTurn[] = [],
  projectMessage = personalMessageToUi,
) {
  const messages = new Map<string, HydratedRemoteMessage>()
  const outputs = new Map<string, PersonalTranscriptOutput>()
  for (const row of rows) {
    for (const output of row.outputs ?? []) outputs.set(output._id, output)
    for (const message of [row.contextUser, row.message]) {
      if (!message) continue
      const previous = messages.get(message._id)
      if (!previous || isAtLeastAsRecent(message, previous)) messages.set(message._id, message)
    }
  }
  const ordered = [...messages.values()].sort((a, b) => a.createdAt - b.createdAt
    || a._creationTime - b._creationTime || a._id.localeCompare(b._id))
  const byTurn = new Map<string, PersonalTranscriptExchange>()
  for (const message of ordered) {
    const exchange = byTurn.get(message.turnId) ?? { turnId: message.turnId, user: null, responses: [] }
    const ui = projectMessage(message)
    if (message.role === 'user') exchange.user = ui
    else exchange.responses.push(ui)
    byTurn.set(message.turnId, exchange)
  }
  for (const pending of pendingTurns) applyPendingTurn(byTurn, pending)
  const exchanges = [...byTurn.values()].sort((a, b) =>
    (a.user?.createdAt ?? a.responses[0]?.createdAt ?? 0) - (b.user?.createdAt ?? b.responses[0]?.createdAt ?? 0))
  for (const exchange of exchanges) exchange.responses.sort((a, b) => (a.variantIndex ?? 0) - (b.variantIndex ?? 0)
    || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  return {
    exchanges,
    messages: exchanges.flatMap(exchange => [...(exchange.user ? [exchange.user] : []), ...exchange.responses]),
    outputs: [...outputs.values()],
    acknowledgedTurnIds: new Set(ordered.filter(message => message.role === 'user').map(message => message.turnId)),
    terminalTurnIds: new Set(exchanges.filter(exchange => exchange.responses.length > 0
      && exchange.responses.every(response => response.persistedId && (response.status === 'completed' || response.status === 'error')))
      .map(exchange => exchange.turnId)),
  }
}
