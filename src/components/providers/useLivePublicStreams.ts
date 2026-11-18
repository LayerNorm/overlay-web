'use client'

import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import type { FunctionReference } from 'convex/server'
import type { ActivePublicStreamSnapshot } from '@/shared/chat/public-stream-projection'
import {
  mergePublicStreamUpdates,
  publicStreamCursors,
  type HeldPublicStream,
  type PublicStreamUpdate,
} from '@/shared/chat/public-stream-updates'
import { usePublicStreamMetrics } from './usePublicStreamMetrics'

type StreamScope = { workspaceId: string; conversationId: string }
type FullQuery = FunctionReference<'query', 'public', StreamScope & { messageIds: string[] }, ActivePublicStreamSnapshot[]>
type UpdatesQuery = FunctionReference<'query', 'public',
  StreamScope & { messageIds: string[]; cursors: ReturnType<typeof publicStreamCursors> }, PublicStreamUpdate[]>

const EMPTY: ReadonlyMap<string, HeldPublicStream> = new Map()
const NO_STREAMS: ActivePublicStreamSnapshot[] = []

/**
 * Live reply text for every thread kind, read straight from Convex. Each read sends
 * what this reader already holds, so a long reply costs only its newest segment per
 * update. Backends without the incremental query (\`incremental\` false during a
 * web-first rollout) are read whole. Reconnects re-read on their own through Convex.
 */
export function useLivePublicStreams({
  scope,
  messageIds: requestedMessageIds,
  incremental,
  fullQuery,
  updatesQuery,
}: {
  scope: StreamScope | null
  /** Replies still generating; only these are read, and none means no subscription. */
  messageIds: readonly string[]
  incremental: boolean
  fullQuery: FullQuery
  updatesQuery: UpdatesQuery
}): ActivePublicStreamSnapshot[] {
  const scopeKey = scope ? JSON.stringify([scope.workspaceId, scope.conversationId]) : null
  const idsKey = requestedMessageIds.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value so a caller's fresh array keeps the result stable
  const messageIds = useMemo(() => [...requestedMessageIds], [idsKey])
  const [state, setState] = useState<{
    scopeKey: string | null
    held: ReadonlyMap<string, HeldPublicStream>
    applied: readonly PublicStreamUpdate[] | null
  }>({ scopeKey, held: EMPTY, applied: null })
  const held = state.scopeKey === scopeKey ? state.held : EMPTY
  const active = scope !== null && messageIds.length > 0
  const cursors = useMemo(() => publicStreamCursors(held, messageIds), [held, messageIds])
  const updates = useQuery(updatesQuery, active && incremental
    ? { ...scope, messageIds: [...messageIds], cursors }
    : 'skip')
  const whole = useQuery(fullQuery, active && !incremental ? { ...scope, messageIds: [...messageIds] } : 'skip')

  if (active && incremental && updates !== undefined && (updates !== state.applied || state.scopeKey !== scopeKey)) {
    setState({ scopeKey, held: mergePublicStreamUpdates(held, updates), applied: updates })
  }

  const streams = useMemo(() => {
    if (!active) return NO_STREAMS
    if (!incremental) return whole ?? NO_STREAMS
    const ids = new Set(messageIds)
    return [...held.values()].filter(stream => ids.has(stream.assistantMessageId)).map(stream => stream.snapshot)
  }, [active, held, incremental, messageIds, whole])
  usePublicStreamMetrics(streams)
  return streams
}
