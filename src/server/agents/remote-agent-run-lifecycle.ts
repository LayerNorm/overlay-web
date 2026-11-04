import 'server-only'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { RemoteRunState } from '@/shared/agents/remote-run'

type Coordinator = { runId: string; coordinatorId: string; generation: number }
export type RemoteRunSnapshot = {
  runId: string
  workspaceId: string
  environmentId: string
  environmentKind: string
  lifecycle: RemoteRunState
  actorUserId?: string
  agentId?: string
  nativeRestorationAdvertised?: boolean
  nativePreparationPending?: boolean
}

export async function readRemoteRun(runId: string): Promise<RemoteRunSnapshot | null> {
  'use step'
  return lazyConvex.query('agents/remoteRuns:readByServer', { serverSecret: getInternalApiSecret(), runId }, { throwOnError: true })
}

export async function claimRemoteRunCoordinator(input: Coordinator): Promise<boolean> {
  'use step'
  return await lazyConvex.mutation<boolean>('agents/remoteRuns:claimByServer', { serverSecret: getInternalApiSecret(), ...input, now: Date.now() }, { throwOnError: true }) ?? false
}

export async function advanceRemoteRun(input: Coordinator): Promise<RemoteRunState | null> {
  'use step'
  return lazyConvex.mutation('agents/remoteRuns:advanceByServer', { serverSecret: getInternalApiSecret(), ...input, now: Date.now() }, { throwOnError: true })
}

export async function wakeRemoteRun(input: Coordinator): Promise<void> {
  'use step'
  const serverSecret = getInternalApiSecret()
  const snapshot = await lazyConvex.query<RemoteRunSnapshot | null>('agents/remoteRuns:readByServer', { serverSecret, runId: input.runId }, { throwOnError: true })
  if (!snapshot || snapshot.environmentKind === 'overlay_cloud'
    || snapshot.lifecycle.coordinatorId !== input.coordinatorId
    || snapshot.lifecycle.coordinatorGeneration !== input.generation
    || !['queued', 'waking'].includes(snapshot.lifecycle.phase)
    || Date.now() >= snapshot.lifecycle.hardDeadlineAt) return
  await lazyConvex.mutation('agents/remoteRuns:advanceByServer', { serverSecret, ...input, wake: true, now: Date.now() }, { throwOnError: true })
}

// Keep these step names inert for workflows started before hosted runtime retirement.
export async function restoreStoppedRemoteRun(_input: Coordinator): Promise<void> {
  'use step'
}

export async function stopUnreachableRemoteRun(_runId: string): Promise<void> {
  'use step'
}
