import type { AssistantVisualBlock } from '@overlay/chat-core'
import { buildAssistantVisualSequence, splitUserDisplayText, errorLabel, persistedGenerationErrorMessage } from '@overlay/chat-core'
import type { RoomMessageAttachment, RoomMessageView } from './RoomMessageItem'
import { NATIVE_AGENT_APPROVAL_PART, readNativeAgentApproval } from '@/shared/agents/native-agent-approval'
import { NATIVE_AGENT_INPUT_PART, readNativeAgentInput } from '@/shared/agents/native-agent-input'
import { readNativeAgentError } from '@/shared/agents/native-agent-error'

function nativeInputRequest(message: RoomMessageRecord): RoomMessageView['nativeInput'] {
  if (message.authorKind !== 'agent' || message.status !== 'generating') return undefined
  return readNativeAgentInput(message.parts?.find(part => part.type === NATIVE_AGENT_INPUT_PART)?.data)
}

export type RoomMessagePart = {
  toolInvocation?: Record<string, unknown>
  type?: string
  text?: string
  url?: string
  mediaType?: string
  fileName?: string
  data?: Record<string, unknown>
}

/** Who asked, when another agent posted this message on a person's behalf. */
function askedBy(message: { authorKind?: string; parts?: RoomMessagePart[] }): RoomMessageView['askedBy'] {
  if (message.authorKind !== 'agent') return undefined
  const data = message.parts?.find((part) => part.type === 'data-agent-lineage')?.data
  if (!data || typeof data.askedByName !== 'string' || typeof data.hop !== 'number') return undefined
  return {
    name: data.askedByName,
    hop: data.hop,
    ...(typeof data.parentConversationId === 'string' && data.parentConversationId ? { parentConversationId: data.parentConversationId } : {}),
  }
}

export type RoomMessageRecord = {
  id: string
  conversationId?: string
  turnId: string
  authorKind: 'human' | 'agent' | 'model' | 'system'
  authorPrincipalId?: string
  /** Denormalized identity for messages imported from Slack (see schema). */
  importedAuthorName?: string
  importedAuthorEmail?: string
  importedAuthorStatus?: 'member' | 'invited' | 'not_invited'
  content: string
  parts?: RoomMessagePart[]
  agentPlan?: RoomMessageView['plan']
  createdAt: number
  updatedAt?: number
  eventSequence?: number
  editedAt?: number
  editHistory?: Array<{ content: string; editedAt: number }>
  deletedAt?: number
  clientNonce?: string
  rowIdentity?: string
  threadRootMessageId?: string
  delivery?: 'sending' | 'failed'
  deliveryError?: string
  status?: 'generating' | 'completed' | 'error'
  publicStreamCheckpoint?: {
    runId: string
    executionGeneration: number
    receiptId: string
    invocation: number
  }
}

export function isRoomAgentResponding(messages: readonly Pick<RoomMessageRecord, 'authorKind' | 'status'>[], pendingAgent: string | null): boolean {
  return Boolean(pendingAgent) || messages.some((message) => message.authorKind === 'agent' && message.status === 'generating')
}

/** Stable ordering and optimistic reconciliation for room messages. */
export function compareRoomMessageRecords(left: Pick<RoomMessageRecord, 'id' | 'createdAt'>, right: Pick<RoomMessageRecord, 'id' | 'createdAt'>): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
}

function isNewerRoomMessage(message: RoomMessageRecord, existing: RoomMessageRecord): boolean {
  if (message.delivery || existing.delivery) return false
  if (typeof message.eventSequence === 'number' && typeof existing.eventSequence === 'number') {
    return message.eventSequence > existing.eventSequence
      || (message.eventSequence === existing.eventSequence && (message.updatedAt ?? 0) > (existing.updatedAt ?? 0))
  }
  return (message.updatedAt ?? 0) > (existing.updatedAt ?? 0)
    || ((message.updatedAt ?? 0) === (existing.updatedAt ?? 0) && existing.status === 'generating'
      && (message.status === 'completed' || message.status === 'error'))
}

export function mergeRoomMessages(
  persisted: RoomMessageRecord[],
  current: RoomMessageRecord[],
): RoomMessageRecord[] {
  const merged = new Map<string, RoomMessageRecord>()
  for (const message of persisted) {
    merged.set(message.clientNonce ? `nonce:${message.clientNonce}` : `id:${message.id}`, message)
  }
  for (const message of current) {
    const key = message.clientNonce ? `nonce:${message.clientNonce}` : `id:${message.id}`
    const existing = merged.get(key)
    const currentIsNewer = existing && isNewerRoomMessage(message, existing)
    if (!existing || (existing.delivery && !message.delivery) || currentIsNewer) merged.set(key, message)
    else if (message.rowIdentity) merged.set(key, { ...existing, rowIdentity: message.rowIdentity })
  }
  const rows = [...merged.values()].sort(compareRoomMessageRecords)
  const claimed = new Set<string>()
  const knownIds = new Set(current.filter((message) => !message.id.startsWith('optimistic_')).map((message) => message.id))
  const replaced = new Set<string>()
  const identities = new Map<string, string>()
  for (const pending of rows.filter((message) => message.id.startsWith('optimistic_pending_reply_'))) {
    const reply = rows.find((message) => (
      !message.id.startsWith('optimistic_')
      && !knownIds.has(message.id)
      && !claimed.has(message.id)
      && message.authorKind === 'agent'
      && message.authorPrincipalId === pending.authorPrincipalId
      && message.threadRootMessageId === pending.threadRootMessageId
      && message.createdAt >= (pending.updatedAt ?? pending.createdAt) - 2_000
    ))
    if (!reply) continue
    identities.set(reply.id, pending.rowIdentity ?? pending.id)
    claimed.add(reply.id)
    replaced.add(pending.id)
  }
  return rows.filter((message) => !replaced.has(message.id)).map((message) => (
    identities.has(message.id) ? { ...message, rowIdentity: identities.get(message.id) } : message
  ))
}

/**
 * The transcript wrapper keys rows on this identity. It must not flip when the
 * optimistic row is reconciled into the persisted row — a key change remounts
 * the row and replays the message-appear entrance animation (the sent-message
 * blink). The server echoes `clientNonce` back on the persisted row, so the
 * nonce is the stable identity across that transition.
 */
export function roomMessageRowKey(message: Pick<RoomMessageRecord, 'id' | 'clientNonce' | 'rowIdentity'>): string {
  return `room-message-row-${message.rowIdentity ?? message.clientNonce ?? message.id}`
}

/** The server appends "[Attached 2 images: a.png]" to stored content; thumbnails already say that. */
const ATTACHMENT_SUMMARY = /\[Attached [^\]]*\]/g

function stripAttachmentSummary(text: string): string {
  return text.replace(ATTACHMENT_SUMMARY, '').replace(/\n{3,}/g, '\n\n').trim()
}

function displayParts(parts: RoomMessagePart[] | undefined): RoomMessagePart[] | undefined {
  if (!parts?.length) return parts
  return parts
    .map((part) => (
      part.type === 'text' ? { ...part, text: stripAttachmentSummary(part.text ?? '') } : part
    ))
    .filter((part) => part.type !== 'text' || Boolean(part.text))
}

function imageAttachments(parts: RoomMessagePart[] | undefined): RoomMessageAttachment[] {
  if (!parts?.length) return []
  return parts
    .filter((part) => part.type === 'file' && typeof part.url === 'string' && part.url.length > 0)
    .filter((part) => (part.mediaType ?? 'image/').startsWith('image/'))
    .map((part) => ({
      url: part.url!,
      name: part.fileName ?? 'attachment',
      mediaType: part.mediaType,
    }))
}

/**
 * A message belongs to the reader only when the stored author principal matches
 * theirs exactly. Anything unattributed stays someone else's: rendering an
 * unknown author as "You" is the worse failure in a shared room.
 */
export function isOwnRoomMessage(
  message: Pick<RoomMessageRecord, 'authorKind' | 'authorPrincipalId'>,
  currentPrincipalId: string,
): boolean {
  if (message.authorKind !== 'human') return false
  const author = message.authorPrincipalId?.trim()
  const reader = currentPrincipalId.trim()
  return Boolean(author) && Boolean(reader) && author === reader
}

/**
 * Maps a stored room message onto the shared transcript view model. People
 * render as attributed bubbles; agents render through the assistant block
 * sequence so tool calls and markdown survive.
 */
export function toRoomMessageView({
  message,
  currentPrincipalId,
  authorName,
  authorPhotoUrl,
  authorColor,
  authorShape,
  authorIsDefault,
  mentions = [],
  streaming = false,
}: {
  message: RoomMessageRecord
  currentPrincipalId: string
  authorName: string
  authorPhotoUrl?: string
  authorColor?: string
  authorShape?: string
  authorIsDefault?: boolean
  mentions?: Array<{ type: string; id: string; name: string; avatarColor?: string; avatarShape?: string; isDefault?: boolean }>
  streaming?: boolean
}): RoomMessageView {
  const mine = isOwnRoomMessage(message, currentPrincipalId)
  const isAgent = message.authorKind === 'agent' || message.authorKind === 'model'
  const { bodyText, docNames } = splitUserDisplayText(stripAttachmentSummary(message.content ?? ''))
  const blocks: AssistantVisualBlock[] = (() => {
    if (!isAgent) return []
    const sequence = buildAssistantVisualSequence(displayParts(message.parts))
    if (sequence.length > 0) return sequence
    return bodyText ? [{ kind: 'text', text: bodyText }] : []
  })()

  return {
    id: message.id,
    mine,
    // An imported message carries its own author identity; prefer it over the
    // participant-resolved name (the Slack author is usually not a participant).
    authorName: message.importedAuthorName?.trim() || authorName,
    authorPhotoUrl,
    authorEmail: message.importedAuthorEmail,
    authorStatus: message.importedAuthorStatus,
    authorKind: message.authorKind,
    authorColor,
    authorShape,
    authorIsDefault,
    createdAt: message.createdAt,
    eventSequence: message.eventSequence,
    editedAt: message.editedAt,
    editHistory: message.editHistory,
    deletedAt: message.deletedAt,
    delivery: message.delivery,
    deliveryError: message.deliveryError,
    text: bodyText,
    blocks,
    images: imageAttachments(message.parts),
    documentNames: docNames,
    mentions,
    askedBy: askedBy(message),
    nativeApproval: message.authorKind === 'agent' && message.status === 'generating'
      ? readNativeAgentApproval(message.parts?.find((part) => part.type === NATIVE_AGENT_APPROVAL_PART)?.data)
      : undefined,
    nativeInput: nativeInputRequest(message),
    plan: message.agentPlan,
    planPhase: nativeInputRequest(message) ? 'waiting' : message.status === 'generating' ? 'active' : 'ended',
    generationError: isAgent && message.status === 'error'
      ? readNativeAgentError(message.parts)?.message ?? errorLabel(new Error(persistedGenerationErrorMessage(message.content))) ?? undefined
      : undefined,
    // Assistant rows are inserted with status 'generating' at turn start and
    // patched through settle, so createdAt→updatedAt brackets the run.
    workedDurationMs: isAgent && message.updatedAt && message.updatedAt > message.createdAt
      ? message.updatedAt - message.createdAt
      : undefined,
    streaming: streaming || message.status === 'generating',
  }
}

/** The scroll target for pin and thread jumps. */
export function roomMessageDomId(messageId: string): string {
  return `room-message-${messageId}`
}

const JUMP_CENTER_TOLERANCE_PX = 24
const JUMP_SETTLE_TIMEOUT_MS = 1_200
const JUMP_CANCEL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

export function createRoomScrollIntent() {
  let following = true
  let targetingMessage = false
  return {
    followsLatest: () => following,
    navigate: (latest: boolean) => {
      following = latest
      targetingMessage = !latest
    },
    onUserInput: () => { targetingMessage = false },
    onScroll: (nearBottom: boolean) => {
      if (!targetingMessage) following = nearBottom
      return following
    },
  }
}

/**
 * Centres a room message in its scroller. Off-screen rows keep estimated heights
 * until they render, so keep the target centred through bounded layout settling
 * unless the user takes over.
 */
export function scrollRoomMessageIntoView(element: HTMLElement): void {
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const view = element.ownerDocument.defaultView
  const scroller = view ? scrollParent(element, view) : null
  if (!view || !scroller) return
  let frame: number | undefined
  const cleanup = () => {
    view.clearTimeout(timer)
    if (frame !== undefined) view.cancelAnimationFrame(frame)
    scroller.removeEventListener('scrollend', start)
    for (const type of JUMP_CANCEL_EVENTS) view.removeEventListener(type, cleanup, { capture: true })
  }
  const correct = () => {
    if (element.isConnected && Math.abs(centerOffset(element, scroller)) > JUMP_CENTER_TOLERANCE_PX) {
      element.scrollIntoView({ behavior: 'instant', block: 'center' })
    }
  }
  const settle = () => {
    correct()
    frame = view.requestAnimationFrame(settle)
  }
  const start = () => {
    scroller.removeEventListener('scrollend', start)
    settle()
  }
  for (const type of JUMP_CANCEL_EVENTS) view.addEventListener(type, cleanup, { capture: true, passive: true })
  scroller.addEventListener('scrollend', start)
  const timer = view.setTimeout(() => { correct(); cleanup() }, JUMP_SETTLE_TIMEOUT_MS)
}

function scrollParent(element: HTMLElement, view: Window): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = view.getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

function centerOffset(element: HTMLElement, scroller: HTMLElement): number {
  const target = element.getBoundingClientRect()
  const frame = scroller.getBoundingClientRect()
  return (target.top + target.bottom) / 2 - (frame.top + frame.bottom) / 2
}

const ANCHOR_HOLD_TIMEOUT_MS = 1_000

/** The first row visible at the top of the scroller and its offset from that edge. */
export type RoomScrollAnchor = { messageId: string; offset: number }

export function captureRoomScrollAnchor(scroller: HTMLElement): RoomScrollAnchor | null {
  const top = scroller.getBoundingClientRect().top
  for (const row of scroller.querySelectorAll<HTMLElement>('[data-room-message]')) {
    const rect = row.getBoundingClientRect()
    const messageId = row.getAttribute('data-room-message')
    if (messageId && rect.bottom > top) return { messageId, offset: rect.top - top }
  }
  return null
}

/**
 * Keeps the anchored message where the reader left it after older history is
 * prepended. Off-screen rows start at an estimated height and change size as
 * they render, so a scrollHeight delta alone can land far from the reader's
 * place. Corrects from the anchor row's measured position, then for a bounded
 * settle period unless the user takes over. Returns a function that stops it.
 */
export function holdRoomScrollAnchor(scroller: HTMLElement, anchor: RoomScrollAnchor): () => void {
  const document = scroller.ownerDocument
  const correct = () => {
    const element = document.getElementById(roomMessageDomId(anchor.messageId))
    if (!element?.isConnected) return
    const drift = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset
    if (Math.abs(drift) >= 1) scroller.scrollTop += drift
  }
  correct()
  const view = document.defaultView
  if (!view) return () => {}
  let frame: number | undefined
  const settle = () => {
    correct()
    frame = view.requestAnimationFrame(settle)
  }
  const stop = () => {
    view.clearTimeout(timer)
    if (frame !== undefined) view.cancelAnimationFrame(frame)
    for (const type of JUMP_CANCEL_EVENTS) view.removeEventListener(type, stop, { capture: true })
  }
  for (const type of JUMP_CANCEL_EVENTS) view.addEventListener(type, stop, { capture: true, passive: true })
  frame = view.requestAnimationFrame(settle)
  const timer = view.setTimeout(stop, ANCHOR_HOLD_TIMEOUT_MS)
  return stop
}
