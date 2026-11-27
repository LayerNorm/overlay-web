import 'server-only'

import { randomUUID } from 'node:crypto'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

/** The Chat SDK's lock and queue shapes, restated: no file may name the SDK package (src/server/workflows/workflow-imports.test.ts). */
type Lock = { threadId: string; token: string; expiresAt: number }
type QueueEntry = { enqueuedAt: number; expiresAt: number; message: unknown }

const call = { throwOnError: true } as const
const fn = (name: string) => `integrations/slack:${name}`

/** Values cross into Convex as JSON text: SDK values carry Dates and undefined fields Convex cannot store. */
const encode = (value: unknown) => JSON.stringify(value)
const decode = <T>(value: unknown): T | null => (typeof value === 'string' ? JSON.parse(value) as T : null)

/**
 * Chat SDK state in Convex (table slackChatState), so installations, thread subscriptions, locks and webhook
 * dedupe keys are shared by every serverless instance and survive deploys. Installations are stored encrypted by
 * the Slack adapter before they reach this adapter.
 */
export class ConvexSlackState {
  private secret() {
    return getInternalApiSecret()
  }

  private async query<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return (await convex.query<T>(fn(name), { serverSecret: this.secret(), ...args }, call)) as T
  }

  private async mutation<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return (await convex.mutation<T>(fn(name), { serverSecret: this.secret(), ...args }, call)) as T
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async get<T = unknown>(key: string): Promise<T | null> {
    return decode<T>(await this.query<unknown>('stateGet', { key }))
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    await this.mutation('stateSet', { key, value: encode(value), ...(ttlMs ? { ttlMs } : {}) })
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    return await this.mutation<boolean>('stateSetIfNotExists', { key, value: encode(value), ...(ttlMs ? { ttlMs } : {}) })
  }

  async delete(key: string): Promise<void> {
    await this.mutation('stateDelete', { key })
  }

  async subscribe(threadId: string): Promise<void> {
    await this.set(`subscription:${threadId}`, true)
  }

  async unsubscribe(threadId: string): Promise<void> {
    await this.delete(`subscription:${threadId}`)
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    return (await this.get<boolean>(`subscription:${threadId}`)) === true
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    return await this.mutation<Lock | null>('lockAcquire', { threadId, token: randomUUID(), ttlMs })
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    return await this.mutation<boolean>('lockExtend', { threadId: lock.threadId, token: lock.token, ttlMs })
  }

  async releaseLock(lock: Lock): Promise<void> {
    await this.mutation('lockRelease', { threadId: lock.threadId, token: lock.token })
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    await this.mutation('lockRelease', { threadId })
  }

  async appendToList(key: string, value: unknown, options?: { maxLength?: number; ttlMs?: number }): Promise<void> {
    await this.mutation('stateAppend', {
      key, value: encode(value),
      ...(options?.maxLength ? { maxLength: options.maxLength } : {}),
      ...(options?.ttlMs ? { ttlMs: options.ttlMs } : {}),
    })
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    const value = await this.query<unknown>('stateGet', { key })
    return Array.isArray(value) ? value.flatMap(entry => { const parsed = decode<T>(entry); return parsed === null ? [] : [parsed] }) : []
  }

  async enqueue(threadId: string, entry: QueueEntry, maxSize: number): Promise<number> {
    return await this.mutation<number>('stateAppend', { key: `queue:${threadId}`, value: encode(entry), maxLength: maxSize })
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    return decode<QueueEntry>(await this.mutation<unknown>('stateShift', { key: `queue:${threadId}` }))
  }

  async queueDepth(threadId: string): Promise<number> {
    return (await this.getList(`queue:${threadId}`)).length
  }
}
