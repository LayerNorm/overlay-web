import type { Dispatch, SetStateAction } from 'react'
import type { AgentRunResource } from '@overlay/api-client'
import { toast } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  claimNativeRunCommand,
  finishNativeRunCommand,
  nativeRunCommandAllowed,
  nativeRunCommandIdentity,
} from './native-personal-lifecycle'
import type { NativeRunCommandScope } from './native-personal-lifecycle'

export async function submitNativeRunApproval({
  approved,
  activeChatId,
  scope,
  run,
  pendingRef,
  consumedRef,
  setSubmittingKey,
  setConsumedKey,
  getLatestRun,
  refresh,
}: {
  approved: boolean
  activeChatId: string
  scope: NativeRunCommandScope
  run: AgentRunResource
  pendingRef: { current: string | null }
  consumedRef: { current: string | null }
  setSubmittingKey: Dispatch<SetStateAction<string | null>>
  setConsumedKey: Dispatch<SetStateAction<string | null>>
  getLatestRun(): AgentRunResource | null
  refresh(): Promise<unknown>
}) {
  if (!run.approval || run.status !== 'waiting_for_approval') return
  const identity = nativeRunCommandIdentity(scope.scopeKey, run.id, run.approval.token)
  if (!nativeRunCommandAllowed({ scope, run, activeChatId })
    || !claimNativeRunCommand(identity, pendingRef, consumedRef)) return
  setSubmittingKey(identity)
  try {
    await overlayAppClient.conversations.submitRunApproval({
      conversationId: scope.conversationId!,
      agentRunId: run.id,
      token: run.approval.token,
      approved,
    })
    const latestRun = getLatestRun()
    if (!nativeRunCommandAllowed({ scope, run: latestRun, activeChatId })
      || latestRun?.id !== run.id
      || latestRun.approval?.token !== run.approval.token
      || latestRun.status !== 'waiting_for_approval') return
    finishNativeRunCommand(identity, pendingRef, consumedRef, true)
    setConsumedKey(identity)
    await refresh()
  } catch {
    if (scope.isCurrentScope()) toast.error('Could not submit approval.')
  } finally {
    finishNativeRunCommand(identity, pendingRef, consumedRef, false)
    setSubmittingKey(current => current === identity ? null : current)
  }
}
