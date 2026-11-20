'use client'

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react'
import type { ConvexReactClient } from 'convex/react'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  createTranscriptCache,
  DEFAULT_TRANSCRIPT_CACHE_LIMITS,
  transcriptCacheKey,
  type TranscriptCacheScope,
  type TranscriptCacheTarget,
} from '@/shared/chat/transcript-cache'

export type PersonalCachedRow = FunctionReturnType<typeof api.chat.personal.getMessages>['page'][number]
export type PersonalCachedSummary = NonNullable<FunctionReturnType<typeof api.chat.personal.getSummary>>
export type RoomCachedMessage = FunctionReturnType<typeof api.collaboration.rooms.messages>['page'][number]
export type RoomCachedAccess = NonNullable<FunctionReturnType<typeof api.collaboration.rooms.access>>
export type RoomCachedState = NonNullable<FunctionReturnType<typeof api.collaboration.rooms.state>>

/** One cache per browser tab: a room keeps its timeline and its live state as two entries. */
export const transcriptCache = createTranscriptCache({ ...DEFAULT_TRANSCRIPT_CACHE_LIMITS, maxEntries: 32 })

export const ROOM_STATE_VARIANT = 'state'
export const TRANSCRIPT_PREFETCH_INTENT_MS = 120
const MAX_PREFETCHES_IN_FLIGHT = 2
const MAX_PREFETCHES_QUEUED = 4
/** A snapshot this recent is not fetched again on hover. */
const PREFETCH_FRESH_MS = 20_000
const FIRST_PAGE = 50
const PREFETCH_TIMEOUT_MS = 10_000

type TranscriptPrefetchTarget = { kind: 'personal' | 'room'; conversationId: string }

type TranscriptCacheContextValue = {
  scope: TranscriptCacheScope
  /** Starts a prefetch after the hover/focus intent delay unless cancelled first. */
  intend(target: TranscriptPrefetchTarget): void
  cancel(): void
}

const TranscriptCacheContext = createContext<TranscriptCacheContextValue | null>(null)

/**
 * Publishes the signed-in user and active workspace that every cache key carries.
 * Logout, an account switch or a workspace switch clears the whole cache.
 */
export function TranscriptCacheScopeProvider({ client, userId, workspaceId, children }: {
  client: ConvexReactClient
  userId: string | null
  workspaceId: string | null
  children: ReactNode
}) {
  const value = useMemo<TranscriptCacheContextValue | null>(() => {
    if (!userId || !workspaceId) return null
    const scope = { userId, workspaceId }
    let timer: ReturnType<typeof setTimeout> | null = null
    const cancel = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
    return {
      scope,
      cancel,
      intend(target) {
        cancel()
        timer = setTimeout(() => {
          timer = null
          prefetchTranscript(client, scope, target)
        }, TRANSCRIPT_PREFETCH_INTENT_MS)
      },
    }
  }, [client, userId, workspaceId])
  useLayoutEffect(() => { transcriptCache.setIdentity(value?.scope ?? null) }, [value])
  useEffect(() => () => value?.cancel(), [value])
  return <TranscriptCacheContext.Provider value={value}>{children}</TranscriptCacheContext.Provider>
}

export function useTranscriptCacheScope(): TranscriptCacheScope | null {
  return useContext(TranscriptCacheContext)?.scope ?? null
}

const NO_PREFETCH = { intend: () => undefined, cancel: () => undefined }

/** Hover and focus handlers for a sidebar row; inert outside a cache scope. */
export function useTranscriptPrefetchIntent(): Pick<TranscriptCacheContextValue, 'intend' | 'cancel'> {
  return useContext(TranscriptCacheContext) ?? NO_PREFETCH
}

/** The cache key for a conversation, or null when it is not cacheable in the current scope. */
export function useTranscriptCacheKey(target: TranscriptCacheTarget | null, workspaceId: string | null | undefined) {
  const scope = useTranscriptCacheScope()
  const kind = target?.kind
  const conversationId = target?.conversationId
  const variant = target?.variant
  return useMemo(() => scope && kind && conversationId && scope.workspaceId === workspaceId
    ? transcriptCacheKey(scope, { kind, conversationId, variant })
    : null, [conversationId, kind, scope, variant, workspaceId])
}

let inFlight = 0
const queued: Array<{ key: string; run: (signal: AbortSignal) => Promise<void> }> = []
const pendingKeys = new Set<string>()

function pump() {
  while (inFlight < MAX_PREFETCHES_IN_FLIGHT && queued.length > 0) {
    const next = queued.shift()!
    inFlight += 1
    let timer: ReturnType<typeof setTimeout> | undefined
    // A read stalled by a dropped connection must not hold a slot forever, and its subscription is closed with it,
    // so the limit on reads in flight still holds.
    const abort = new AbortController()
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(() => { abort.abort(); resolve() }, PREFETCH_TIMEOUT_MS) })
    void Promise.race([next.run(abort.signal), timeout]).catch(() => undefined).finally(() => {
      clearTimeout(timer)
      inFlight -= 1
      pendingKeys.delete(next.key)
      pump()
    })
  }
}

/**
 * One read of a query that can be cancelled: `client.query` keeps its subscription until a result arrives, so a
 * read stalled by a dropped connection would stay open after its prefetch gave up.
 */
function queryOnce<Query extends FunctionReference<'query'>>(client: ConvexReactClient, query: Query,
  args: FunctionArgs<Query>, signal: AbortSignal): Promise<FunctionReturnType<Query>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Prefetch cancelled')); return }
    const watch = client.watchQuery(query, args)
    let settled = false
    let unsubscribe = () => {}
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      unsubscribe()
      signal.removeEventListener('abort', onAbort)
      settle()
    }
    const onAbort = () => finish(() => reject(new Error('Prefetch cancelled')))
    const check = () => {
      try {
        const value = watch.localQueryResult()
        if (value !== undefined) finish(() => resolve(value))
      } catch (error) {
        finish(() => reject(error))
      }
    }
    unsubscribe = watch.onUpdate(check)
    signal.addEventListener('abort', onAbort, { once: true })
    check()
  })
}

function isFresh(key: string) {
  const entry = transcriptCache.get(key)
  return Boolean(entry && Date.now() - entry.storedAt < PREFETCH_FRESH_MS)
}

async function prefetchPersonal(client: ConvexReactClient, scope: TranscriptCacheScope, conversationId: string,
  key: string, generation: number, signal: AbortSignal) {
  const args = { workspaceId: scope.workspaceId, conversationId: conversationId as Id<'conversations'> }
  const summary = await queryOnce(client, api.chat.personal.getSummary, args, signal)
  if (transcriptCache.generation() !== generation) return
  if (!summary || summary._id !== conversationId || summary.workspaceId !== scope.workspaceId) {
    transcriptCache.evict(key)
    return
  }
  const page = await queryOnce(client, api.chat.personal.getMessages, {
    ...args, paginationOpts: { numItems: FIRST_PAGE, cursor: null },
  }, signal)
  transcriptCache.put<PersonalCachedRow, PersonalCachedSummary>(key, {
    items: page.page.filter(row => row.message.conversationId === conversationId),
    summary,
    isDone: page.isDone,
    source: 'prefetch',
  }, generation)
}

async function prefetchRoom(client: ConvexReactClient, scope: TranscriptCacheScope, conversationId: string,
  key: string, generation: number, signal: AbortSignal) {
  const args = { workspaceId: scope.workspaceId, conversationId: conversationId as Id<'conversations'> }
  const stateKey = transcriptCacheKey(scope, { kind: 'room', conversationId, variant: ROOM_STATE_VARIANT })
  const access = await queryOnce(client, api.collaboration.rooms.access, args, signal)
  if (transcriptCache.generation() !== generation) return
  if (!access) {
    transcriptCache.evict(key)
    transcriptCache.evict(stateKey)
    return
  }
  const [state, page] = await Promise.all([
    queryOnce(client, api.collaboration.rooms.state, args, signal),
    queryOnce(client, api.collaboration.rooms.messages, { ...args, paginationOpts: { numItems: FIRST_PAGE, cursor: null } }, signal),
  ])
  if (!state) {
    transcriptCache.evict(key)
    transcriptCache.evict(stateKey)
    return
  }
  transcriptCache.put<RoomCachedMessage, RoomCachedAccess>(key, {
    items: page.page.filter(message => !message.conversationId || message.conversationId === conversationId),
    summary: access,
    isDone: page.isDone,
    source: 'prefetch',
  }, generation)
  transcriptCache.put<never, RoomCachedState>(stateKey, { items: [], summary: state, isDone: true, source: 'prefetch' }, generation)
}

/**
 * Reads a conversation's first page once and stores it where its transcript
 * hook looks first. One-shot reads only: nothing stays subscribed and nothing
 * is written to the backend. At most two run at once; extra requests replace
 * the oldest queued ones.
 */
export function prefetchTranscript(client: ConvexReactClient, scope: TranscriptCacheScope,
  target: TranscriptPrefetchTarget) {
  // Draft and optimistic ids are not documents yet; there is nothing to read.
  if (!/^[0-9a-z]{20,40}$/.test(target.conversationId)) return
  const key = transcriptCacheKey(scope, target)
  if (pendingKeys.has(key) || isFresh(key)) return
  const generation = transcriptCache.generation()
  pendingKeys.add(key)
  queued.push({
    key,
    run: (signal) => target.kind === 'personal'
      ? prefetchPersonal(client, scope, target.conversationId, key, generation, signal)
      : prefetchRoom(client, scope, target.conversationId, key, generation, signal),
  })
  while (queued.length > MAX_PREFETCHES_QUEUED) pendingKeys.delete(queued.shift()!.key)
  pump()
}
