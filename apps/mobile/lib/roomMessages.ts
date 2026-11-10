/**
 * Room (DM/channel) message model — native port of the web's
 * `room-message-view.ts` semantics: author attribution, optimistic delivery,
 * merge-by-clientNonce ordering, and the Slack-style flat-row view model.
 *
 * The server shape extends `ConversationMessage` with collaboration fields
 * (`authorKind`, `authorPrincipalId`, `eventSequence`, `editedAt`, `deletedAt`,
 * `threadRootMessageId`, imported-author identity for Slack-bridged rows).
 */
import {
  buildAssistantVisualSequence,
  splitUserDisplayText,
  type AssistantVisualBlock,
} from '@overlay/chat-core'

export type RoomAuthorKind = 'human' | 'agent' | 'model' | 'system'

export function channelComposerPlaceholder(name: string): string {
  return `Message #${name.trim().replace(/^#+/, '') || '…'}`
}

export type RoomMessagePart = {
  type?: string
  text?: string
  url?: string
  mediaType?: string
  fileName?: string
  data?: Record<string, unknown>
}

export interface RoomMessageRecord {
  id: string
  turnId?: string
  authorKind: RoomAuthorKind
  authorPrincipalId?: string
  importedAuthorName?: string
  importedAuthorEmail?: string
  importedAuthorStatus?: 'member' | 'invited' | 'not_invited'
  content: string
  parts?: RoomMessagePart[]
  createdAt: number
  updatedAt?: number
  eventSequence?: number
  editedAt?: number
  deletedAt?: number
  clientNonce?: string
  threadRootMessageId?: string
  status?: 'generating' | 'completed' | 'error'
  /** Local-only optimistic delivery state. */
  delivery?: 'sending' | 'failed'
}

export type RoomMessageAttachment = {
  url: string
  name: string
  mediaType?: string
}

export interface RoomMessageView {
  id: string
  mine: boolean
  authorName: string
  authorKind: RoomAuthorKind
  authorColor?: string
  authorShape?: string
  authorEmail?: string
  createdAt: number
  editedAt?: number
  deletedAt?: number
  delivery?: 'sending' | 'failed'
  text: string
  blocks: AssistantVisualBlock[]
  images: RoomMessageAttachment[]
  documentNames: string[]
  replyToTurnId?: string
  streaming?: boolean
}

/** Stable ordering — same as web `compareRoomMessageRecords`. */
export function compareRoomMessageRecords(
  left: Pick<RoomMessageRecord, 'id' | 'createdAt'>,
  right: Pick<RoomMessageRecord, 'id' | 'createdAt'>,
): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
}

/**
 * Merge freshly persisted rows into the current list without dropping
 * optimistic sends. Server echoes `clientNonce` back, so nonce is the
 * reconciliation key — same semantics as web `mergeRoomMessages`.
 */
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
    if (!existing || (existing.delivery && !message.delivery)) merged.set(key, message)
  }
  return [...merged.values()].sort(compareRoomMessageRecords)
}

const ATTACHMENT_SUMMARY = /\[Attached [^\]]*\]/g

function stripAttachmentSummary(text: string): string {
  return text.replace(ATTACHMENT_SUMMARY, '').replace(/\n{3,}/g, '\n\n').trim()
}

function displayParts(parts: RoomMessagePart[] | undefined): RoomMessagePart[] | undefined {
  if (!parts?.length) return parts
  return parts
    .map((part) =>
      part.type === 'text' ? { ...part, text: stripAttachmentSummary(part.text ?? '') } : part,
    )
    .filter((part) => part.type !== 'text' || Boolean(part.text))
}

function imageAttachments(parts: RoomMessagePart[] | undefined): RoomMessageAttachment[] {
  if (!parts?.length) return []
  return parts
    .filter((part) => part.type === 'file' && typeof part.url === 'string' && part.url.length > 0)
    .filter((part) => (part.mediaType ?? 'image/').startsWith('image/'))
    .map((part) => ({ url: part.url!, name: part.fileName ?? 'attachment', mediaType: part.mediaType }))
}

/**
 * A message belongs to the reader only when the stored author principal
 * matches theirs exactly — same rule as web `isOwnRoomMessage`.
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

export function toRoomMessageView({
  message,
  currentPrincipalId,
  authorName,
  authorColor,
  authorShape,
  streaming = false,
}: {
  message: RoomMessageRecord
  currentPrincipalId: string
  authorName: string
  authorColor?: string
  authorShape?: string
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
    authorName: message.importedAuthorName?.trim() || authorName,
    authorEmail: message.importedAuthorEmail,
    authorKind: message.authorKind,
    authorColor,
    authorShape,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    delivery: message.delivery,
    text: bodyText,
    blocks,
    images: imageAttachments(message.parts),
    documentNames: docNames,
    streaming,
  }
}

/**
 * Scans message text for `@DisplayName` tokens matching room participants —
 * same mechanism web `resolveMentionTargets` uses to derive
 * `mentionedPrincipalIds` for `addMessage`.
 */
export function resolveMentionTargets(
  text: string,
  participants: Array<{ principalId: string; displayName: string; status?: string }>,
): string[] {
  const lowered = text.toLowerCase()
  const ids = new Set<string>()
  for (const participant of participants) {
    if (participant.status === 'removed') continue
    const name = participant.displayName.trim()
    if (!name) continue
    if (lowered.includes(`@${name.toLowerCase()}`)) {
      ids.add(participant.principalId)
    }
  }
  return [...ids]
}

export function isSameDay(left: number, right: number): boolean {
  const a = new Date(left)
  const b = new Date(right)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function dayLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(timestamp, today.getTime())) return 'Today'
  if (isSameDay(timestamp, yesterday.getTime())) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Slack-style grouping: a message renders compactly (no avatar/author row)
 * when the previous main message shares author + day within a 5-minute gap.
 */
export function isGroupedWithPrevious(
  previous: RoomMessageRecord | undefined,
  current: RoomMessageRecord,
): boolean {
  if (!previous) return false
  if (previous.authorKind !== current.authorKind) return false
  if (previous.authorPrincipalId !== current.authorPrincipalId) return false
  if (!isSameDay(previous.createdAt, current.createdAt)) return false
  return current.createdAt - previous.createdAt < 5 * 60 * 1000
}
