import 'server-only'

import { randomUUID } from 'node:crypto'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

/**
 * Chat SDK StateAdapter over Convex (`convex/surfaces/chatState.ts`).
 *
 * Slack installations (per-team bot tokens), thread subscriptions, locks, and
 * webhook dedupe keys must be shared by every serverless instance, so the SDK's
 * in-memory state cannot be used in production. Convex is the only app-data
 * provider, and each function is a transaction, which gives the atomicity the
 * SDK contract requires. Values are JSON-serialized like @chat-adapter/state-pg.
 *
 * The interface is declared structurally (no import from the SDK package) so
 * this module stays out of the Workflow builder's source scan; see chat.ts.
 */

type Lock = { threadId: string; token: string; expiresAt: number }
type QueueEntry = { enqueuedAt: number; expiresAt: number; message: unknown }

const fn = (name: string) => `surfaces/chatState:${name}`
const options = { throwOnError: true } as const

function decode<T>(value: string | null | undefined): T | null {
  if (value === null || value === undefined) return null
  try {
    return JSON.parse(value) as T
  } catch (_error) {
    // Rows written by other adapters may hold a raw string; return it as-is.
    return value as T
  }
}

export class ConvexChatStateAdapter {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async subscribe(threadId: string): Promise<void> {
    await convex.mutation(fn('subscribe'), { serverSecret: this.serverSecret, threadId }, options)
  }

  async unsubscribe(threadId: string): Promise<void> {
    await convex.mutation(fn('unsubscribe'), { serverSecret: this.serverSecret, threadId }, options)
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    return (await convex.query<boolean>(fn('isSubscribed'), { serverSecret: this.serverSecret, threadId }, options)) === true
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    return await convex.mutation<Lock | null>(fn('acquireLock'), {
      serverSecret: this.serverSecret,
      threadId,
      token: randomUUID(),
      ttlMs,
    }, options) ?? null
  }

  async releaseLock(lock: Lock): Promise<void> {
    await convex.mutation(fn('releaseLock'), {
      serverSecret: this.serverSecret,
      threadId: lock.threadId,
      token: lock.token,
    }, options)
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    await convex.mutation(fn('releaseLock'), { serverSecret: this.serverSecret, threadId }, options)
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    return (await convex.mutation<boolean>(fn('extendLock'), {
      serverSecret: this.serverSecret,
      threadId: lock.threadId,
      token: lock.token,
      ttlMs,
    }, options)) === true
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    return decode<T>(await convex.query<string | null>(fn('get'), { serverSecret: this.serverSecret, key }, options))
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    await convex.mutation(fn('set'), {
      serverSecret: this.serverSecret,
      key,
      value: JSON.stringify(value),
      ...(ttlMs ? { ttlMs } : {}),
    }, options)
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    return (await convex.mutation<boolean>(fn('setIfNotExists'), {
      serverSecret: this.serverSecret,
      key,
      value: JSON.stringify(value),
      ...(ttlMs ? { ttlMs } : {}),
    }, options)) === true
  }

  async delete(key: string): Promise<void> {
    await convex.mutation(fn('remove'), { serverSecret: this.serverSecret, key }, options)
  }

  async appendToList(key: string, value: unknown, listOptions?: { maxLength?: number; ttlMs?: number }): Promise<void> {
    await convex.mutation(fn('appendToList'), {
      serverSecret: this.serverSecret,
      key,
      value: JSON.stringify(value),
      ...(listOptions?.maxLength ? { maxLength: listOptions.maxLength } : {}),
      ...(listOptions?.ttlMs ? { ttlMs: listOptions.ttlMs } : {}),
    }, options)
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    const values = await convex.query<string[]>(fn('getList'), { serverSecret: this.serverSecret, key }, options) ?? []
    return values.map((value) => decode<T>(value) as T)
  }

  async enqueue(threadId: string, entry: QueueEntry, maxSize: number): Promise<number> {
    return await convex.mutation<number>(fn('enqueue'), {
      serverSecret: this.serverSecret,
      threadId,
      value: JSON.stringify(entry),
      entryExpiresAt: entry.expiresAt,
      maxSize,
    }, options) ?? 0
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    return decode<QueueEntry>(await convex.mutation<string | null>(fn('dequeue'), {
      serverSecret: this.serverSecret,
      threadId,
    }, options))
  }

  async queueDepth(threadId: string): Promise<number> {
    return await convex.query<number>(fn('queueDepth'), { serverSecret: this.serverSecret, threadId }, options) ?? 0
  }
}
