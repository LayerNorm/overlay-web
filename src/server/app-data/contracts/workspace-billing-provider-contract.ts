import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import { BillingPayerResolver } from '@/server/billing/BillingPayerResolver'
import type { UsageRepository } from '@/server/usage/UsageRepository'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'

export type WorkspaceBillingContractBackend = {
  billing: BillingRepository
  cleanupWorkspace?(workspaceId: string): Promise<void>
  cleanupUser?(userId: string): Promise<void>
  prepareUser?(userId: string, email: string): Promise<void>
  provider: 'convex'
  usage: UsageRepository
  workspaces: WorkspaceService
}

export async function runWorkspaceBillingProviderContract(
  t: TestContext,
  backend: WorkspaceBillingContractBackend,
): Promise<void> {
  const scope = `workspace_contract_${backend.provider}_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const memberUserId = `${scope}_member`
  const ownerEmail = `${ownerUserId}@example.test`
  const memberEmail = `${memberUserId}@example.test`
  await backend.prepareUser?.(ownerUserId, ownerEmail)
  await backend.prepareUser?.(memberUserId, memberEmail)
  const workspace = await backend.workspaces.createOrganization({
    actorUserId: ownerUserId,
    email: ownerEmail,
    name: scope,
  })
  const account = await backend.billing.ensureWorkspaceBillingAccount({
    primaryBillingContactUserId: ownerUserId,
    workspaceId: workspace.workspace.id,
  })

  try {
    await t.test(`${backend.provider} removed members cannot resolve the workspace payer`, async () => {
      const invitation = await backend.workspaces.invite({
        actorUserId: ownerUserId,
        email: memberEmail,
        role: 'member',
        workspaceId: workspace.workspace.id,
      })
      const memberAccess = await backend.workspaces.acceptInvitation({
        email: memberEmail,
        invitationId: invitation.id,
        userId: memberUserId,
      })
      const resolver = new BillingPayerResolver({
        billing: backend.billing,
        workspaces: backend.workspaces,
      })
      assert.equal((await resolver.resolve({ userId: memberUserId, workspaceId: workspace.workspace.id })).billingAccountId, account.billingAccountId)
      await backend.workspaces.removeMember({
        actorUserId: ownerUserId,
        principalId: memberAccess.principal.id,
        workspaceId: workspace.workspace.id,
      })
      await assert.rejects(
        resolver.resolve({ userId: memberUserId, workspaceId: workspace.workspace.id }),
        /not found|access|usable|denied/i,
      )
    })
  } finally {
    await backend.workspaces.archiveWorkspace({ actorUserId: ownerUserId, workspaceId: workspace.workspace.id }).catch((_error) => undefined)
    await backend.cleanupWorkspace?.(workspace.workspace.id)
    await backend.cleanupUser?.(memberUserId)
    await backend.cleanupUser?.(ownerUserId)
  }
}
