'use client'

import { useMemo, useState } from 'react'
import { useQueries, type RequestForQueries } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { api } from '../../../../../convex/_generated/api'
import { useNativeCollaboration } from './NativeCollaborationProvider'
import type { RoomMessageRecord } from './room-message-view'

type Result = FunctionReturnType<typeof api.collaboration.nativeRooms.listThreadSummaries>
const EMPTY_QUERIES: RequestForQueries = {}
const EMPTY_RESULTS: Record<string, NonNullable<Result>> = {}

export function useNativeThreadSummaries(workspaceId: string, conversationId: string, roots: RoomMessageRecord[], pending: RoomMessageRecord[]) {
  const native = useNativeCollaboration()
  const enabled = native.status === 'ready' && native.workspaceId === workspaceId
  const rootIdsKey = JSON.stringify([...new Set(roots.filter(row => !row.threadRootMessageId && row.deletedAt === undefined).map(row => row.id))].sort())
  const pendingKey = JSON.stringify(pending.filter(row => row.delivery === 'sending' && row.clientNonce && row.clientNonce.length <= 256 && row.threadRootMessageId)
    .map(row => [row.threadRootMessageId, row.clientNonce]).sort())
  const queries = useMemo(() => {
    if (!enabled) return EMPTY_QUERIES
    const ids = JSON.parse(rootIdsKey) as Id<'conversationMessages'>[]
    if (!ids.length) return EMPTY_QUERIES
    const waiting = JSON.parse(pendingKey) as [string, string][]
    const map: RequestForQueries = {}
    for (let i = 0; i < ids.length; i += 100) {
      const rootMessageIds = ids.slice(i, i + 100)
      map[String(i)] = { query: api.collaboration.nativeRooms.listThreadSummaries, args: { workspaceId, conversationId,
        rootMessageIds, pendingReplyNonces: waiting.filter(([root]) => rootMessageIds.includes(root as Id<'conversationMessages'>)).map(([, nonce]) => nonce).slice(0, 100) } }
    }
    return map
  }, [enabled, rootIdsKey, pendingKey, workspaceId, conversationId])
  const results = useQueries(queries) as Record<string, Result | undefined | Error>
  const scopeKey = JSON.stringify([native.scopeKey, native.viewerUserId, workspaceId, conversationId, rootIdsKey])
  const denied = Object.values(results).includes(null)
  const [previous, setPrevious] = useState<{ scopeKey: string; results: Record<string, NonNullable<Result>> }>({ scopeKey, results: {} })
  const changed = Object.entries(results).some(([key, result]) => result && !(result instanceof Error) && result !== previous.results[key])
  if (previous.scopeKey !== scopeKey || (denied ? Object.keys(previous.results).length > 0 : changed)) {
    const next = previous.scopeKey === scopeKey ? { ...previous.results } : {}
    for (const [key, result] of Object.entries(results)) if (result && !(result instanceof Error)) next[key] = result
    setPrevious({ scopeKey, results: denied ? {} : next })
  }
  const cached = previous.scopeKey === scopeKey && !denied ? previous.results : EMPTY_RESULTS
  return useMemo(() => {
    const replyCounts = new Map<string, number>()
    const replyCountsCapped = new Set<string>()
    const threadTeasers = new Map<string, RoomMessageRecord>()
    for (const [key, current] of Object.entries(results)) {
      if (current instanceof Error) throw current
      const result = current === undefined ? cached[key] : current
      if (denied || !enabled || !result || result.workspaceId !== workspaceId || result.conversationId !== conversationId || result.viewerUserId !== native.viewerUserId) continue
      for (const summary of result.summaries) {
        const latest = summary.latestReply
        replyCounts.set(summary.rootMessageId, summary.replyCount.count)
        if (summary.replyCount.capped) replyCountsCapped.add(summary.rootMessageId)
        if (latest) threadTeasers.set(summary.rootMessageId, { ...latest, turnId: latest.id, threadRootMessageId: summary.rootMessageId })
        const requested = current ? queries[key]?.args.pendingReplyNonces as string[] | undefined : undefined
        const seen = new Set(result.acknowledgedReplyNonces)
        for (const row of pending) {
          if (row.threadRootMessageId !== summary.rootMessageId || row.delivery !== 'sending' || !row.clientNonce || !requested?.includes(row.clientNonce) || seen.has(row.clientNonce) || latest?.clientNonce === row.clientNonce) continue
          seen.add(row.clientNonce)
          replyCounts.set(summary.rootMessageId, (replyCounts.get(summary.rootMessageId) ?? 0) + 1)
          if (!latest || row.createdAt > latest.createdAt) threadTeasers.set(summary.rootMessageId, row)
        }
      }
    }
    return { replyCounts, replyCountsCapped, threadTeasers }
  }, [results, enabled, workspaceId, conversationId, native.viewerUserId, queries, pending, cached, denied])
}
