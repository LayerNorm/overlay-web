import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { assertBillingAccountOwnership } from '../../src/shared/billing/billing-account'
import {
  billingAccountValidator,
  ensurePersonalBillingAccount,
  ensureWorkspaceBillingAccount,
  toBillingAccountRecord,
  uniquePersonalAccount,
} from './accountModel'

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
    return toBillingAccountRecord(await ensurePersonalBillingAccount(ctx, userId))
  },
})

export const ensureWorkspaceByServer = mutation({
  args: {
    primaryBillingContactUserId: v.string(),
    serverSecret: v.string(),
    workspaceId: v.string(),
  },
  returns: billingAccountValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return toBillingAccountRecord(await ensureWorkspaceBillingAccount(ctx, args))
  },
})
