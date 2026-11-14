/**
 * Per-conversation queue of follow-up messages typed while a response streams.
 *
 * Storage failures behave like conversation drafts: the queue stays in memory
 * for this tab and never breaks the shell.
 */

import type { MentionItem } from '@/shared/knowledge/mention-types'

export const QUEUE_STORAGE_PREFIX = 'overlay.queue.v1'
const MAX_QUEUED_MESSAGES = 20
const MAX_QUEUED_TEXT_LENGTH = 20_000

export type QueuedMessage = {
  id: string
  text: string
  mentions: MentionItem[]
}

export type QueueScope = {
  workspaceId?: string | null
  conversationId: string
}

export function queueStorageKey(scope: QueueScope): string {
  return [QUEUE_STORAGE_PREFIX, scope.workspaceId ?? 'personal', scope.conversationId].join(':')
}

export function readQueuedMessages(scope: QueueScope): QueuedMessage[] {
  const storage = safeStorage()
  if (!storage) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(queueStorageKey(scope)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isQueuedMessage).slice(0, MAX_QUEUED_MESSAGES) : []
  } catch {
    return []
  }
}

export function writeQueuedMessages(scope: QueueScope, messages: readonly QueuedMessage[]): void {
  const storage = safeStorage()
  if (!storage) return
  const key = queueStorageKey(scope)
  try {
    if (messages.length === 0) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(messages.slice(0, MAX_QUEUED_MESSAGES).map(message => ({
      ...message,
      text: message.text.slice(0, MAX_QUEUED_TEXT_LENGTH),
    }))))
  } catch {
    // Quota exceeded or storage disabled: the queue lives only in this tab.
  }
}

function isQueuedMessage(value: unknown): value is QueuedMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<QueuedMessage>
  return typeof candidate.id === 'string' && typeof candidate.text === 'string'
    && Boolean(candidate.text.trim()) && Array.isArray(candidate.mentions)
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}
