import { useCallback, useMemo } from 'react'
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { ACTIVE_AGENT_RUN_STATUSES, isTerminalAgentRunStatus, type AgentRunStatus } from '@/shared/agents/agent-run'
import type { LiveSettlement } from './chatTransport'
import type { AgentRunResource } from '@overlay/api-client'
import type { NativePersonalExecutionState } from '@/components/providers/native-personal-execution'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'
import type { PersonalPendingTurn } from './personal-transcript'

const activeRunStatuses = new Set<string>(ACTIVE_AGENT_RUN_STATUSES)

export function toNativePersonalRun(run: NonNullable<NativePersonalExecutionState['value']>['run'] | null): AgentRunResource | null {
  if (!run) return null
  return {
    id: run.id,
    conversationId: run.conversationId,
    turnId: run.turnId,
    userId: run.userId,
    userMessageId: run.userMessageId,
    assistantMessageId: run.assistantMessageId,
    mode: run.mode,
    runner: run.runner,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    failedAt: run.failedAt,
    cancelledAt: run.cancelledAt,
    terminalError: run.terminalError,
    approval: run.approval,
    inputRequest: run.inputRequest,
    plan: run.plan,
    authorizationPause: run.authorizationPause,
    metrics: run.metrics,
  }
}

/**
 * Resolves when a native personal turn's run is terminal in Convex. It watches the
 * chat's own execution projection, so it keeps working after the person switches
 * chats, and it ends without an outcome when the chat stops being readable.
 */
export function waitForNativePersonalTurn(
  convex: Pick<ConvexReactClient, 'watchQuery'>,
  target: { workspaceId: string; conversationId: string; turnId: string },
): Promise<LiveSettlement> {
  return new Promise((resolve) => {
    const watch = convex.watchQuery(api.chat.personal.getExecution, {
      workspaceId: target.workspaceId,
      conversationId: target.conversationId as Id<'conversations'>,
    })
    let settled = false
    let seen = false
    let unsubscribe: (() => void) | null = null
    const finish = (outcome: LiveSettlement) => {
      if (settled) return
      settled = true
      unsubscribe?.()
      resolve(outcome)
    }
    const check = () => {
      let value: ReturnType<typeof watch.localQueryResult>
      try {
        value = watch.localQueryResult()
      } catch {
        finish('unavailable')
        return
      }
      const run = value?.run
      if (!run) return
      if (run.turnId !== target.turnId) {
        // A later turn started, so this one is over.
        if (seen) finish('completed')
        return
      }
      seen = true
      if (!isTerminalAgentRunStatus(run.status as AgentRunStatus)) return
      finish(run.status === 'failed' ? 'failed' : run.status === 'cancelled' ? 'cancelled' : 'completed')
    }
    unsubscribe = watch.onUpdate(check)
    if (settled) unsubscribe()
    else check()
  })
}

export function nativeLegacyLifecycleArgs(
  nativeMode: boolean,
  conversationId: string | null,
  enabled: boolean,
) {
  return nativeMode
    ? { conversationId: null, enabled: false }
    : { conversationId, enabled }
}

export function nativePendingTurnsForScope(
  turns: Map<string, PersonalPendingTurn> | undefined,
  ownerId: string | null,
  workspaceId: string | null,
  revision?: number,
) {
  void revision
  if (!turns || !ownerId || !workspaceId) return new Map<string, PersonalPendingTurn>()
  return new Map([...turns].filter(([, turn]) =>
    turn.ownerId === ownerId && turn.workspaceId === workspaceId))
}

export type NativeRunCommandScope = {
  enabled: boolean
  writable: boolean
  status: NativePersonalExecutionState['status']
  scopeKey: string
  userId: string | null
  workspaceId: string | null
  conversationId: string | null
  isCurrentScope(): boolean
}

export function nativeRunCommandAllowed({
  scope,
  run,
  activeChatId,
}: {
  scope?: NativeRunCommandScope
  run: AgentRunResource | null
  activeChatId: string | null
}) {
  if (!scope?.enabled) return true
  const activeConversationMatches = activeChatId === scope.conversationId
    || activeChatId === PENDING_FIRST_CHAT_ID || activeChatId === null
  return scope.status === 'ready'
    && scope.writable
    && scope.isCurrentScope()
    && Boolean(scope.userId && scope.workspaceId && scope.conversationId)
    && activeConversationMatches
    && run?.conversationId === scope.conversationId
    && run.userId === scope.userId
}

export function nativeRunCommandIdentity(scopeKey: string, runId: string, token: string) {
  return JSON.stringify([scopeKey, runId, token])
}

export function claimNativeRunCommand(
  identity: string,
  pending: { current: string | null },
  consumed: { current: string | null },
) {
  if (pending.current === identity || consumed.current === identity) return false
  pending.current = identity
  return true
}

export function finishNativeRunCommand(
  identity: string,
  pending: { current: string | null },
  consumed: { current: string | null },
  accepted: boolean,
) {
  if (pending.current === identity) pending.current = null
  if (accepted) consumed.current = identity
}

export function useNativePersonalRunLifecycle({
  enabled,
  execution,
  active,
}: {
  enabled: boolean
  execution: NativePersonalExecutionState
  active: boolean
}) {
  const run = useMemo(
    () => enabled && execution.status === 'ready' ? toNativePersonalRun(execution.value?.run ?? null) : null,
    [enabled, execution],
  )
  const refresh = useCallback(async () => run, [run])
  return {
    run,
    active: enabled && active && Boolean(run?.turnId && activeRunStatuses.has(run.status)),
    shouldSyncMessages: false,
    convexQueryBridge: null,
    liveQueryBridge: null,
    refresh,
  }
}
