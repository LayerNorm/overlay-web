import type {MutationCtx} from '../_generated/server'
import type {Doc} from '../_generated/dataModel'
import type {z} from 'zod'
import type {nativeRecoverySnapshotSchema} from './nativeRecoveryPayload'

export async function nativeRecoveryIsAuthorized(ctx: MutationCtx, run: Doc<'conversationAgentRuns'>,
  attempt: Doc<'agentRemoteSessions'>, snapshot: z.infer<typeof nativeRecoverySnapshotSchema>) {
  const principalId = run.initiatorPrincipalId
  if (!principalId || !run.bindingId || attempt.bindingId !== run.bindingId
    || attempt.environmentId !== run.environmentId || attempt.runId !== run.externalRunId) return false
  const [binding, membership, participant, conversation, principal, workspace, agent] = await Promise.all([
    ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', attempt.bindingId)).unique(),
    ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', attempt.workspaceId).eq('principalId', principalId)).unique(),
    ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', run.conversationId).eq('principalId', principalId)).unique(),
    ctx.db.get(run.conversationId),
    ctx.db.query('workspacePrincipals').withIndex('by_principalId', q => q.eq('principalId', principalId)).unique(),
    ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', attempt.workspaceId)).unique(),
    ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', run.agentId ?? '')).unique(),
  ])
  if (!principal || principal.workspaceId !== attempt.workspaceId || principal.type !== 'human' || principal.userId !== run.userId
    || principal.archivedAt !== undefined || workspace?.status !== 'active' || workspace.archivedAt !== undefined
    || !agent || agent.workspaceId !== attempt.workspaceId || agent.principalId !== run.agentPrincipalId
    || agent.archivedAt !== undefined || agent.deletedAt !== undefined
    || (agent.visibility === 'creator' && agent.createdByPrincipalId !== principalId)) return false
  if (conversation?.workspaceId !== attempt.workspaceId || binding?.agentId !== run.agentId
    || !binding?.enabled || binding.workspaceId !== attempt.workspaceId || binding.environmentId !== attempt.environmentId
    || membership?.status !== 'active' || participant?.status !== 'active') return false
  const ids = [snapshot.billing?.reservationId, snapshot.sandboxBilling.reservationId].filter((id): id is string => typeof id === 'string')
  const reservations = await Promise.all(ids.map(id => ctx.db.query('budgetReservations').withIndex('by_reservationId', q => q.eq('reservationId', id)).unique()))
  return reservations.every(reservation => reservation && ['reserved', 'reconcile_required'].includes(reservation.status))
}
