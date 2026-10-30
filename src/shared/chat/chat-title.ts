export const CHAT_TITLE_UPDATED_EVENT = 'overlay:chat-title-updated'
export const CHAT_CREATED_EVENT = 'overlay:chat-created'
export const CHAT_MODIFIED_EVENT = 'overlay:chat-modified'
export const CHAT_DELETED_EVENT = 'overlay:chat-deleted'
export const CHAT_ARCHIVED_EVENT = 'overlay:chat-archived'
const FALLBACK_CHAT_TITLE = 'New Chat'

export interface ChatTitleUpdatedDetail {
  chatId: string
  title: string
}

export interface ChatCreatedDetail {
  chat: {
    _id: string
    title: string
    lastModified: number
    conversationType?: 'personal' | 'dm' | 'channel'
    externalPlatform?: string
  }
}

export type ChatModifiedDetail = ChatCreatedDetail

export interface ChatDeletedDetail {
  chatId: string
}

export interface ChatArchivedDetail {
  chat: ChatCreatedDetail['chat'] & { archivedAt?: number }
}

export function isPlaceholderChatTitle(title: string | null | undefined): boolean {
  const normalized = title?.trim().toLowerCase()
  return !normalized || normalized === 'new chat' || normalized === 'new thread'
}

export function mergeChatTitle(existing: string, incoming: string): string {
  return isPlaceholderChatTitle(incoming) && !isPlaceholderChatTitle(existing)
    ? existing
    : incoming
}

export function resolveChatModifiedTitle({
  explicitTitle,
  pendingTitle,
  latestListTitle,
  fallback = FALLBACK_CHAT_TITLE,
}: {
  explicitTitle?: string | null
  pendingTitle?: string | null
  latestListTitle?: string | null
  fallback?: string
}): string {
  if (!isPlaceholderChatTitle(explicitTitle)) return explicitTitle!
  if (!isPlaceholderChatTitle(pendingTitle)) return pendingTitle!
  if (!isPlaceholderChatTitle(latestListTitle)) return latestListTitle!
  return fallback
}

export function sanitizeChatTitle(title: string | null | undefined, fallback = FALLBACK_CHAT_TITLE): string {
  const normalized = (title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`“”]+|["'`“”]+$/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .trim()

  const limited = normalized.slice(0, 60).trim()
  return limited || fallback
}

export function fallbackChatTitle(text: string): string {
  const words = text.replace(/[`*_#<>]/g, '').trim().split(/\s+/).slice(0, 8).join(' ')
  return sanitizeChatTitle(words)
}

export function dispatchChatTitleUpdated(detail: ChatTitleUpdatedDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ChatTitleUpdatedDetail>(CHAT_TITLE_UPDATED_EVENT, { detail }))
}

export function dispatchChatCreated(detail: ChatCreatedDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ChatCreatedDetail>(CHAT_CREATED_EVENT, { detail }))
}

export function dispatchChatModified(detail: ChatModifiedDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ChatModifiedDetail>(CHAT_MODIFIED_EVENT, { detail }))
}

export function dispatchChatDeleted(detail: ChatDeletedDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ChatDeletedDetail>(CHAT_DELETED_EVENT, { detail }))
}

export function dispatchChatArchived(detail: ChatArchivedDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ChatArchivedDetail>(CHAT_ARCHIVED_EVENT, { detail }))
}
