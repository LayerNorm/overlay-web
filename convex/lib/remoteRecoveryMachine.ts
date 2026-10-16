import {z} from 'zod'
import type {MutationCtx} from '../_generated/server'
import {currentRemoteAttempt} from '../agents/remoteRunModel'

const recoveryMachineBinding = z.object({sandboxBilling: z.object({leaseId: z.string().min(1)})})

export async function matchesCurrentRecoveryMachine(ctx: MutationCtx, input: {
  runId: string; environmentId: string; leaseId: string; providerReference: string
}) {
  const [attempt, environment] = await Promise.all([
    currentRemoteAttempt(ctx, input.runId),
    ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', input.environmentId)).unique(),
  ])
  if (!attempt || !environment || environment.kind !== 'overlay_cloud' || environment.revokedAt
    || attempt.environmentId !== input.environmentId || environment.workspaceId !== attempt.workspaceId) return false
  const binding = recoveryMachineBinding.safeParse(attempt.capabilitySnapshot)
  if (!binding.success || binding.data.sandboxBilling.leaseId !== input.leaseId) return false
  const leases = await ctx.db.query('agentSandboxLeases').withIndex('by_workspaceId_environmentId', q =>
    q.eq('workspaceId', attempt.workspaceId).eq('environmentId', input.environmentId)).order('desc').take(101)
  if (leases.length === 101) return false
  const active = leases.filter(lease => ['reserved', 'provisioning', 'running'].includes(lease.status))
  const lease = active.length === 1 ? active[0] : undefined
  return Boolean(lease && lease.leaseId === input.leaseId && lease.provider === 'box'
    && lease.status === 'running' && lease.providerReference === input.providerReference)
}
