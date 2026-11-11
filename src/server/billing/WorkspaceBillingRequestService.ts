import 'server-only'

import { canManageWorkspace } from '@overlay/workspace-contracts'
import type { WorkspaceRepository } from '@/server/workspaces/WorkspaceRepository'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { LifecycleEventPublisher } from '@/server/lifecycle-events/LifecycleEventPublisher'
import type { WorkspaceBillingService } from './WorkspaceBillingService'
import { BillingServiceError } from './BillingCustomerService'

export class WorkspaceBillingRequestService {
  constructor(private readonly deps: {
    repository: Pick<WorkspaceRepository, 'getAccess'>
    workspaces: Pick<WorkspaceService, 'listMembers'>
    billing: Pick<WorkspaceBillingService, 'summary'>
    events: Pick<LifecycleEventPublisher, 'publish'>
    now?: () => number
  }) {}

  async request(args: { actorUserId: string; workspaceId: string }): Promise<{ requested: true }> {
    const actor = await this.deps.repository.getAccess({ userId: args.actorUserId, workspaceId: args.workspaceId })
    if (!actor || actor.workspace.status !== 'active' || actor.membership.status !== 'active' || actor.principal.type !== 'human') {
      throw new BillingServiceError({ error: 'Workspace membership is required.' }, 403)
    }
    const summary = await this.deps.billing.summary(args)
    if (summary.executionAccess?.canExecute) throw new BillingServiceError({ error: 'This workspace can already run tasks.' }, 409)
    if (canManageWorkspace(actor.membership.role)) throw new BillingServiceError({ error: 'Owners and admins can subscribe in billing settings.' }, 400)
    const members = await this.deps.workspaces.listMembers(args)
    const recipients = new Set(members.flatMap(({ principal, membership }) =>
      membership.status === 'active' && canManageWorkspace(membership.role) && principal.type === 'human' && principal.userId ? [principal.userId] : []))
    const day = new Date(this.deps.now?.() ?? Date.now()).toISOString().slice(0, 10)
    await Promise.all([...recipients].map(userId => this.deps.events.publish({
      name: 'workspace.billing_requested',
      userId,
      attributes: { workspaceId: actor.workspace.id, workspaceName: actor.workspace.name, requesterName: actor.principal.displayName.trim() || 'A teammate' },
      resource: { id: actor.workspace.id, type: 'workspace' },
      idempotencyKey: `workspace.billing_requested:${actor.workspace.id}:${args.actorUserId}:${userId}:${day}`,
    })))
    return { requested: true }
  }
}
