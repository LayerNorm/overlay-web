import 'server-only'

import type { Notification, Pool, PoolClient } from 'pg'
import { logger } from '@/server/observability/logger'

export const CONVERSATION_EVENT_NOTIFY_CHANNEL = 'overlay_conversation_events'

export type PostgresConversationEventWaiter = {
  cancel: () => void
  promise: Promise<void>
}

export type PostgresConversationEventListenerHealth = {
  connected: boolean
  lastConnectedAt?: number
  lastDisconnectedAt?: number
  lastError?: string
  reconnectAttempts: number
  state: 'closed' | 'connected' | 'connecting' | 'disconnected'
}

type ClientListeners = {
  end: () => void
  error: (error: Error) => void
  notification: (notification: Notification) => void
}

export class PostgresConversationEventNotifier {
  private client: PoolClient | undefined
  private readonly clientListeners = new WeakMap<PoolClient, ClientListeners>()
  private closing = false
  private lastConnectedAt: number | undefined
  private lastDisconnectedAt: number | undefined
  private lastError: string | undefined
  private readonly options: {
    random: () => number
    reconnectBaseMs: number
    reconnectMaximumMs: number
  }
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private startPromise: Promise<void> | undefined
  private state: PostgresConversationEventListenerHealth['state'] = 'disconnected'
  private readonly waiters = new Map<string, Set<() => void>>()

  constructor(
    private readonly pool: Pick<Pool, 'connect'>,
    options: {
      random?: () => number
      reconnectBaseMs?: number
      reconnectMaximumMs?: number
    } = {},
  ) {
    const reconnectBaseMs = Math.max(10, Math.floor(options.reconnectBaseMs ?? 100))
    this.options = {
      random: options.random ?? Math.random,
      reconnectBaseMs,
      reconnectMaximumMs: Math.max(
        reconnectBaseMs,
        Math.floor(options.reconnectMaximumMs ?? 5_000),
      ),
    }
  }

  getHealth(): PostgresConversationEventListenerHealth {
    return {
      connected: this.state === 'connected',
      ...(this.lastConnectedAt ? { lastConnectedAt: this.lastConnectedAt } : {}),
      ...(this.lastDisconnectedAt ? { lastDisconnectedAt: this.lastDisconnectedAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      reconnectAttempts: this.reconnectAttempts,
      state: this.state,
    }
  }

  async close(): Promise<void> {
    this.closing = true
    this.state = 'closed'
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    const client = this.client
    this.client = undefined
    if (client) {
      this.detachNotificationListener(client)
      await client
        .query(`UNLISTEN ${CONVERSATION_EVENT_NOTIFY_CHANNEL}`)
        .catch((_error) => {})
      this.destroyClient(client)
    }
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
    void this.ensureStarted()
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
      timeout.unref?.()
      const userWaiters = this.waiters.get(args.userId) ?? new Set<() => void>()
      userWaiters.add(finish)
      this.waiters.set(args.userId, userWaiters)
      args.signal?.addEventListener('abort', finish, { once: true })
      if (args.signal?.aborted) finish()
    })
    return { cancel, promise }
  }

  private async ensureStarted(): Promise<void> {
    if (this.closing || this.client || this.startPromise) return await this.startPromise
    this.startPromise = this.start()
      .catch((error) => {
        this.recordDisconnected(error)
        this.scheduleReconnect()
      })
      .finally(() => {
        this.startPromise = undefined
      })
    await this.startPromise
  }

  private async start(): Promise<void> {
    if (this.closing) return
    this.state = 'connecting'
    const client = await this.pool.connect()
    if (this.closing) {
      this.destroyClient(client)
      return
    }
    this.client = client
    this.attachClientListeners(client)
    try {
      await client.query(`LISTEN ${CONVERSATION_EVENT_NOTIFY_CHANNEL}`)
    } catch (error) {
      if (this.client === client) this.client = undefined
      this.detachNotificationListener(client)
      this.destroyClient(client)
      throw error
    }
    if (this.client !== client || this.closing) return
    this.state = 'connected'
    this.reconnectAttempts = 0
    this.lastConnectedAt = Date.now()
    this.lastError = undefined
    logger.info('[chat-sync] Postgres notification listener connected', {
      component: 'conversation_event_listener',
      databaseConnected: true,
      event: 'runtime_health',
      listenerConnected: true,
    })
  }

  private attachClientListeners(client: PoolClient): void {
    const listeners: ClientListeners = {
      notification: (notification) => this.onNotification(notification),
      error: (error) => this.disconnectClient(client, error),
      end: () => this.disconnectClient(client, new Error('Postgres notification listener ended')),
    }
    this.clientListeners.set(client, listeners)
    client.on('notification', listeners.notification)
    client.on('error', listeners.error)
    client.on('end', listeners.end)
  }

  private disconnectClient(client: PoolClient, error: Error): void {
    if (this.client !== client) return
    this.client = undefined
    this.detachNotificationListener(client)
    this.recordDisconnected(error)
    this.destroyClient(client)
    this.resolveAllWaiters()
    this.scheduleReconnect()
  }

  private recordDisconnected(error: unknown): void {
    if (this.closing) return
    this.state = 'disconnected'
    this.lastDisconnectedAt = Date.now()
    this.lastError = error instanceof Error ? error.message : String(error)
    logger.warn('[chat-sync] Postgres notification listener disconnected', {
      component: 'conversation_event_listener',
      databaseConnected: false,
      event: 'runtime_health',
      listenerConnected: false,
      reconnectAttempts: this.reconnectAttempts,
      error: this.lastError,
    })
  }

  private scheduleReconnect(): void {
    if (this.closing || this.client || this.reconnectTimer) return
    this.reconnectAttempts += 1
    const exponentialDelay = Math.min(
      this.options.reconnectMaximumMs,
      this.options.reconnectBaseMs * 2 ** Math.min(this.reconnectAttempts - 1, 8),
    )
    const jitter = 0.75 + Math.max(0, Math.min(1, this.options.random())) * 0.5
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.ensureStarted()
    }, Math.max(1, Math.floor(exponentialDelay * jitter)))
    this.reconnectTimer.unref?.()
  }

  private destroyClient(client: PoolClient): void {
    // Keep error/end listeners attached while pg destroys the socket. Some
    // failovers emit another error after release(true); removing them early can
    // turn that secondary event into an uncaught process-level exception.
    try {
      client.release(true)
    } catch (_error) {
      // The pool may already have removed a client that emitted `end`.
    }
  }

  private detachNotificationListener(client: PoolClient): void {
    const listeners = this.clientListeners.get(client)
    if (listeners) client.off('notification', listeners.notification)
  }

  private onNotification(notification: Notification): void {
    if (notification.channel !== CONVERSATION_EVENT_NOTIFY_CHANNEL) return
    const userId = notification.payload?.trim()
    if (!userId) return
    for (const resolve of this.waiters.get(userId) ?? []) resolve()
  }

  private resolveAllWaiters(): void {
    for (const userWaiters of this.waiters.values()) {
      for (const resolve of userWaiters) resolve()
    }
  }
}
