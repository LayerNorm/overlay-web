import 'server-only'

import { canManageWorkspace } from '@overlay/workspace-contracts'
import { EXECUTION_ACCESS_MESSAGES, workspaceExecutionAccess, type WorkspaceExecutionAccess } from '@/shared/billing/execution-access'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { BillingRepository } from './BillingRepository'

export class WorkspaceExecutionError extends Error {
  readonly statusCode = 402
  readonly payload: { error: string; code: string; message: string; recovery: 'billing' | 'contact_owner' }

  constructor(readonly access: WorkspaceExecutionAccess, canManage: boolean) {
    super(EXECUTION_ACCESS_MESSAGES[access.state])
    this.name = 'WorkspaceExecutionError'
    this.payload = { error: access.state, code: access.state, message: this.message, recovery: canManage ? 'billing' : 'contact_owner' }
  }
}

export class WorkspaceExecutionPolicy {
  constructor(private readonly deps: {
    billingEnabled: () => Promise<boolean>
    billing: BillingRepository
    workspaces: Pick<WorkspaceService, 'resolveActiveWorkspace'>
  }) {}

  async inspect(args: { userId: string; workspaceId?: string; checkBudget?: boolean }) {
    const workspace = await this.deps.workspaces.resolveActiveWorkspace(args.userId, args.workspaceId)
    const canManage = canManageWorkspace(workspace.membership.role)
    const billingEnabled = await this.deps.billingEnabled()
    if (!billingEnabled) return { billingEnabled, access: workspaceExecutionAccess({ billingEnabled, remainingCents: 0 }), canManage, workspaceId: workspace.workspace.id }
    const account = await this.deps.billing.getWorkspaceBillingAccountByWorkspaceIdByServer({ workspaceId: workspace.workspace.id })
    const [subscription, entitlements] = account ? await Promise.all([
      this.deps.billing.getBillingAccountSubscriptionByServer({ billingAccountId: account.billingAccountId }),
      this.deps.billing.getBillingAccountEntitlementsByServer({ billingAccountId: account.billingAccountId }),
    ]) : [null, null]
    return {
      billingEnabled,
      access: workspaceExecutionAccess({ billingEnabled, accountStatus: account?.status, subscription, remainingCents: entitlements?.budgetRemainingCents ?? 0, checkBudget: args.checkBudget }),
      canManage,
      workspaceId: workspace.workspace.id,
    }
  }

  async require(args: { userId: string; workspaceId?: string; checkBudget?: boolean }) {
    const result = await this.inspect(args)
    if (!result.access.canExecute) throw new WorkspaceExecutionError(result.access, result.canManage)
    return result
  }
}

export async function workspaceExecutionPolicy() {
  const [{ getOverlayServerContext }, { getOverlayCapabilities }] = await Promise.all([
    import('@/server/bootstrap'), import('@/server/capabilities'),
  ])
  const server = getOverlayServerContext()
  return new WorkspaceExecutionPolicy({
    billingEnabled: async () => (await getOverlayCapabilities()).billing,
    billing: server.appData.repositories.billing,
    workspaces: server.workspaceService,
  })
}

export async function requireWorkspaceExecution(args: { userId: string; workspaceId?: string; checkBudget?: boolean }) {
  return (await workspaceExecutionPolicy()).require(args)
}
