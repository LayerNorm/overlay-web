import 'server-only'

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  CURRENT_BILLING_ACCOUNT_MARKUP_BASIS_POINTS,
  CURRENT_BILLING_ACCOUNT_PRICING_VERSION,
  assertBillingAccountOwnership,
  type BillingAccountRecord,
} from '@/shared/billing/billing-account'
import {
  compareBillingBalanceSnapshots,
  type BillingBalanceParityReport,
  type BillingBalanceSnapshot,
  type BillingSubscriptionVerificationRow,
} from '@/shared/billing/billing-account-migration'
import {
  assertBillingSpendSubject,
  type BillingAccountSpendLimitRecord,
  type BillingSpendSubject,
} from '@/shared/billing/billing-payer'
import type {
  BillingEntitlementsRecord,
  BillingRepository,
  BillingSubscriptionRecord,
  BudgetTopUpRecord,
  AdministrativeUsageRecord,
  PersonalBillingBackfillResult,
} from './BillingRepository'
import type {
  BillingProviderEventRepository,
  BillingProviderEventReservation,
  BillingWebhookRepository,
} from './BillingProviderEventRepository'

const MICROS_PER_CENT = 10_000

type SubscriptionRow = {
  autoTopUpAmountCents: number
  autoTopUpEnabled: boolean
  billingAccountId: string | null
  currentPeriodEnd: Date | string | null
  currentPeriodStart: Date | string | null
  email: string | null
  offSessionConsentAt: Date | string | null
  planAmountCents: number
  planKind: 'free' | 'paid'
  providerCustomerId: string | null
  providerSubscriptionId: string | null
  status: 'active' | 'canceled' | 'past_due' | 'trialing'
  tier: 'free' | 'pro' | 'max'
  userId: string
}

type BillingAccountRow = {
  billingAccountId: string
  closedAt: Date | string | null
  createdAt: Date | string
  markupBasisPoints: number
  ownerUserId: string | null
  pricingVersion: 'markup_25_v1'
  primaryBillingContactUserId: string | null
  scope: 'personal' | 'workspace'
  status: 'active' | 'suspended' | 'closed'
  updatedAt: Date | string
  workspaceId: string | null
}

type BillingSpendLimitRow = {
  billingAccountId: string
  createdAt: Date | string
  limitMicros: number | string
  periodEnd: Date | string
  periodStart: Date | string
  reservedMicros: number | string
  subjectId: string
  subjectKind: 'member' | 'programmatic'
  updatedAt: Date | string
  usedMicros: number | string
  version: number
}

type Transaction = Parameters<Parameters<OverlayPostgresDb['transaction']>[0]>[0]

export class PostgresBillingRepository implements BillingRepository, BillingWebhookRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async ensurePersonalBillingAccount(args: { userId: string }): Promise<BillingAccountRecord> {
    const userId = args.userId.trim()
    if (!userId) throw new Error('billing_account_user_required')
    return await this.db.transaction(async (tx) => {
      const account = await ensurePersonalAccount(tx, userId)
      return billingAccountRecord(account)
    })
  }

  async ensureWorkspaceBillingAccount(args: {
    primaryBillingContactUserId: string
    workspaceId: string
  }): Promise<BillingAccountRecord> {
    const workspaceId = args.workspaceId.trim()
    const primaryBillingContactUserId = args.primaryBillingContactUserId.trim()
    if (!workspaceId) throw new Error('billing_account_workspace_required')
    if (!primaryBillingContactUserId) throw new Error('billing_account_contact_required')
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO billing_accounts (
          id, scope, workspace_id, status, primary_billing_contact_user_id,
          pricing_version, markup_basis_points
        ) VALUES (
          ${`ba_${randomUUID().replaceAll('-', '')}`}, 'workspace', ${workspaceId}, 'active',
          ${primaryBillingContactUserId}, ${CURRENT_BILLING_ACCOUNT_PRICING_VERSION},
          ${CURRENT_BILLING_ACCOUNT_MARKUP_BASIS_POINTS}
        )
        ON CONFLICT DO NOTHING
      `)
      const account = await selectWorkspaceBillingAccount(tx, workspaceId)
      if (!account) throw new Error('Workspace billing account could not be created')
      await tx.execute(sql`
        INSERT INTO billing_account_balances (billing_account_id, mode)
        VALUES (${account.billingAccountId}, 'budgeted')
        ON CONFLICT (billing_account_id) DO NOTHING
      `)
      return billingAccountRecord(account)
    })
  }

  async backfillPersonalBillingAccountByServer(args: {
    userId: string
  }): Promise<PersonalBillingBackfillResult> {
    const userId = args.userId.trim()
    if (!userId) throw new Error('billing_account_user_required')
    return await this.db.transaction(async (tx) => {
      const account = await ensurePersonalAccount(tx, userId)
      const billingAccountId = account.billingAccountId
      const attachedUsageEvents = await attachByUser(tx, 'usage_events', userId, billingAccountId)
      const attachedUsageTransactions = await attachByUser(tx, 'usage_budget_transactions', userId, billingAccountId)
      const attached = {
        budgetReservations: await attachByUser(tx, 'usage_reservations', userId, billingAccountId),
        budgetTopUps: await attachByUser(tx, 'billing_top_ups', userId, billingAccountId),
        daytonaUsageLedger: 0,
        subscriptions: await attachByUser(tx, 'billing_subscriptions', userId, billingAccountId),
        tokenUsage: 0,
        toolInvocations: 0,
        usageOperations: attachedUsageEvents + attachedUsageTransactions,
      }
      await attachByUser(tx, 'usage_budget_accounts', userId, billingAccountId)
      await syncCanonicalSubscriptionFromLegacy(tx, userId, billingAccountId)
      await syncCanonicalBalanceFromLegacy(tx, userId, billingAccountId)
      return { attached, billingAccountId, complete: true, userId }
    })
  }

  async getBillingAccountByIdByServer(args: {
    billingAccountId: string
  }): Promise<BillingAccountRecord | null> {
    const result = await this.db.execute<BillingAccountRow>(sql`
      ${billingAccountSelect()}
      WHERE account.id = ${args.billingAccountId.trim()}
      LIMIT 1
    `)
    return result.rows[0] ? billingAccountRecord(result.rows[0]) : null
  }

  async getPersonalBillingAccountByUserIdByServer(args: {
    userId: string
  }): Promise<BillingAccountRecord | null> {
    const account = await selectPersonalBillingAccount(this.db, args.userId.trim())
    return account ? billingAccountRecord(account) : null
  }

  async getWorkspaceBillingAccountByWorkspaceIdByServer(args: {
    workspaceId: string
  }): Promise<BillingAccountRecord | null> {
    const result = await this.db.execute<BillingAccountRow>(sql`
      ${billingAccountSelect()}
      WHERE account.scope = 'workspace' AND account.workspace_id = ${args.workspaceId.trim()}
      LIMIT 1
    `)
    return result.rows[0] ? billingAccountRecord(result.rows[0]) : null
  }

  async getPersonalBillingBalanceParityByServer(args: {
    userId: string
  }): Promise<BillingBalanceParityReport | null> {
    const result = await this.db.execute<{
      billingAccountId: string
      canonicalAllowanceUsedMicros: number | string
      canonicalIncludedMicros: number | string
      canonicalInstitutionalGrantMicros: number | string
      canonicalMode: 'budgeted' | 'unlimited'
      canonicalReservedMicros: number | string
      canonicalTopUpBalanceMicros: number | string
      canonicalTopUpPurchasedMicros: number | string
      canonicalUsedMicros: number | string
      legacyAllowanceUsedMicros: number | string
      legacyIncludedMicros: number | string
      legacyInstitutionalGrantMicros: number | string
      legacyMode: 'budgeted' | 'unlimited'
      legacyReservedMicros: number | string
      legacyTopUpBalanceMicros: number | string
      legacyTopUpPurchasedMicros: number | string
      legacyUsedMicros: number | string
    }>(sql`
      SELECT
        account.id AS "billingAccountId",
        COALESCE(legacy.mode, 'budgeted') AS "legacyMode",
        COALESCE(legacy.included_micros, 0) AS "legacyIncludedMicros",
        COALESCE(legacy.institutional_grant_micros, 0) AS "legacyInstitutionalGrantMicros",
        COALESCE(legacy.allowance_used_micros, 0) AS "legacyAllowanceUsedMicros",
        COALESCE(legacy.top_up_purchased_micros, 0) AS "legacyTopUpPurchasedMicros",
        COALESCE(legacy.top_up_balance_micros, 0) AS "legacyTopUpBalanceMicros",
        COALESCE(legacy.used_micros, 0) AS "legacyUsedMicros",
        COALESCE(legacy.reserved_micros, 0) AS "legacyReservedMicros",
        canonical.mode AS "canonicalMode",
        canonical.included_micros AS "canonicalIncludedMicros",
        canonical.institutional_grant_micros AS "canonicalInstitutionalGrantMicros",
        canonical.allowance_used_micros AS "canonicalAllowanceUsedMicros",
        canonical.top_up_purchased_micros AS "canonicalTopUpPurchasedMicros",
        canonical.top_up_balance_micros AS "canonicalTopUpBalanceMicros",
        canonical.used_micros AS "canonicalUsedMicros",
        canonical.reserved_micros AS "canonicalReservedMicros"
      FROM billing_accounts account
      JOIN billing_account_balances canonical ON canonical.billing_account_id = account.id
      LEFT JOIN usage_budget_accounts legacy ON legacy.user_id = account.owner_user_id
      WHERE account.scope = 'personal' AND account.owner_user_id = ${args.userId.trim()}
      LIMIT 1
    `)
    const row = result.rows[0]
    if (!row) return null
    const legacy = balanceSnapshot(row.billingAccountId, 'legacy', row)
    const canonical = balanceSnapshot(row.billingAccountId, 'canonical', row)
    return compareBillingBalanceSnapshots({ canonical, legacy, userId: args.userId.trim() })
  }

  async listSubscriptionVerificationRowsByServer(args: {
    limit?: number
  } = {}): Promise<BillingSubscriptionVerificationRow[]> {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 1), 500)
    const result = await this.db.execute<{
      billingAccountId: string | null
      planAmountCents: number
      providerCustomerId: string | null
      providerPriceId: string | null
      providerQuantity: number | null
      providerSubscriptionId: string | null
      status: BillingSubscriptionVerificationRow['status']
      userId: string
    }>(sql`
      SELECT user_id AS "userId", billing_account_id AS "billingAccountId",
             provider_customer_id AS "providerCustomerId",
             provider_subscription_id AS "providerSubscriptionId",
             provider_price_id AS "providerPriceId", provider_quantity AS "providerQuantity",
             plan_amount_cents AS "planAmountCents", status
      FROM billing_subscriptions
      ORDER BY user_id ASC
      LIMIT ${limit}
    `)
    return result.rows.map((row) => ({
      ...(row.billingAccountId === null ? {} : { billingAccountId: row.billingAccountId }),
      planAmountCents: Number(row.planAmountCents),
      ...(row.providerCustomerId === null ? {} : { providerCustomerId: row.providerCustomerId }),
      ...(row.providerPriceId === null ? {} : { providerPriceId: row.providerPriceId }),
      ...(row.providerQuantity === null ? {} : { providerQuantity: Number(row.providerQuantity) }),
      ...(row.providerSubscriptionId === null
        ? {}
        : { providerSubscriptionId: row.providerSubscriptionId }),
      status: row.status,
      userId: row.userId,
    }))
  }

  async getBillingAccountSpendLimitByServer(args: {
    billingAccountId: string
    subject: BillingSpendSubject
  }): Promise<BillingAccountSpendLimitRecord | null> {
    assertBillingSpendSubject(args.subject)
    const result = await this.db.execute<BillingSpendLimitRow>(sql`
      ${billingSpendLimitSelect()}
      WHERE billing_account_id = ${args.billingAccountId.trim()}
        AND subject_kind = ${args.subject.kind}
        AND subject_id = ${args.subject.id.trim()}
      LIMIT 1
    `)
    return result.rows[0] ? billingSpendLimitRecord(result.rows[0]) : null
  }

  async upsertBillingAccountSpendLimit(args: {
    billingAccountId: string
    limitCents: number
    periodEnd: number
    periodStart: number
    subject: BillingSpendSubject
  }): Promise<BillingAccountSpendLimitRecord> {
    assertBillingSpendSubject(args.subject)
    if (!Number.isFinite(args.limitCents) || args.limitCents < 0) throw new Error('billing_spend_limit_invalid')
    if (!Number.isFinite(args.periodStart) || !Number.isFinite(args.periodEnd) || args.periodEnd <= args.periodStart) {
      throw new Error('billing_spend_limit_period_invalid')
    }
    const result = await this.db.execute<BillingSpendLimitRow>(sql`
      INSERT INTO billing_account_spend_limits (
        billing_account_id, subject_kind, subject_id, limit_micros,
        period_start, period_end
      )
      SELECT ${args.billingAccountId.trim()}, ${args.subject.kind}, ${args.subject.id.trim()},
             ${Math.round(args.limitCents * MICROS_PER_CENT)},
             ${new Date(args.periodStart)}, ${new Date(args.periodEnd)}
      FROM billing_accounts
      WHERE id = ${args.billingAccountId.trim()} AND status = 'active'
      ON CONFLICT (billing_account_id, subject_kind, subject_id) DO UPDATE SET
        limit_micros = EXCLUDED.limit_micros,
        used_micros = CASE
          WHEN billing_account_spend_limits.period_start = EXCLUDED.period_start
           AND billing_account_spend_limits.period_end = EXCLUDED.period_end
          THEN billing_account_spend_limits.used_micros ELSE 0 END,
        reserved_micros = CASE
          WHEN billing_account_spend_limits.period_start = EXCLUDED.period_start
           AND billing_account_spend_limits.period_end = EXCLUDED.period_end
          THEN billing_account_spend_limits.reserved_micros ELSE 0 END,
        period_start = EXCLUDED.period_start,
        period_end = EXCLUDED.period_end,
        version = billing_account_spend_limits.version + 1,
        updated_at = now()
      WHERE CASE
        WHEN billing_account_spend_limits.period_start = EXCLUDED.period_start
         AND billing_account_spend_limits.period_end = EXCLUDED.period_end
        THEN billing_account_spend_limits.used_micros + billing_account_spend_limits.reserved_micros
        ELSE billing_account_spend_limits.reserved_micros END <= EXCLUDED.limit_micros
        AND (
          (billing_account_spend_limits.period_start = EXCLUDED.period_start
           AND billing_account_spend_limits.period_end = EXCLUDED.period_end)
          OR billing_account_spend_limits.reserved_micros = 0
        )
      RETURNING billing_account_id AS "billingAccountId", subject_kind AS "subjectKind",
                subject_id AS "subjectId", limit_micros AS "limitMicros",
                used_micros AS "usedMicros", reserved_micros AS "reservedMicros",
                period_start AS "periodStart", period_end AS "periodEnd", version,
                created_at AS "createdAt", updated_at AS "updatedAt"
    `)
    const row = result.rows[0]
    if (!row) throw new Error('billing_spend_limit_below_committed_or_account_inactive')
    return billingSpendLimitRecord(row)
  }

  async listAdministrativeUsage(args: {
    limit?: number
    userId?: string
  } = {}): Promise<AdministrativeUsageRecord[]> {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200)
    const result = await this.db.execute<{
      budgetRemainingCents: number | string
      budgetTotalCents: number | string
      budgetUsedCents: number | string
      allowanceTotalCents: number | string
      allowanceUsedCents: number | string
      topUpBalanceCents: number | string
      email: string | null
      planKind: 'free' | 'paid'
      status: 'active' | 'canceled' | 'past_due' | 'trialing'
      userId: string
    }>(sql`
      SELECT subscription.user_id AS "userId", subscription.email,
             subscription.plan_kind AS "planKind", subscription.status,
             (COALESCE(budget.included_micros, 0) + COALESCE(budget.granted_micros, 0)) / ${MICROS_PER_CENT}::numeric AS "budgetTotalCents",
             COALESCE(budget.used_micros, 0) / ${MICROS_PER_CENT}::numeric AS "budgetUsedCents",
             (COALESCE(budget.included_micros, 0) + COALESCE(budget.institutional_grant_micros, 0)) / ${MICROS_PER_CENT}::numeric AS "allowanceTotalCents",
             COALESCE(budget.allowance_used_micros, 0) / ${MICROS_PER_CENT}::numeric AS "allowanceUsedCents",
             COALESCE(budget.top_up_balance_micros, 0) / ${MICROS_PER_CENT}::numeric AS "topUpBalanceCents",
             GREATEST(0, COALESCE(budget.included_micros, 0) + COALESCE(budget.granted_micros, 0) - COALESCE(budget.used_micros, 0) - COALESCE(budget.reserved_micros, 0)) / ${MICROS_PER_CENT}::numeric AS "budgetRemainingCents"
      FROM billing_subscriptions subscription
      LEFT JOIN usage_budget_accounts budget ON budget.user_id = subscription.user_id
      WHERE (${args.userId ?? null}::text IS NULL OR subscription.user_id = ${args.userId ?? null})
      ORDER BY subscription.updated_at DESC
      LIMIT ${limit}
    `)
    return result.rows.map((row) => ({
      ...row,
      email: row.email ?? undefined,
      budgetRemainingCents: Number(row.budgetRemainingCents),
      budgetTotalCents: Number(row.budgetTotalCents),
      budgetUsedCents: Number(row.budgetUsedCents),
      allowanceTotalCents: Number(row.allowanceTotalCents),
      allowanceUsedCents: Number(row.allowanceUsedCents),
      allowancePercentUsed: percentageUsed(Number(row.allowanceUsedCents), Number(row.allowanceTotalCents)),
      topUpBalanceCents: Number(row.topUpBalanceCents),
    }))
  }

  async adjustAdministrativeBudget(args: {
    amountCents: number
    userId: string
  }): Promise<AdministrativeUsageRecord> {
    if (!Number.isFinite(args.amountCents) || args.amountCents === 0) {
      throw new Error('amountCents must be a non-zero number')
    }
    await this.db.transaction(async (tx) => {
      const account = await ensurePersonalAccount(tx, args.userId)
      const updated = await tx.execute(sql`
        INSERT INTO usage_budget_accounts (
          user_id, billing_account_id, mode, institutional_grant_micros, granted_micros
        )
        VALUES (
          ${args.userId}, ${account.billingAccountId}, 'budgeted',
          ${Math.max(0, args.amountCents * MICROS_PER_CENT)},
          ${Math.max(0, args.amountCents * MICROS_PER_CENT)}
        )
        ON CONFLICT (user_id) DO UPDATE SET
          billing_account_id = EXCLUDED.billing_account_id,
          mode = 'budgeted',
          institutional_grant_micros = GREATEST(
            0,
            usage_budget_accounts.institutional_grant_micros + ${args.amountCents * MICROS_PER_CENT}
          ),
          granted_micros = GREATEST(
            0,
            usage_budget_accounts.institutional_grant_micros + ${args.amountCents * MICROS_PER_CENT}
          ) + usage_budget_accounts.top_up_purchased_micros,
          version = usage_budget_accounts.version + 1,
          updated_at = now()
        WHERE usage_budget_accounts.included_micros + GREATEST(
          0,
          usage_budget_accounts.institutional_grant_micros + ${args.amountCents * MICROS_PER_CENT}
        ) >= usage_budget_accounts.allowance_used_micros
        RETURNING user_id
      `)
      if (updated.rowCount !== 1) {
        throw new Error('Administrative grant cannot be reduced below consumed allowance')
      }
      await syncCanonicalBalanceFromLegacy(tx, args.userId, account.billingAccountId)
    })
    const record = (await this.listAdministrativeUsage({ userId: args.userId, limit: 1 }))[0]
    if (!record) throw new Error('Billing subscription not found')
    return record
  }

  async getEntitlementsByServer(args: { userId: string }): Promise<BillingEntitlementsRecord | null> {
    const result = await this.db.execute<SubscriptionRow & {
      grantedMicros: number | string
      includedMicros: number | string
      institutionalGrantMicros: number | string
      allowanceUsedMicros: number | string
      topUpBalanceMicros: number | string
      reservedMicros: number | string
      usedMicros: number | string
    }>(sql`
      SELECT subscription.user_id AS "userId",
             subscription.billing_account_id AS "billingAccountId",
             subscription.email,
             subscription.provider_customer_id AS "providerCustomerId",
             subscription.provider_subscription_id AS "providerSubscriptionId",
             subscription.tier,
             subscription.plan_kind AS "planKind",
             subscription.plan_amount_cents AS "planAmountCents",
             subscription.status,
             subscription.auto_top_up_enabled AS "autoTopUpEnabled",
             subscription.auto_top_up_amount_cents AS "autoTopUpAmountCents",
             subscription.off_session_consent_at AS "offSessionConsentAt",
             subscription.current_period_end AS "currentPeriodEnd",
             COALESCE(budget.included_micros, 0) AS "includedMicros",
             COALESCE(budget.institutional_grant_micros, 0) AS "institutionalGrantMicros",
             COALESCE(budget.allowance_used_micros, 0) AS "allowanceUsedMicros",
             COALESCE(budget.top_up_balance_micros, 0) AS "topUpBalanceMicros",
             COALESCE(budget.granted_micros, 0) AS "grantedMicros",
             COALESCE(budget.used_micros, 0) AS "usedMicros",
             COALESCE(budget.reserved_micros, 0) AS "reservedMicros"
      FROM billing_subscriptions subscription
      LEFT JOIN usage_budget_accounts budget ON budget.user_id = subscription.user_id
      WHERE subscription.user_id = ${args.userId}
      LIMIT 1
    `)
    const row = result.rows[0]
    if (!row) return null
    const totalCents = toCents(row.includedMicros) + toCents(row.grantedMicros)
    const usedCents = toCents(row.usedMicros)
    const reservedCents = toCents(row.reservedMicros)
    const allowanceTotalCents = toCents(row.includedMicros) + toCents(row.institutionalGrantMicros)
    const allowanceUsedCents = toCents(row.allowanceUsedMicros)
    return {
      billingAccountId: row.billingAccountId ?? undefined,
      tier: row.tier,
      planKind: row.planKind,
      planAmountCents: Number(row.planAmountCents),
      status: row.status,
      budgetUsedCents: usedCents,
      budgetTotalCents: totalCents,
      budgetRemainingCents: Math.max(0, totalCents - usedCents - reservedCents),
      allowanceTotalCents,
      allowanceUsedCents,
      allowancePercentUsed: percentageUsed(allowanceUsedCents, allowanceTotalCents),
      topUpBalanceCents: Math.max(0, toCents(row.topUpBalanceMicros) - Math.max(0, reservedCents - Math.max(0, allowanceTotalCents - allowanceUsedCents))),
      autoTopUpEnabled: row.autoTopUpEnabled,
      autoTopUpAmountCents: Number(row.autoTopUpAmountCents),
      autoTopUpConsentGranted: Boolean(row.offSessionConsentAt),
      creditsUsed: usedCents,
      creditsTotal: totalCents / 100,
      billingPeriodEnd: isoValue(row.currentPeriodEnd),
    }
  }

  async getSubscriptionByUserIdByServer(args: { userId: string }): Promise<BillingSubscriptionRecord | null> {
    return await this.getSubscription(args.userId)
  }

  async getSubscriptionByUserId(args: { accessToken: string; userId: string }): Promise<BillingSubscriptionRecord | null> {
    return await this.getSubscription(args.userId)
  }

  async updateBillingPreferences(args: {
    autoTopUpEnabled: boolean
    grantOffSessionConsent: boolean
    topUpAmountCents: number
    userId: string
  }): Promise<{ success: boolean; error?: string }> {
    return await this.db.transaction(async (tx) => {
      const account = await ensurePersonalAccount(tx, args.userId)
      const result = await tx.execute(sql`
        UPDATE billing_subscriptions
        SET billing_account_id = ${account.billingAccountId},
            auto_top_up_enabled = ${args.autoTopUpEnabled},
            auto_top_up_amount_cents = ${args.topUpAmountCents},
            off_session_consent_at = CASE
              WHEN ${args.grantOffSessionConsent} THEN COALESCE(off_session_consent_at, now())
              WHEN NOT ${args.autoTopUpEnabled} THEN NULL
              ELSE off_session_consent_at
            END,
            updated_at = now()
        WHERE user_id = ${args.userId}
      `)
      if (result.rowCount !== 1) return { success: false, error: 'Subscription not found' }
      await syncCanonicalSubscriptionFromLegacy(tx, args.userId, account.billingAccountId)
      return { success: true }
    })
  }

  async upsertSubscription(args: Record<string, unknown> & { userId: string }): Promise<{ userId: string }> {
    const provider = textValue(args.provider) ?? 'stripe'
    const customerId = textValue(args.stripeCustomerId ?? args.providerCustomerId)
    const subscriptionId = textValue(args.stripeSubscriptionId ?? args.providerSubscriptionId)
    const incomingPeriodStart = dateValue(args.currentPeriodStart)
    const includedMicros = (numberValue(args.planAmountCents) ?? 0) * MICROS_PER_CENT
    await this.db.transaction(async (tx) => {
      const account = await ensurePersonalAccount(tx, args.userId)
      const previous = await tx.execute<{ currentPeriodStart: Date | string | null }>(sql`
        SELECT current_period_start AS "currentPeriodStart"
        FROM billing_subscriptions
        WHERE user_id = ${args.userId}
        FOR UPDATE
      `)
      const priorPeriodStart = previous.rows[0]?.currentPeriodStart
      const periodChanged = Boolean(
        priorPeriodStart && incomingPeriodStart &&
        new Date(priorPeriodStart).getTime() !== incomingPeriodStart.getTime(),
      )
      if (customerId || subscriptionId) {
        const conflict = await tx.execute<{ userId: string }>(sql`
          SELECT user_id AS "userId"
          FROM billing_subscriptions
          WHERE provider = ${provider}
            AND user_id <> ${args.userId}
            AND (
              (${customerId ?? null}::text IS NOT NULL AND provider_customer_id = ${customerId ?? null})
              OR (${subscriptionId ?? null}::text IS NOT NULL AND provider_subscription_id = ${subscriptionId ?? null})
            )
          LIMIT 1
        `)
        if (conflict.rows[0]) {
          throw new Error('Stripe customer or subscription already belongs to another user')
        }
      }
      await tx.execute(sql`
        INSERT INTO billing_subscriptions (
          user_id, billing_account_id, email, name, provider, provider_customer_id, provider_subscription_id,
          provider_price_id, provider_quantity, tier, plan_kind, plan_version,
          plan_amount_cents, markup_basis_points, status, auto_top_up_enabled,
          auto_top_up_amount_cents, off_session_consent_at, current_period_start,
          current_period_end, provider_event_created_at, updated_at
        ) VALUES (
          ${args.userId}, ${account.billingAccountId}, ${textValue(args.email) ?? null}, ${textValue(args.name) ?? null},
          ${provider}, ${customerId ?? null}, ${subscriptionId ?? null},
          ${textValue(args.stripePriceId ?? args.providerPriceId) ?? null},
          ${numberValue(args.stripeQuantity ?? args.providerQuantity) ?? null},
          ${tierValue(args.tier)}, ${planKindValue(args.planKind)}, ${textValue(args.planVersion) ?? null},
          ${numberValue(args.planAmountCents) ?? 0}, ${numberValue(args.markupBasisPoints) ?? null},
          ${statusValue(args.status)}, ${booleanValue(args.autoTopUpEnabled) ?? false},
          ${numberValue(args.autoTopUpAmountCents) ?? 0}, ${dateValue(args.offSessionConsentAt)},
          ${incomingPeriodStart}, ${dateValue(args.currentPeriodEnd)},
          ${dateValue(args.providerEventCreatedAt)}, now()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          billing_account_id = EXCLUDED.billing_account_id,
          email = COALESCE(EXCLUDED.email, billing_subscriptions.email),
          name = COALESCE(EXCLUDED.name, billing_subscriptions.name),
          provider = EXCLUDED.provider,
          provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, billing_subscriptions.provider_customer_id),
          provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, billing_subscriptions.provider_subscription_id),
          provider_price_id = COALESCE(EXCLUDED.provider_price_id, billing_subscriptions.provider_price_id),
          provider_quantity = COALESCE(EXCLUDED.provider_quantity, billing_subscriptions.provider_quantity),
          tier = EXCLUDED.tier,
          plan_kind = EXCLUDED.plan_kind,
          plan_version = COALESCE(EXCLUDED.plan_version, billing_subscriptions.plan_version),
          plan_amount_cents = EXCLUDED.plan_amount_cents,
          markup_basis_points = COALESCE(EXCLUDED.markup_basis_points, billing_subscriptions.markup_basis_points),
          status = EXCLUDED.status,
          auto_top_up_enabled = EXCLUDED.auto_top_up_enabled,
          auto_top_up_amount_cents = EXCLUDED.auto_top_up_amount_cents,
          off_session_consent_at = COALESCE(EXCLUDED.off_session_consent_at, billing_subscriptions.off_session_consent_at),
          current_period_start = COALESCE(EXCLUDED.current_period_start, billing_subscriptions.current_period_start),
          current_period_end = COALESCE(EXCLUDED.current_period_end, billing_subscriptions.current_period_end),
          provider_event_created_at = COALESCE(EXCLUDED.provider_event_created_at, billing_subscriptions.provider_event_created_at),
          updated_at = now()
        WHERE EXCLUDED.provider_event_created_at IS NULL
           OR billing_subscriptions.provider_event_created_at IS NULL
           OR EXCLUDED.provider_event_created_at >= billing_subscriptions.provider_event_created_at
      `)
      if (periodChanged) {
        const activeReservations = await tx.execute<{ count: number | string }>(sql`
          SELECT COUNT(*)::integer AS count
          FROM usage_reservations
          WHERE user_id = ${args.userId}
            AND status IN ('reserved', 'reconcile_required')
        `)
        if (Number(activeReservations.rows[0]?.count ?? 0) > 0) {
          throw new Error('Cannot roll over a usage period while reservations are active')
        }
      }
      const budgetUpdate = await tx.execute(sql`
        INSERT INTO usage_budget_accounts (user_id, billing_account_id, mode, included_micros)
        VALUES (${args.userId}, ${account.billingAccountId}, 'budgeted', ${includedMicros})
        ON CONFLICT (user_id) DO UPDATE SET
          billing_account_id = EXCLUDED.billing_account_id,
          mode = 'budgeted',
          included_micros = EXCLUDED.included_micros,
          allowance_used_micros = CASE
            WHEN ${periodChanged} THEN 0
            ELSE LEAST(
              usage_budget_accounts.used_micros,
              EXCLUDED.included_micros + usage_budget_accounts.institutional_grant_micros
            )
          END,
          used_micros = CASE
            WHEN ${periodChanged} THEN 0
            ELSE usage_budget_accounts.used_micros
          END,
          top_up_purchased_micros = CASE
            WHEN ${periodChanged} THEN usage_budget_accounts.top_up_balance_micros
            ELSE usage_budget_accounts.top_up_purchased_micros
          END,
          top_up_balance_micros = CASE
            WHEN ${periodChanged} THEN usage_budget_accounts.top_up_balance_micros
            ELSE usage_budget_accounts.top_up_purchased_micros - GREATEST(
              0,
              usage_budget_accounts.used_micros - EXCLUDED.included_micros -
                usage_budget_accounts.institutional_grant_micros
            )
          END,
          granted_micros = CASE
            WHEN ${periodChanged} THEN
              usage_budget_accounts.institutional_grant_micros + usage_budget_accounts.top_up_balance_micros
            ELSE usage_budget_accounts.granted_micros
          END,
          version = usage_budget_accounts.version + 1,
          updated_at = now()
        WHERE ${periodChanged} OR
          usage_budget_accounts.used_micros + usage_budget_accounts.reserved_micros <=
            EXCLUDED.included_micros + usage_budget_accounts.institutional_grant_micros +
              usage_budget_accounts.top_up_purchased_micros
        RETURNING user_id
      `)
      if (budgetUpdate.rowCount !== 1) {
        throw new Error('Subscription change would remove already consumed or reserved credits')
      }
      await syncCanonicalSubscriptionFromLegacy(tx, args.userId, account.billingAccountId)
      await syncCanonicalBalanceFromLegacy(tx, args.userId, account.billingAccountId)
    })
    return { userId: args.userId }
  }

  async listBudgetTopUpsByServer(args: { userId: string }): Promise<BudgetTopUpRecord[]> {
    const result = await this.db.execute<{
      amountCents: number
      billingAccountId: string | null
      createdAt: Date | string
      errorMessage: string | null
      id: string
      source: 'manual' | 'auto'
      status: 'pending' | 'succeeded' | 'failed' | 'canceled'
      stripePaymentIntentId: string | null
      updatedAt: Date | string
    }>(sql`
      SELECT id, billing_account_id AS "billingAccountId", amount_cents AS "amountCents", source, status,
             provider_payment_intent_id AS "stripePaymentIntentId",
             created_at AS "createdAt", updated_at AS "updatedAt", error_message AS "errorMessage"
      FROM billing_top_ups
      WHERE user_id = ${args.userId}
      ORDER BY created_at DESC
      LIMIT 100
    `)
    return result.rows.map((row) => ({
      _id: row.id,
      billingAccountId: row.billingAccountId ?? undefined,
      amountCents: Number(row.amountCents),
      source: row.source,
      status: row.status,
      stripePaymentIntentId: row.stripePaymentIntentId ?? undefined,
      createdAt: millisValue(row.createdAt),
      updatedAt: millisValue(row.updatedAt),
      errorMessage: row.errorMessage ?? undefined,
    }))
  }

  async recordBudgetTopUp(args: {
    amountCents: number
    source: 'manual' | 'auto'
    status: 'pending' | 'succeeded' | 'failed' | 'canceled'
    stripeCheckoutSessionId?: string
    stripeCustomerId?: string
    stripePaymentIntentId?: string
    errorMessage?: string
    userId: string
  }): Promise<{ id: string; granted: boolean }> {
    return await this.db.transaction(async (tx) => {
      const account = await ensurePersonalAccount(tx, args.userId)
      const existing = await tx.execute<{ amountCents: number; id: string; status: string; userId: string }>(sql`
        SELECT id, status, amount_cents AS "amountCents", user_id AS "userId"
        FROM billing_top_ups
        WHERE (${args.stripeCheckoutSessionId ?? null}::text IS NOT NULL AND provider_checkout_session_id = ${args.stripeCheckoutSessionId ?? null})
           OR (${args.stripePaymentIntentId ?? null}::text IS NOT NULL AND provider_payment_intent_id = ${args.stripePaymentIntentId ?? null})
        FOR UPDATE
      `)
      const row = existing.rows[0]
      if (row && row.userId !== args.userId) {
        throw new Error('Top-up provider reference already belongs to another user')
      }
      if (row && Number(row.amountCents) !== args.amountCents) {
        throw new Error('Top-up provider reference was reused with a different amount')
      }
      const id = row?.id ?? `billing_topup_${randomUUID()}`
      const grant = args.status === 'succeeded' && row?.status !== 'succeeded'
      const persistedStatus = row?.status === 'succeeded' ? 'succeeded' : args.status
      if (row) {
        await tx.execute(sql`
          UPDATE billing_top_ups
          SET billing_account_id = ${account.billingAccountId},
              status = ${persistedStatus},
              error_message = ${args.errorMessage ?? null},
              updated_at = now()
          WHERE id = ${id} AND user_id = ${args.userId}
        `)
      } else {
        await tx.execute(sql`
          INSERT INTO billing_top_ups (
            id, user_id, billing_account_id, amount_cents, source, status, provider_checkout_session_id,
            provider_customer_id, provider_payment_intent_id, error_message
          ) VALUES (
            ${id}, ${args.userId}, ${account.billingAccountId}, ${args.amountCents}, ${args.source}, ${args.status},
            ${args.stripeCheckoutSessionId ?? null}, ${args.stripeCustomerId ?? null},
            ${args.stripePaymentIntentId ?? null}, ${args.errorMessage ?? null}
          )
        `)
      }
      if (grant) {
        const amountMicros = args.amountCents * MICROS_PER_CENT
        await tx.execute(sql`
          INSERT INTO usage_budget_accounts (
            user_id, billing_account_id, mode, top_up_purchased_micros, top_up_balance_micros, granted_micros
          )
          VALUES (${args.userId}, ${account.billingAccountId}, 'budgeted', ${amountMicros}, ${amountMicros}, ${amountMicros})
          ON CONFLICT (user_id) DO UPDATE
          SET billing_account_id = EXCLUDED.billing_account_id,
              mode = 'budgeted',
              top_up_purchased_micros = usage_budget_accounts.top_up_purchased_micros + ${amountMicros},
              top_up_balance_micros = usage_budget_accounts.top_up_balance_micros + ${amountMicros},
              granted_micros = usage_budget_accounts.granted_micros + ${amountMicros},
              version = usage_budget_accounts.version + 1,
              updated_at = now()
        `)
      }
      await syncCanonicalBalanceFromLegacy(tx, args.userId, account.billingAccountId)
      return { id, granted: grant }
    })
  }

  async resolveUserIdByProviderReference(args: {
    provider: string
    providerCustomerId?: string
    providerSubscriptionId?: string
  }): Promise<string | null> {
    const result = await this.db.execute<{ userId: string }>(sql`
      SELECT user_id AS "userId"
      FROM billing_subscriptions
      WHERE provider = ${args.provider}
        AND (
          (${args.providerCustomerId ?? null}::text IS NOT NULL AND provider_customer_id = ${args.providerCustomerId ?? null})
          OR (${args.providerSubscriptionId ?? null}::text IS NOT NULL AND provider_subscription_id = ${args.providerSubscriptionId ?? null})
        )
      LIMIT 1
    `)
    return result.rows[0]?.userId ?? null
  }

  private async getSubscription(userId: string): Promise<BillingSubscriptionRecord | null> {
    const result = await this.db.execute<SubscriptionRow>(sql`
      SELECT user_id AS "userId", email,
             billing_account_id AS "billingAccountId",
             provider_customer_id AS "providerCustomerId",
             provider_subscription_id AS "providerSubscriptionId",
             tier, plan_kind AS "planKind", plan_amount_cents AS "planAmountCents",
             status, auto_top_up_enabled AS "autoTopUpEnabled",
             auto_top_up_amount_cents AS "autoTopUpAmountCents",
             off_session_consent_at AS "offSessionConsentAt",
             current_period_start AS "currentPeriodStart",
             current_period_end AS "currentPeriodEnd"
      FROM billing_subscriptions WHERE user_id = ${userId} LIMIT 1
    `)
    const row = result.rows[0]
    if (!row) return null
    return {
      billingAccountId: row.billingAccountId ?? undefined,
      userId: row.userId,
      email: row.email ?? undefined,
      stripeCustomerId: row.providerCustomerId ?? undefined,
      stripeSubscriptionId: row.providerSubscriptionId ?? undefined,
      tier: row.tier,
      planKind: row.planKind,
      planAmountCents: Number(row.planAmountCents),
      status: row.status,
      autoTopUpEnabled: row.autoTopUpEnabled,
      autoTopUpAmountCents: Number(row.autoTopUpAmountCents),
      offSessionConsentAt: row.offSessionConsentAt ? millisValue(row.offSessionConsentAt) : undefined,
      currentPeriodStart: row.currentPeriodStart ? millisValue(row.currentPeriodStart) : undefined,
      currentPeriodEnd: row.currentPeriodEnd ? millisValue(row.currentPeriodEnd) : undefined,
    }
  }
}

type BillingAccountExecutor = Pick<OverlayPostgresDb, 'execute'>

type LegacyBillingTable =
  | 'billing_subscriptions'
  | 'billing_top_ups'
  | 'usage_budget_accounts'
  | 'usage_budget_transactions'
  | 'usage_events'
  | 'usage_reservations'

async function ensurePersonalAccount(
  tx: Transaction,
  userId: string,
): Promise<BillingAccountRow> {
  await tx.execute(sql`
    INSERT INTO billing_accounts (
      id, scope, owner_user_id, status, primary_billing_contact_user_id,
      pricing_version, markup_basis_points
    ) VALUES (
      ${`ba_${randomUUID().replaceAll('-', '')}`}, 'personal', ${userId}, 'active', ${userId},
      ${CURRENT_BILLING_ACCOUNT_PRICING_VERSION},
      ${CURRENT_BILLING_ACCOUNT_MARKUP_BASIS_POINTS}
    )
    ON CONFLICT DO NOTHING
  `)
  const account = await selectPersonalBillingAccount(tx, userId)
  if (!account) throw new Error('Personal billing account could not be created')
  await tx.execute(sql`
    INSERT INTO billing_account_balances (billing_account_id, mode)
    VALUES (${account.billingAccountId}, 'budgeted')
    ON CONFLICT (billing_account_id) DO NOTHING
  `)
  return account
}

async function attachByUser(
  tx: Transaction,
  table: LegacyBillingTable,
  userId: string,
  billingAccountId: string,
): Promise<number> {
  const tableSql = legacyBillingTableSql(table)
  const result = await tx.execute(sql`
    UPDATE ${tableSql}
    SET billing_account_id = ${billingAccountId}
    WHERE user_id = ${userId} AND billing_account_id IS NULL
  `)
  return result.rowCount ?? 0
}

function legacyBillingTableSql(table: LegacyBillingTable) {
  switch (table) {
    case 'billing_subscriptions': return sql.raw('billing_subscriptions')
    case 'billing_top_ups': return sql.raw('billing_top_ups')
    case 'usage_budget_accounts': return sql.raw('usage_budget_accounts')
    case 'usage_budget_transactions': return sql.raw('usage_budget_transactions')
    case 'usage_events': return sql.raw('usage_events')
    case 'usage_reservations': return sql.raw('usage_reservations')
  }
}

async function syncCanonicalSubscriptionFromLegacy(
  tx: Transaction,
  userId: string,
  billingAccountId: string,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO billing_account_subscriptions (
      billing_account_id, provider, provider_customer_id, provider_subscription_id,
      provider_price_id, provider_quantity, plan_kind, plan_version, plan_amount_cents,
      markup_basis_points, status, auto_top_up_enabled, auto_top_up_amount_cents,
      off_session_consent_at, current_period_start, current_period_end,
      provider_event_created_at, created_at, updated_at
    )
    SELECT
      ${billingAccountId}, provider, provider_customer_id, provider_subscription_id,
      provider_price_id, provider_quantity, plan_kind, 'variable_v2', plan_amount_cents,
      COALESCE(markup_basis_points, ${CURRENT_BILLING_ACCOUNT_MARKUP_BASIS_POINTS}),
      status, auto_top_up_enabled, auto_top_up_amount_cents,
      off_session_consent_at, current_period_start, current_period_end,
      provider_event_created_at, created_at, updated_at
    FROM billing_subscriptions
    WHERE user_id = ${userId}
    ON CONFLICT (billing_account_id) DO UPDATE SET
      provider = EXCLUDED.provider,
      provider_customer_id = EXCLUDED.provider_customer_id,
      provider_subscription_id = EXCLUDED.provider_subscription_id,
      provider_price_id = EXCLUDED.provider_price_id,
      provider_quantity = EXCLUDED.provider_quantity,
      plan_kind = EXCLUDED.plan_kind,
      plan_version = EXCLUDED.plan_version,
      plan_amount_cents = EXCLUDED.plan_amount_cents,
      markup_basis_points = EXCLUDED.markup_basis_points,
      status = EXCLUDED.status,
      auto_top_up_enabled = EXCLUDED.auto_top_up_enabled,
      auto_top_up_amount_cents = EXCLUDED.auto_top_up_amount_cents,
      off_session_consent_at = EXCLUDED.off_session_consent_at,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      provider_event_created_at = EXCLUDED.provider_event_created_at,
      updated_at = EXCLUDED.updated_at
  `)
}

async function syncCanonicalBalanceFromLegacy(
  tx: Transaction,
  userId: string,
  billingAccountId: string,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO billing_account_balances (
      billing_account_id, mode, included_micros, institutional_grant_micros,
      allowance_used_micros, top_up_purchased_micros, top_up_balance_micros,
      used_micros, reserved_micros, version, updated_at
    )
    SELECT
      ${billingAccountId}, mode, included_micros, institutional_grant_micros,
      allowance_used_micros, top_up_purchased_micros, top_up_balance_micros,
      used_micros, reserved_micros, version, updated_at
    FROM usage_budget_accounts
    WHERE user_id = ${userId}
    ON CONFLICT (billing_account_id) DO UPDATE SET
      mode = EXCLUDED.mode,
      included_micros = EXCLUDED.included_micros,
      institutional_grant_micros = EXCLUDED.institutional_grant_micros,
      allowance_used_micros = EXCLUDED.allowance_used_micros,
      top_up_purchased_micros = EXCLUDED.top_up_purchased_micros,
      top_up_balance_micros = EXCLUDED.top_up_balance_micros,
      used_micros = EXCLUDED.used_micros,
      reserved_micros = EXCLUDED.reserved_micros,
      version = EXCLUDED.version,
      updated_at = EXCLUDED.updated_at
  `)
}

function balanceSnapshot(
  billingAccountId: string,
  prefix: 'legacy' | 'canonical',
  row: Record<string, unknown>,
): BillingBalanceSnapshot {
  const mode = row[`${prefix}Mode`]
  if (mode !== 'budgeted' && mode !== 'unlimited') throw new Error('Invalid billing balance mode')
  return {
    allowanceUsedMicros: Number(row[`${prefix}AllowanceUsedMicros`]),
    billingAccountId,
    includedMicros: Number(row[`${prefix}IncludedMicros`]),
    institutionalGrantMicros: Number(row[`${prefix}InstitutionalGrantMicros`]),
    mode,
    reservedMicros: Number(row[`${prefix}ReservedMicros`]),
    topUpBalanceMicros: Number(row[`${prefix}TopUpBalanceMicros`]),
    topUpPurchasedMicros: Number(row[`${prefix}TopUpPurchasedMicros`]),
    usedMicros: Number(row[`${prefix}UsedMicros`]),
  }
}

async function selectPersonalBillingAccount(
  executor: BillingAccountExecutor,
  userId: string,
): Promise<BillingAccountRow | null> {
  if (!userId) return null
  const result = await executor.execute<BillingAccountRow>(sql`
    ${billingAccountSelect()}
    WHERE account.scope = 'personal' AND account.owner_user_id = ${userId}
    LIMIT 1
  `)
  return result.rows[0] ?? null
}

async function selectWorkspaceBillingAccount(
  executor: BillingAccountExecutor,
  workspaceId: string,
): Promise<BillingAccountRow | null> {
  if (!workspaceId) return null
  const result = await executor.execute<BillingAccountRow>(sql`
    ${billingAccountSelect()}
    WHERE account.scope = 'workspace' AND account.workspace_id = ${workspaceId}
    LIMIT 1
  `)
  return result.rows[0] ?? null
}

function billingSpendLimitSelect() {
  return sql`
    SELECT billing_account_id AS "billingAccountId", subject_kind AS "subjectKind",
           subject_id AS "subjectId", limit_micros AS "limitMicros",
           used_micros AS "usedMicros", reserved_micros AS "reservedMicros",
           period_start AS "periodStart", period_end AS "periodEnd", version,
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM billing_account_spend_limits
  `
}

function billingSpendLimitRecord(row: BillingSpendLimitRow): BillingAccountSpendLimitRecord {
  return {
    billingAccountId: row.billingAccountId,
    createdAt: millisValue(row.createdAt),
    limitCents: Number(row.limitMicros) / MICROS_PER_CENT,
    periodEnd: millisValue(row.periodEnd),
    periodStart: millisValue(row.periodStart),
    reservedCents: Number(row.reservedMicros) / MICROS_PER_CENT,
    subject: { id: row.subjectId, kind: row.subjectKind },
    updatedAt: millisValue(row.updatedAt),
    usedCents: Number(row.usedMicros) / MICROS_PER_CENT,
    version: row.version,
  }
}

function billingAccountSelect() {
  return sql`
    SELECT
      account.id AS "billingAccountId",
      account.scope,
      account.owner_user_id AS "ownerUserId",
      account.workspace_id AS "workspaceId",
      account.status,
      account.primary_billing_contact_user_id AS "primaryBillingContactUserId",
      account.pricing_version AS "pricingVersion",
      account.markup_basis_points AS "markupBasisPoints",
      account.created_at AS "createdAt",
      account.updated_at AS "updatedAt",
      account.closed_at AS "closedAt"
    FROM billing_accounts account
  `
}

function billingAccountRecord(row: BillingAccountRow): BillingAccountRecord {
  if (row.pricingVersion !== CURRENT_BILLING_ACCOUNT_PRICING_VERSION) {
    throw new Error(`Unsupported billing account pricing version: ${row.pricingVersion}`)
  }
  assertBillingAccountOwnership({
    scope: row.scope,
    ...(row.ownerUserId === null ? {} : { userId: row.ownerUserId }),
    ...(row.workspaceId === null ? {} : { workspaceId: row.workspaceId }),
  })
  return {
    billingAccountId: row.billingAccountId,
    ...(row.closedAt === null ? {} : { closedAt: millisValue(row.closedAt) }),
    createdAt: millisValue(row.createdAt),
    markupBasisPoints: Number(row.markupBasisPoints),
    pricingVersion: row.pricingVersion,
    ...(row.primaryBillingContactUserId === null
      ? {}
      : { primaryBillingContactUserId: row.primaryBillingContactUserId }),
    scope: row.scope,
    status: row.status,
    updatedAt: millisValue(row.updatedAt),
    ...(row.ownerUserId === null ? {} : { userId: row.ownerUserId }),
    ...(row.workspaceId === null ? {} : { workspaceId: row.workspaceId }),
  }
}

export class PostgresBillingProviderEventRepository implements BillingProviderEventRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async reserve(args: {
    eventId: string
    eventType: string
    payloadHash: string
    provider: string
  }): Promise<BillingProviderEventReservation> {
    return await this.db.transaction(async (tx) => {
      const inserted = await tx.execute(sql`
        INSERT INTO billing_provider_events (provider, event_id, event_type, payload_hash)
        VALUES (${args.provider}, ${args.eventId}, ${args.eventType}, ${args.payloadHash})
        ON CONFLICT (provider, event_id) DO NOTHING
      `)
      if (inserted.rowCount === 1) return { status: 'acquired', attempt: 1 }
      const existing = await tx.execute<{
        attempts: number
        payloadHash: string
        status: 'processing' | 'processed' | 'failed'
      }>(sql`
        SELECT payload_hash AS "payloadHash", status, attempts
        FROM billing_provider_events
        WHERE provider = ${args.provider} AND event_id = ${args.eventId}
        FOR UPDATE
      `)
      const row = existing.rows[0]
      if (!row) throw new Error('Billing provider event reservation disappeared')
      if (row.payloadHash !== args.payloadHash) {
        throw new Error('Billing provider event payload hash mismatch')
      }
      if (row.status !== 'failed') {
        return { status: 'duplicate', processed: row.status === 'processed' }
      }
      const attempt = Number(row.attempts) + 1
      await tx.execute(sql`
        UPDATE billing_provider_events
        SET status = 'processing', attempts = ${attempt}, last_error = NULL, updated_at = now()
        WHERE provider = ${args.provider} AND event_id = ${args.eventId}
      `)
      return { status: 'acquired', attempt }
    })
  }

  async markProcessed(args: { eventId: string; provider: string }): Promise<void> {
    await this.db.execute(sql`
      UPDATE billing_provider_events
      SET status = 'processed', processed_at = now(), last_error = NULL, updated_at = now()
      WHERE provider = ${args.provider} AND event_id = ${args.eventId}
    `)
  }

  async markFailed(args: { error: string; eventId: string; provider: string }): Promise<void> {
    await this.db.execute(sql`
      UPDATE billing_provider_events
      SET status = 'failed', last_error = ${args.error.slice(0, 2000)}, updated_at = now()
      WHERE provider = ${args.provider} AND event_id = ${args.eventId}
    `)
  }
}

function toCents(value: number | string): number {
  return Number(value) / MICROS_PER_CENT
}

function percentageUsed(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, used / total * 100))
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function dateValue(value: unknown): Date | null {
  const millis = numberValue(value)
  return millis && millis > 0 ? new Date(millis) : null
}

function tierValue(value: unknown): 'free' | 'pro' | 'max' {
  return value === 'pro' || value === 'max' ? value : 'free'
}

function planKindValue(value: unknown): 'free' | 'paid' {
  return value === 'paid' ? 'paid' : 'free'
}

function statusValue(value: unknown): 'active' | 'canceled' | 'past_due' | 'trialing' {
  return value === 'canceled' || value === 'past_due' || value === 'trialing' ? value : 'active'
}

function millisValue(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function isoValue(value: Date | string | null): string | undefined {
  if (!value) return undefined
  return new Date(value).toISOString()
}
