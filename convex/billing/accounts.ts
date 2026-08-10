import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import {
  CURRENT_BILLING_ACCOUNT_MARKUP_BASIS_POINTS,
  CURRENT_BILLING_ACCOUNT_PRICING_VERSION,
  assertBillingAccountOwnership,
  type BillingAccountRecord,
} from '../../src/shared/billing/billing-account'

const billingAccountValidator = v.object({
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

export const getByIdByServer = query({
  args: {
    billingAccountId: v.string(),
    serverSecret: v.string(),
  },
  returns: v.union(billingAccountValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const account = await ctx.db
      .query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', args.billingAccountId.trim()))
      .unique()
    return account ? toBillingAccountRecord(account) : null
  },
})

export const getPersonalByUserIdByServer = query({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
  },
  returns: v.union(billingAccountValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const account = await uniquePersonalAccount(ctx, args.userId)
    return account ? toBillingAccountRecord(account) : null
  },
})

export const getWorkspaceByWorkspaceIdByServer = query({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
  },
  returns: v.union(billingAccountValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db
      .query('billingAccounts')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId.trim()))
      .take(2)
    if (rows.length > 1) throw new Error('duplicate_workspace_billing_accounts')
    const account = rows[0]
    if (!account) return null
    assertBillingAccountOwnership(account)
    return toBillingAccountRecord(account)
  },
})

export const ensurePersonalByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
  },
  returns: billingAccountValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const userId = args.userId.trim()
    if (!userId) throw new Error('billing_account_user_required')
    const existing = await uniquePersonalAccount(ctx, userId)
    if (existing) {
      await ensureEmptyBalance(ctx, existing.billingAccountId)
      return toBillingAccountRecord(existing)
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
    await ctx.db.insert('billingAccounts', account)
    await ensureEmptyBalance(ctx, account.billingAccountId)
    return toBillingAccountRecord(account)
  },
})

async function uniquePersonalAccount(
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

async function ensureEmptyBalance(ctx: MutationCtx, billingAccountId: string): Promise<void> {
  const existing = await ctx.db
    .query('billingAccountBalances')
    .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
    .unique()
  if (existing) return
  const now = Date.now()
  await ctx.db.insert('billingAccountBalances', {
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
}

function toBillingAccountRecord(
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
