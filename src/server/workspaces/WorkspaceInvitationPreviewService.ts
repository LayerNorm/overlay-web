import 'server-only'

import type { WorkspaceInvitationPreviewResponse } from '@overlay/workspace-contracts'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import { workspaceExecutionAccess } from '@/shared/billing/execution-access'
import type { WorkspaceRepository } from './WorkspaceRepository'
import { WorkspaceServiceError } from './WorkspaceService'

export class WorkspaceInvitationPreviewService {
  constructor(private readonly deps: {
    workspaces: Pick<WorkspaceRepository, 'getInvitation' | 'getWorkspace' | 'getPrincipal'>
    billing: Pick<BillingRepository, 'getWorkspaceBillingAccountByWorkspaceIdByServer' | 'getBillingAccountSubscriptionByServer'>
    billingEnabled(): Promise<boolean>
    now?: () => number
  }) {}

  async get(invitationId: string): Promise<WorkspaceInvitationPreviewResponse> {
    const invitation = await this.deps.workspaces.getInvitation(invitationId)
    if (!invitation) throw new WorkspaceServiceError('Invitation not found', 404, 'not_found')
    const [workspace, inviter, account, billingEnabled] = await Promise.all([
      this.deps.workspaces.getWorkspace(invitation.workspaceId),
      this.deps.workspaces.getPrincipal(invitation.invitedByPrincipalId),
      this.deps.billing.getWorkspaceBillingAccountByWorkspaceIdByServer({ workspaceId: invitation.workspaceId }),
      this.deps.billingEnabled(),
    ])
    if (!workspace || workspace.status !== 'active') throw new WorkspaceServiceError('Invitation not found', 404, 'not_found')
    const subscription = account
      ? await this.deps.billing.getBillingAccountSubscriptionByServer({ billingAccountId: account.billingAccountId })
      : null
    const now = this.deps.now?.() ?? Date.now()
    const access = workspaceExecutionAccess({ billingEnabled, accountStatus: account?.status, subscription, remainingCents: 0, checkBudget: false, now })
    return {
      status: invitation.status === 'pending' && invitation.expiresAt <= now ? 'expired' : invitation.status,
      workspaceName: workspace.name,
      inviterName: inviter?.workspaceId === invitation.workspaceId ? inviter.displayName.trim() || null : null,
      role: invitation.role,
      invitedEmail: invitation.email,
      workspaceBilling: access.state === 'ready' ? 'paid' : 'free',
    }
  }
}
