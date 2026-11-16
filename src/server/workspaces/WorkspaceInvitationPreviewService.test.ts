import assert from 'node:assert/strict'
import test from 'node:test'
import type { Workspace, WorkspaceInvitation, WorkspacePrincipal } from '@overlay/workspace-contracts'
import type { BillingAccountRecord } from '@/shared/billing/billing-account'
import type { BillingSubscriptionRecord } from '@/server/billing/BillingRepository'
import { WorkspaceInvitationPreviewService } from './WorkspaceInvitationPreviewService'
import { WorkspaceServiceError } from './WorkspaceService'

const workspace: Workspace = { id: 'workspace_1', kind: 'organization', name: 'Acme', slug: 'acme', status: 'active', createdAt: 1, updatedAt: 1 }
const principal: WorkspacePrincipal = { id: 'principal_1', workspaceId: workspace.id, type: 'human', displayName: 'Priya Shah', userId: 'user_1', createdAt: 1, updatedAt: 1 }
const invitation: WorkspaceInvitation = { id: 'invite_1', workspaceId: workspace.id, invitedByPrincipalId: principal.id, role: 'member', email: 'dev@acme.com', status: 'pending', expiresAt: 200, createdAt: 1, updatedAt: 1 }
const account: BillingAccountRecord = { billingAccountId: 'billing_1', scope: 'workspace', workspaceId: workspace.id, status: 'active', createdAt: 1, updatedAt: 1, markupBasisPoints: 2500, pricingVersion: 'markup_25_v1' }
const paid: BillingSubscriptionRecord = { planKind: 'paid', status: 'active', paidPeriodStart: 1, paidPeriodEnd: 200 }

function service(options: {
  invitation?: WorkspaceInvitation | null
  workspace?: Workspace | null
  principal?: WorkspacePrincipal | null
  account?: BillingAccountRecord | null
  subscription?: BillingSubscriptionRecord | null
  billingEnabled?: boolean
} = {}) {
  const supplied = <K extends keyof typeof options>(key: K, fallback: NonNullable<typeof options[K]>) => key in options ? options[key] : fallback
  return new WorkspaceInvitationPreviewService({
    workspaces: {
      getInvitation: async () => supplied('invitation', invitation) ?? null,
      getWorkspace: async () => supplied('workspace', workspace) ?? null,
      getPrincipal: async () => supplied('principal', principal) ?? null,
    },
    billing: {
      getWorkspaceBillingAccountByWorkspaceIdByServer: async () => supplied('account', account) ?? null,
      getBillingAccountSubscriptionByServer: async () => supplied('subscription', paid) ?? null,
    },
    billingEnabled: async () => options.billingEnabled ?? true,
    now: () => 100,
  })
}

test('preview is redacted, needs no user/session, and uses the inviter display name', async () => {
  assert.deepEqual(await service().get('invite_1'), {
    status: 'pending', workspaceName: 'Acme', inviterName: 'Priya Shah',
    role: 'member', invitedEmail: 'dev@acme.com', workspaceBilling: 'paid',
  })
})

test('all statuses are retained and only pending invitations expire at the boundary', async () => {
  for (const status of ['pending', 'expired', 'cancelled', 'replaced', 'accepted'] as const) {
    for (const expiresAt of [99, 100, 101]) {
      const result = await service({ invitation: { ...invitation, status, expiresAt } }).get('invite_1')
      assert.equal(result.status, status === 'pending' && expiresAt <= 100 ? 'expired' : status)
    }
  }
})

test('unknown invitation or missing/inactive workspace returns 404', async () => {
  for (const options of [{ invitation: null }, { workspace: null }, { workspace: { ...workspace, status: 'archived' as const } }]) {
    await assert.rejects(service(options).get('missing'), error => error instanceof WorkspaceServiceError && error.statusCode === 404)
  }
})

test('missing, blank, or wrong-workspace inviter has no name', async () => {
  for (const value of [null, { ...principal, displayName: '  ' }, { ...principal, workspaceId: 'other' }]) {
    assert.equal((await service({ principal: value }).get('invite_1')).inviterName, null)
  }
})

test('billing reuses execution eligibility without budget gating', async () => {
  for (const options of [
    { account: null },
    { account: { ...account, status: 'suspended' as const } },
    { subscription: null },
    { subscription: { ...paid, planKind: 'free' as const } },
    { subscription: { ...paid, status: 'past_due' as const } },
    { subscription: { ...paid, status: 'trialing' as const } },
    { subscription: { ...paid, paidPeriodStart: 101 } },
    { subscription: { ...paid, paidPeriodEnd: 100 } },
  ]) assert.equal((await service(options).get('invite_1')).workspaceBilling, 'free')
  assert.equal((await service().get('invite_1')).workspaceBilling, 'paid')
  assert.equal((await service({ billingEnabled: false, account: null }).get('invite_1')).workspaceBilling, 'paid')
})
