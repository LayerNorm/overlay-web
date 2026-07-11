import 'server-only'

import type { Notification, Pool, PoolClient } from 'pg'
import { logger } from '@/server/observability/logger'

export const CONVERSATION_EVENT_NOTIFY_CHANNEL = 'overlay_conversation_events'

export type PostgresConversationEventWaiter = {
  cancel: () => void
  promise: Promise<void>
}

export class PostgresConversationEventNotifier {
  private client: PoolClient | undefined
  private startPromise: Promise<void> | undefined
  private readonly waiters = new Map<string, Set<() => void>>()

  constructor(private readonly pool: Pool) {}

  private readonly handleNotification = (notification: Notification) => {
    this.onNotification(notification)
  }

  private readonly handleError = (error: Error) => {
    logger.warn('[chat-sync] Postgres notification listener disconnected', {
      error: error.message,
    })
    if (this.client) this.resetClient(this.client)
  }

  private readonly handleEnd = () => {
    if (this.client) this.resetClient(this.client)
  }

  async close(): Promise<void> {
    const client = this.client
    this.client = undefined
    if (!client) return
    this.removeClientListeners(client)
    await client
      .query(`UNLISTEN ${CONVERSATION_EVENT_NOTIFY_CHANNEL}`)
      .catch((_error) => {})
    client.release()
    this.resolveAllWaiters()
  }

  async waitForUser(args: {
    signal?: AbortSignal
    timeoutMs: number
    userId: string
  }): Promise<void> {
    const waiter = await this.createWaiter(args)
    await waiter.promise
  }

  async createWaiter(args: {
    signal?: AbortSignal
    timeoutMs: number
    userId: string
  }): Promise<PostgresConversationEventWaiter> {
    await this.ensureStarted()
    let cancel = () => {}
    const promise = new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        args.signal?.removeEventListener('abort', finish)
        const userWaiters = this.waiters.get(args.userId)
        userWaiters?.delete(finish)
        if (userWaiters?.size === 0) this.waiters.delete(args.userId)
        resolve()
      }
      cancel = finish
      const timeout = setTimeout(finish, Math.max(1, args.timeoutMs))
      const userWaiters = this.waiters.get(args.userId) ?? new Set<() => void>()
      userWaiters.add(finish)
      this.waiters.set(args.userId, userWaiters)
      args.signal?.addEventListener('abort', finish, { once: true })
      if (args.signal?.aborted) finish()
    })
    return { cancel, promise }
  }

  private async ensureStarted(): Promise<void> {
    if (this.client) return
    if (this.startPromise) return await this.startPromise
    this.startPromise = this.start().finally(() => {
      this.startPromise = undefined
    })
    return await this.startPromise
  }

  private async start(): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query(`LISTEN ${CONVERSATION_EVENT_NOTIFY_CHANNEL}`)
    } catch (error) {
      client.release(true)
      throw error
    }
    this.client = client
    client.on('notification', this.handleNotification)
    client.on('error', this.handleError)
    client.on('end', this.handleEnd)
  }

  private onNotification(notification: Notification): void {
    if (notification.channel !== CONVERSATION_EVENT_NOTIFY_CHANNEL) return
    const userId = notification.payload?.trim()
    if (!userId) return
    for (const resolve of this.waiters.get(userId) ?? []) resolve()
  }

  private resetClient(client: PoolClient): void {
    if (this.client !== client) return
    this.client = undefined
    this.removeClientListeners(client)
    try {
      client.release(true)
    } catch (_error) {
      // The pool may already have removed a client that emitted `end`.
    }
    this.resolveAllWaiters()
  }

  private removeClientListeners(client: PoolClient): void {
    client.off('notification', this.handleNotification)
    client.off('error', this.handleError)
    client.off('end', this.handleEnd)
  }

  private resolveAllWaiters(): void {
    for (const userWaiters of this.waiters.values()) {
      for (const resolve of userWaiters) resolve()
    }
  }
}
