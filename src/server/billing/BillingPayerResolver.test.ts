import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceAccess } from '@overlay/workspace-contracts'
import type { BillingAccountRecord } from '@/shared/billing/billing-account'
import type { BillingRepository } from './BillingRepository'
import {
  BillingPayerResolutionError,
  BillingPayerResolver,
} from './BillingPayerResolver'

const personal = account({ billingAccountId: 'ba_personal', scope: 'personal', userId: 'user_1' })
const workspace = account({ billingAccountId: 'ba_workspace', scope: 'workspace', workspaceId: 'workspace_1' })

test('disabled workspace wallets preserve the personal payer without resolving workspace access', async () => {
  let workspaceLookups = 0
  const resolver = new BillingPayerResolver({
    billing: billingRepository({ personal }),
    workspaceWalletsEnabled: () => false,
    workspaces: {
      async resolveActiveWorkspace() {
        workspaceLookups += 1
        return organizationAccess('owner')
      },
    },
  })
  assert.deepEqual(await resolver.resolve({ userId: 'user_1', workspaceId: 'workspace_1' }), {
    billingAccountId: 'ba_personal',
    scope: 'personal',
    subject: { id: 'user_1', kind: 'member' },
    userId: 'user_1',
  })
  assert.equal(workspaceLookups, 0)
})

test('a workspace with no wallet, or a wallet that is not on a paid plan, is on the free allowance', async () => {
  const noWallet = new BillingPayerResolver({
    billing: billingRepository({ personal }),
    workspaceWalletsEnabled: () => true,
    workspaces: { resolveActiveWorkspace: async () => organizationAccess('member') },
  })
  assert.equal((await noWallet.resolve({ userId: 'user_1', workspaceId: 'workspace_1' })).scope, 'personal')

  const unpaidWallet = new BillingPayerResolver({
    billing: billingRepository({ personal, workspace, plan: 'free' }),
    workspaceWalletsEnabled: () => true,
    workspaces: { resolveActiveWorkspace: async () => organizationAccess('member') },
  })
  assert.equal((await unpaidWallet.resolve({ userId: 'user_1', workspaceId: 'workspace_1' })).scope, 'personal')
})

test('a workspace with a paid plan is the payer, whatever kind of workspace it is, and keeps programmatic attribution', async () => {
  for (const kind of ['organization', 'personal'] as const) {
    const configured = new BillingPayerResolver({
      billing: billingRepository({ personal, workspace, plan: 'paid' }),
      workspaceWalletsEnabled: () => true,
      workspaces: { resolveActiveWorkspace: async () => workspaceAccess('member', kind) },
    })
    assert.deepEqual(await configured.resolve({
      programmaticSubjectId: 'agent_shared',
      userId: 'user_1',
      workspaceId: 'workspace_1',
    }), {
      billingAccountId: 'ba_workspace',
      scope: 'workspace',
      subject: { id: 'agent_shared', kind: 'programmatic' },
      workspaceId: 'workspace_1',
    })
  }
})

test('a paid wallet that has been suspended fails closed instead of falling back to a personal payer', async () => {
  const suspended = new BillingPayerResolver({
    billing: billingRepository({ personal, workspace: { ...workspace, status: 'suspended' } as BillingAccountRecord, plan: 'paid' }),
    workspaceWalletsEnabled: () => true,
    workspaces: { resolveActiveWorkspace: async () => organizationAccess('member') },
  })
  await assert.rejects(
    suspended.resolve({ userId: 'user_1', workspaceId: 'workspace_1' }),
    (error: unknown) => error instanceof BillingPayerResolutionError && error.code === 'billing_account_inactive',
  )
})

test('controlled rollout preserves personal billing outside the selected workspace', async () => {
  const resolver = new BillingPayerResolver({
    billing: billingRepository({ personal, workspace, plan: 'paid' }),
    workspaceWalletsEnabled: (workspaceId) => workspaceId === undefined || workspaceId === 'workspace_internal',
    workspaces: { resolveActiveWorkspace: async () => organizationAccess('member') },
  })
  assert.equal((await resolver.resolve({ userId: 'user_1', workspaceId: 'workspace_1' })).scope, 'personal')
})

test('a manager of a first (personal-kind) workspace can set up its wallet too', async () => {
  const manager = new BillingPayerResolver({
    billing: billingRepository({ personal, workspace }),
    workspaceWalletsEnabled: () => true,
    workspaces: { resolveActiveWorkspace: async () => workspaceAccess('owner', 'personal') },
  })
  assert.equal((await manager.initializeWorkspaceWallet({ actorUserId: 'user_1', workspaceId: 'workspace_1' })).billingAccountId, 'ba_workspace')
})

test('only workspace managers can initialize wallets or configure limits', async () => {
  const forbidden = new BillingPayerResolver({
    billing: billingRepository({ personal, workspace }),
    workspaceWalletsEnabled: () => true,
    workspaces: { resolveActiveWorkspace: async () => organizationAccess('member') },
  })
  await assert.rejects(
    forbidden.initializeWorkspaceWallet({ actorUserId: 'user_1', workspaceId: 'workspace_1' }),
    (error: unknown) => error instanceof BillingPayerResolutionError
      && error.code === 'workspace_wallet_forbidden',
  )

  const manager = new BillingPayerResolver({
    billing: billingRepository({ personal, workspace }),
    workspaceWalletsEnabled: () => true,
    workspaces: { resolveActiveWorkspace: async () => organizationAccess('admin') },
  })
  assert.equal((await manager.initializeWorkspaceWallet({
    actorUserId: 'user_1',
    workspaceId: 'workspace_1',
  })).billingAccountId, 'ba_workspace')
  const limit = await manager.configureSpendLimit({
    actorUserId: 'user_1',
    limitCents: 500,
    periodEnd: 2_000,
    periodStart: 1_000,
    subject: { id: 'user_2', kind: 'member' },
    workspaceId: 'workspace_1',
  })
  assert.equal(limit.limitCents, 500)
})

function billingRepository(args: {
  personal: BillingAccountRecord
  workspace?: BillingAccountRecord
  plan?: 'free' | 'paid'
}): BillingRepository {
  return {
    getBillingAccountSubscriptionByServer: async () => args.plan ? { planKind: args.plan } : null,
    ensurePersonalBillingAccount: async () => args.personal,
    ensureWorkspaceBillingAccount: async () => args.workspace ?? workspace,
    getWorkspaceBillingAccountByWorkspaceIdByServer: async () => args.workspace ?? null,
    upsertBillingAccountSpendLimit: async (input) => ({
      billingAccountId: input.billingAccountId,
      createdAt: 1_000,
      limitCents: input.limitCents,
      periodEnd: input.periodEnd,
      periodStart: input.periodStart,
      reservedCents: 0,
      subject: input.subject,
      updatedAt: 1_000,
      usedCents: 0,
      version: 0,
    }),
  } as BillingRepository
}

function account(args: {
  billingAccountId: string
  scope: 'personal' | 'workspace'
  userId?: string
  workspaceId?: string
}): BillingAccountRecord {
  return {
    ...args,
    createdAt: 1,
    markupBasisPoints: 2_500,
    pricingVersion: 'markup_25_v1',
    status: 'active',
    updatedAt: 1,
  }
}

function organizationAccess(role: 'owner' | 'admin' | 'member'): WorkspaceAccess {
  return workspaceAccess(role, 'organization')
}

function workspaceAccess(role: 'owner' | 'admin' | 'member', kind: 'organization' | 'personal'): WorkspaceAccess {
  return {
    workspace: { id: 'workspace_1', kind, status: 'active' },
    membership: { role, status: 'active' },
    principal: { id: 'principal_1', type: 'human' },
  } as WorkspaceAccess
}
