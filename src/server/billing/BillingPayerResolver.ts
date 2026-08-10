import 'server-only'

import { canManageWorkspace } from '@overlay/workspace-contracts'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { BillingRepository } from './BillingRepository'
import {
  assertBillingSpendSubject,
  type BillingAccountSpendLimitRecord,
  type BillingSpendSubject,
  type ResolvedBillingPayer,
} from '@/shared/billing/billing-payer'

export class BillingPayerResolutionError extends Error {
  constructor(readonly code:
    | 'billing_account_inactive'
    | 'workspace_wallet_forbidden'
    | 'workspace_wallet_not_configured',
  ) {
    super(code)
    this.name = 'BillingPayerResolutionError'
  }
}

export class BillingPayerResolver {
  constructor(private readonly deps: {
    billing: BillingRepository
    workspaceWalletsEnabled: () => boolean
    workspaces: Pick<WorkspaceService, 'resolveActiveWorkspace'>
  }) {}

  async resolve(args: {
    programmaticSubjectId?: string
    userId: string
    workspaceId?: string
  }): Promise<ResolvedBillingPayer> {
    const userId = required(args.userId, 'userId')
    const subject = spendSubject(userId, args.programmaticSubjectId)
    if (!this.deps.workspaceWalletsEnabled()) {
      return personalPayer(await this.deps.billing.ensurePersonalBillingAccount({ userId }), subject, userId)
    }

    const access = await this.deps.workspaces.resolveActiveWorkspace(userId, args.workspaceId)
    if (access.workspace.kind !== 'organization') {
      return personalPayer(await this.deps.billing.ensurePersonalBillingAccount({ userId }), subject, userId)
    }
    const account = await this.deps.billing.getWorkspaceBillingAccountByWorkspaceIdByServer({
      workspaceId: access.workspace.id,
    })
    if (!account) throw new BillingPayerResolutionError('workspace_wallet_not_configured')
    if (account.status !== 'active') throw new BillingPayerResolutionError('billing_account_inactive')
    return {
      billingAccountId: account.billingAccountId,
      scope: 'workspace',
      subject,
      workspaceId: access.workspace.id,
    }
  }

  async initializeWorkspaceWallet(args: {
    actorUserId: string
    workspaceId: string
  }) {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    if (access.workspace.kind !== 'organization' || !canManageWorkspace(access.membership.role)) {
      throw new BillingPayerResolutionError('workspace_wallet_forbidden')
    }
    return await this.deps.billing.ensureWorkspaceBillingAccount({
      primaryBillingContactUserId: args.actorUserId,
      workspaceId: access.workspace.id,
    })
  }

  async configureSpendLimit(args: {
    actorUserId: string
    limitCents: number
    periodEnd: number
    periodStart: number
    subject: BillingSpendSubject
    workspaceId: string
  }): Promise<BillingAccountSpendLimitRecord> {
    assertBillingSpendSubject(args.subject)
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    if (access.workspace.kind !== 'organization' || !canManageWorkspace(access.membership.role)) {
      throw new BillingPayerResolutionError('workspace_wallet_forbidden')
    }
    const account = await this.deps.billing.getWorkspaceBillingAccountByWorkspaceIdByServer({
      workspaceId: access.workspace.id,
    })
    if (!account) throw new BillingPayerResolutionError('workspace_wallet_not_configured')
    return await this.deps.billing.upsertBillingAccountSpendLimit({
      billingAccountId: account.billingAccountId,
      limitCents: args.limitCents,
      periodEnd: args.periodEnd,
      periodStart: args.periodStart,
      subject: args.subject,
    })
  }
}

function spendSubject(userId: string, programmaticSubjectId?: string): BillingSpendSubject {
  const id = programmaticSubjectId?.trim()
  return id ? { id, kind: 'programmatic' } : { id: userId, kind: 'member' }
}

function personalPayer(
  account: Awaited<ReturnType<BillingRepository['ensurePersonalBillingAccount']>>,
  subject: BillingSpendSubject,
  userId: string,
): ResolvedBillingPayer {
  if (account.status !== 'active') throw new BillingPayerResolutionError('billing_account_inactive')
  return {
    billingAccountId: account.billingAccountId,
    scope: 'personal',
    subject,
    userId,
  }
}

function required(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name}_required`)
  return normalized
}
