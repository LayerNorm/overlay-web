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

const CLAIM_PREFIX = 'overlay.queue.claim.v1'
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000
const TAB_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random())

/**
 * Claims a queued message for this tab before it is sent. Every open tab of a
 * conversation loads the same stored queue, so without a claim each tab would
 * send it. Returns false when another tab already claimed it. Claims hold only
 * an id, a tab id and a time, and expire after a day. When storage is
 * unavailable there is no other tab to coordinate with, so the claim succeeds.
 */
export function claimQueuedMessage(id: string, now = Date.now()): boolean {
  const storage = safeStorage()
  if (!storage) return true
  try {
    const key = `${CLAIM_PREFIX}:${id}`
    const [owner, at] = (storage.getItem(key) ?? '').split('|')
    if (owner && owner !== TAB_ID && now - Number(at) < CLAIM_TTL_MS) return false
    storage.setItem(key, `${TAB_ID}|${now}`)
    pruneClaims(storage, now)
    return true
  } catch {
    return true
  }
}

function pruneClaims(storage: Storage, now: number): void {
  const expired: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(`${CLAIM_PREFIX}:`)) continue
    const at = Number((storage.getItem(key) ?? '').split('|')[1])
    if (!(now - at < CLAIM_TTL_MS)) expired.push(key)
  }
  for (const key of expired) storage.removeItem(key)
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
