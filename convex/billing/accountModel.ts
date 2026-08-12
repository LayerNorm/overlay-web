import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import {
  CURRENT_BILLING_ACCOUNT_MARKUP_BASIS_POINTS,
  CURRENT_BILLING_ACCOUNT_PRICING_VERSION,
  assertBillingAccountOwnership,
  type BillingAccountRecord,
} from '../../src/shared/billing/billing-account'

export const billingAccountValidator = v.object({
  billingAccountId: v.string(),
  closedAt: v.optional(v.number()),
  createdAt: v.number(),
  markupBasisPoints: v.number(),
  pricingVersion: v.literal('markup_25_v1'),
  primaryBillingContactUserId: v.optional(v.string()),
  scope: v.union(v.literal('personal'), v.literal('workspace')),
  status: v.union(v.literal('active'), v.literal('suspended'), v.literal('closed')),
  updatedAt: v.number(),
  userId: v.optional(v.string()),
  workspaceId: v.optional(v.string()),
})

export async function ensurePersonalBillingAccount(
  ctx: MutationCtx,
  rawUserId: string,
): Promise<Doc<'billingAccounts'>> {
  const userId = rawUserId.trim()
  if (!userId) throw new Error('billing_account_user_required')
  const existing = await uniquePersonalAccount(ctx, userId)
  if (existing) {
    await ensureEmptyBalance(ctx, existing.billingAccountId)
    return existing
  }

  const now = Date.now()
  const account: Omit<Doc<'billingAccounts'>, '_creationTime' | '_id'> = {
    billingAccountId: `ba_${crypto.randomUUID().replaceAll('-', '')}`,
    createdAt: now,
    markupBasisPoints: CURRENT_BILLING_ACCOUNT_MARKUP_BASIS_POINTS,
    pricingVersion: CURRENT_BILLING_ACCOUNT_PRICING_VERSION,
    primaryBillingContactUserId: userId,
    scope: 'personal',
    status: 'active',
    updatedAt: now,
    userId,
  }
  assertBillingAccountOwnership(account)
  const id = await ctx.db.insert('billingAccounts', account)
  await ensureEmptyBalance(ctx, account.billingAccountId)
  const created = await ctx.db.get(id)
  if (!created) throw new Error('billing_account_creation_failed')
  return created
}

export async function ensureWorkspaceBillingAccount(
  ctx: MutationCtx,
  args: { primaryBillingContactUserId: string; workspaceId: string },
): Promise<Doc<'billingAccounts'>> {
  const workspaceId = args.workspaceId.trim()
  const primaryBillingContactUserId = args.primaryBillingContactUserId.trim()
  if (!workspaceId) throw new Error('billing_account_workspace_required')
  if (!primaryBillingContactUserId) throw new Error('billing_account_contact_required')
  const existing = await uniqueWorkspaceAccount(ctx, workspaceId)
  if (existing) {
    await ensureEmptyBalance(ctx, existing.billingAccountId)
    return existing
  }
  const now = Date.now()
  const account: Omit<Doc<'billingAccounts'>, '_creationTime' | '_id'> = {
    billingAccountId: `ba_${crypto.randomUUID().replaceAll('-', '')}`,
    createdAt: now,
    markupBasisPoints: CURRENT_BILLING_ACCOUNT_MARKUP_BASIS_POINTS,
    pricingVersion: CURRENT_BILLING_ACCOUNT_PRICING_VERSION,
    primaryBillingContactUserId,
    scope: 'workspace',
    status: 'active',
    updatedAt: now,
    workspaceId,
  }
  assertBillingAccountOwnership(account)
  const id = await ctx.db.insert('billingAccounts', account)
  await ensureEmptyBalance(ctx, account.billingAccountId)
  const created = await ctx.db.get(id)
  if (!created) throw new Error('billing_account_creation_failed')
  return created
}

export async function uniquePersonalAccount(
  ctx: QueryCtx | MutationCtx,
  rawUserId: string,
): Promise<Doc<'billingAccounts'> | null> {
  const userId = rawUserId.trim()
  if (!userId) return null
  const rows = await ctx.db
    .query('billingAccounts')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(2)
  if (rows.length > 1) throw new Error('duplicate_personal_billing_accounts')
  const account = rows[0]
  if (!account) return null
  assertBillingAccountOwnership(account)
  return account
}

export async function uniqueWorkspaceAccount(
  ctx: QueryCtx | MutationCtx,
  rawWorkspaceId: string,
): Promise<Doc<'billingAccounts'> | null> {
  const workspaceId = rawWorkspaceId.trim()
  if (!workspaceId) return null
  const rows = await ctx.db.query('billingAccounts')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .take(2)
  if (rows.length > 1) throw new Error('duplicate_workspace_billing_accounts')
  const account = rows[0]
  if (!account) return null
  assertBillingAccountOwnership(account)
  return account
}

export async function ensureEmptyBalance(
  ctx: MutationCtx,
  billingAccountId: string,
): Promise<Doc<'billingAccountBalances'>> {
  const existing = await ctx.db
    .query('billingAccountBalances')
    .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
    .unique()
  if (existing) return existing
  const now = Date.now()
  const id = await ctx.db.insert('billingAccountBalances', {
    allowanceUsedMicros: 0,
    billingAccountId,
    createdAt: now,
    includedMicros: 0,
    institutionalGrantMicros: 0,
    mode: 'budgeted',
    reservedMicros: 0,
    topUpBalanceMicros: 0,
    topUpPurchasedMicros: 0,
    updatedAt: now,
    usedMicros: 0,
    version: 0,
  })
  const created = await ctx.db.get(id)
  if (!created) throw new Error('billing_account_balance_creation_failed')
  return created
}

export function toBillingAccountRecord(
  account: Omit<Doc<'billingAccounts'>, '_creationTime' | '_id'>,
): BillingAccountRecord {
  return {
    billingAccountId: account.billingAccountId,
    ...(account.closedAt === undefined ? {} : { closedAt: account.closedAt }),
    createdAt: account.createdAt,
    markupBasisPoints: account.markupBasisPoints,
    pricingVersion: account.pricingVersion,
    ...(account.primaryBillingContactUserId === undefined
      ? {}
      : { primaryBillingContactUserId: account.primaryBillingContactUserId }),
    scope: account.scope,
    status: account.status,
    updatedAt: account.updatedAt,
    ...(account.userId === undefined ? {} : { userId: account.userId }),
    ...(account.workspaceId === undefined ? {} : { workspaceId: account.workspaceId }),
  }
}
