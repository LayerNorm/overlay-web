import 'server-only'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { createCloudAgentMachineService } from './cloud/create-cloud-agent-machine-service'
import type { RemoteRunState } from '@/shared/agents/remote-run'

type Coordinator = { runId: string; coordinatorId: string; generation: number }
export type RemoteRunSnapshot = { runId: string; workspaceId: string; environmentId: string; environmentKind: string; lifecycle: RemoteRunState }
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
  // Always re-read; replayed workflow variables cannot authorize machine work.
  const snapshot = await lazyConvex.query<RemoteRunSnapshot | null>('agents/remoteRuns:readByServer', { serverSecret: getInternalApiSecret(), runId: input.runId }, { throwOnError: true })
  if (!snapshot || snapshot.lifecycle.coordinatorId !== input.coordinatorId || snapshot.lifecycle.coordinatorGeneration !== input.generation
    || !['queued', 'waking'].includes(snapshot.lifecycle.phase) || Date.now() >= snapshot.lifecycle.hardDeadlineAt) return
  const advanced = await lazyConvex.mutation<RemoteRunState>('agents/remoteRuns:advanceByServer', { serverSecret: getInternalApiSecret(), ...input, wake: true, now: Date.now() }, { throwOnError: true })
  if (advanced?.phase !== 'waking') return
  if (snapshot.environmentKind === 'overlay_cloud') await createCloudAgentMachineService().wake({ workspaceId: snapshot.workspaceId, environmentId: snapshot.environmentId })
}

export async function stopUnreachableRemoteRun(runId: string): Promise<void> {
  'use step'
  const snapshot = await lazyConvex.query<RemoteRunSnapshot | null>('agents/remoteRuns:readByServer', { serverSecret: getInternalApiSecret(), runId }, { throwOnError: true })
  if (!snapshot || snapshot.environmentKind !== 'overlay_cloud' || snapshot.lifecycle.phase !== 'cancelling'
    || (snapshot.lifecycle.cause === 'user_cancelled' && Date.now() - (snapshot.lifecycle.lastHealthAt ?? 0) < 90_000)) return
  if (await createCloudAgentMachineService().stopExecution({ workspaceId: snapshot.workspaceId, environmentId: snapshot.environmentId })) {
    await lazyConvex.mutation('agents/remoteRuns:confirmStoppedByServer', { serverSecret: getInternalApiSecret(), runId,
      attemptId: snapshot.lifecycle.currentAttemptId, generation: snapshot.lifecycle.executionGeneration, now: Date.now() }, { throwOnError: true })
  }
}
