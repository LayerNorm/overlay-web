import type { AssistantVisualBlock } from '@overlay/chat-core'
import { buildAssistantVisualSequence, splitUserDisplayText } from '@overlay/chat-core'
import type { RoomMessageAttachment, RoomMessageView } from './RoomMessageItem'

export type RoomMessagePart = {
  type?: string
  text?: string
  url?: string
  mediaType?: string
  fileName?: string
}

export type RoomMessageRecord = {
  id: string
  turnId: string
  authorKind: 'human' | 'agent' | 'model' | 'system'
  authorPrincipalId?: string
  content: string
  parts?: RoomMessagePart[]
  createdAt: number
  editedAt?: number
  deletedAt?: number
  clientNonce?: string
  threadRootMessageId?: string
  delivery?: 'sending' | 'failed'
  status?: 'generating' | 'completed' | 'error'
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
  authorColor,
  mentions = [],
  streaming = false,
}: {
  message: RoomMessageRecord
  currentPrincipalId: string
  authorName: string
  authorColor?: string
  mentions?: Array<{ type: string; id: string; name: string }>
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
    authorName,
    authorKind: message.authorKind,
    authorColor,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    delivery: message.delivery,
    text: bodyText,
    blocks,
    images: imageAttachments(message.parts),
    documentNames: docNames,
    mentions,
    streaming: streaming || message.status === 'generating',
  }
}
