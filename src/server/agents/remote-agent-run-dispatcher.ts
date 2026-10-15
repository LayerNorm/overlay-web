import 'server-only'
import { start, resumeHook, getRun } from 'workflow/api'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { remoteAgentRunWorkflow } from '@/server/workflows/remote-agent-run'
import { stopUnreachableRemoteRun, type RemoteRunSnapshot } from './remote-agent-run-lifecycle'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { RemoteAgentUsageSettlement } from './ConnectedAgentRepository'
import { logger } from '@/server/observability/logger'

type Intent = { intentId: string; runId: string; kind: string; revision: number }
export async function ensureRemoteRunCoordinator(runId: string) {
  const snapshot = await lazyConvex.query<RemoteRunSnapshot | null>('agents/remoteRuns:readByServer', { serverSecret: getInternalApiSecret(), runId }, { throwOnError: true })
  if (!snapshot || snapshot.lifecycle.coordinatorId || ['completed', 'cancelled', 'failed'].includes(snapshot.lifecycle.phase)) return
  // Start may be duplicated after a crash here. Only the canonical claim winner can dispatch.
  await start(remoteAgentRunWorkflow, [{ runId, generation: snapshot.lifecycle.coordinatorGeneration }])
}
export async function dispatchRemoteRunIntents() {
  const intents = await lazyConvex.query<Intent[]>('agents/remoteRuns:pendingIntentsByServer', { serverSecret: getInternalApiSecret() }, { throwOnError: true })
  const finalizations = await lazyConvex.query<Array<Intent & { terminal: RemoteAgentUsageSettlement }>>('agents/connectedAgents:pendingRemoteFinalizationsByServer', { serverSecret: getInternalApiSecret() }, { throwOnError: true })
  let delivered = 0
  for (const intent of finalizations ?? []) {
    try {
      await getOverlayServerContext().connectedAgentControlPlane.finalizeRemoteRunUsage(intent.terminal)
      await lazyConvex.mutation('agents/remoteRuns:acknowledgeIntentByServer', { serverSecret: getInternalApiSecret(), intentId: intent.intentId, revision: intent.revision, now: Date.now() }, { throwOnError: true })
    } catch (error) {
      logger.warn('[remote-agent-run] settlement deferred', { runId: intent.runId, intentId: intent.intentId, error })
    }
  }
  for (const intent of intents ?? []) {
    try {
      if (intent.kind === 'finalize') continue
      const snapshot = await lazyConvex.query<RemoteRunSnapshot | null>('agents/remoteRuns:readByServer', { serverSecret: getInternalApiSecret(), runId: intent.runId }, { throwOnError: true })
      if (snapshot && ['completed', 'failed', 'cancelled'].includes(snapshot.lifecycle.phase)) {
        await lazyConvex.mutation('agents/remoteRuns:acknowledgeIntentByServer', { serverSecret: getInternalApiSecret(), intentId: intent.intentId, revision: intent.revision, now: Date.now() }, { throwOnError: true })
        continue
      }
      if (intent.kind === 'start') { await ensureRemoteRunCoordinator(intent.runId); continue }
      if (snapshot?.lifecycle.phase === 'cancelling') await stopUnreachableRemoteRun(intent.runId)
      if (!snapshot?.lifecycle.coordinatorId) continue
      if (!['completed', 'failed', 'cancelled'].includes(snapshot.lifecycle.phase)) {
        const status = await getRun(snapshot.lifecycle.coordinatorId).status
        if (['completed', 'failed', 'cancelled'].includes(status)) {
          await lazyConvex.mutation('agents/remoteRuns:replaceStoppedCoordinatorByServer', { serverSecret: getInternalApiSecret(),
            runId: intent.runId, coordinatorId: snapshot.lifecycle.coordinatorId, generation: snapshot.lifecycle.coordinatorGeneration,
            expectedRevision: snapshot.lifecycle.revision, now: Date.now() }, { throwOnError: true })
          continue
        }
      }
      await resumeHook(`remote-run:${intent.runId}:${snapshot.lifecycle.coordinatorGeneration}:${snapshot.lifecycle.coordinatorId}`, { runId: intent.runId, revision: intent.revision })
      await lazyConvex.mutation('agents/remoteRuns:acknowledgeIntentByServer', { serverSecret: getInternalApiSecret(), intentId: intent.intentId, revision: intent.revision, now: Date.now() }, { throwOnError: true })
      delivered++
    } catch (error) {
      // A hook unavailable during deployment is retryable; leave the intent pending.
      logger.warn('[remote-agent-run] lifecycle delivery deferred', { runId: intent.runId, intentId: intent.intentId, error })
    }
  }
  return { attempted: intents?.length ?? 0, delivered }
}
