import 'server-only'

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import type {
  BillingEntitlementsRecord,
  BillingRepository,
  BillingSubscriptionRecord,
  BudgetTopUpRecord,
  AdministrativeUsageRecord,
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
  currentPeriodEnd: Date | string | null
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

export class PostgresBillingRepository implements BillingRepository, BillingWebhookRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async listAdministrativeUsage(args: {
    limit?: number
    userId?: string
  } = {}): Promise<AdministrativeUsageRecord[]> {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200)
    const result = await this.db.execute<{
      budgetRemainingCents: number | string
      budgetTotalCents: number | string
      budgetUsedCents: number | string
      email: string | null
      planKind: 'free' | 'paid'
      status: 'active' | 'canceled' | 'past_due' | 'trialing'
      userId: string
    }>(sql`
      SELECT subscription.user_id AS "userId", subscription.email,
             subscription.plan_kind AS "planKind", subscription.status,
             (COALESCE(budget.included_micros, 0) + COALESCE(budget.granted_micros, 0)) / ${MICROS_PER_CENT}::numeric AS "budgetTotalCents",
             COALESCE(budget.used_micros, 0) / ${MICROS_PER_CENT}::numeric AS "budgetUsedCents",
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
    }))
  }

  async adjustAdministrativeBudget(args: {
    amountCents: number
    userId: string
  }): Promise<AdministrativeUsageRecord> {
    if (!Number.isFinite(args.amountCents) || args.amountCents === 0) {
      throw new Error('amountCents must be a non-zero number')
    }
    await this.db.execute(sql`
      INSERT INTO usage_budget_accounts (user_id, mode, granted_micros)
      VALUES (${args.userId}, 'budgeted', ${Math.max(0, args.amountCents * MICROS_PER_CENT)})
      ON CONFLICT (user_id) DO UPDATE SET
        mode = 'budgeted',
        granted_micros = GREATEST(0, usage_budget_accounts.granted_micros + ${args.amountCents * MICROS_PER_CENT}),
        version = usage_budget_accounts.version + 1,
        updated_at = now()
    `)
    const record = (await this.listAdministrativeUsage({ userId: args.userId, limit: 1 }))[0]
    if (!record) throw new Error('Billing subscription not found')
    return record
  }

  async getEntitlementsByServer(args: { userId: string }): Promise<BillingEntitlementsRecord | null> {
    const result = await this.db.execute<SubscriptionRow & {
      grantedMicros: number | string
      includedMicros: number | string
      reservedMicros: number | string
      usedMicros: number | string
    }>(sql`
      SELECT subscription.user_id AS "userId",
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
    return {
      tier: row.tier,
      planKind: row.planKind,
      planAmountCents: Number(row.planAmountCents),
      status: row.status,
      budgetUsedCents: usedCents,
      budgetTotalCents: totalCents,
      budgetRemainingCents: Math.max(0, totalCents - usedCents - reservedCents),
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
    const result = await this.db.execute(sql`
      UPDATE billing_subscriptions
      SET auto_top_up_enabled = ${args.autoTopUpEnabled},
          auto_top_up_amount_cents = ${args.topUpAmountCents},
          off_session_consent_at = CASE
            WHEN ${args.grantOffSessionConsent} THEN COALESCE(off_session_consent_at, now())
            WHEN NOT ${args.autoTopUpEnabled} THEN NULL
            ELSE off_session_consent_at
          END,
          updated_at = now()
      WHERE user_id = ${args.userId}
    `)
    return result.rowCount === 1
      ? { success: true }
      : { success: false, error: 'Subscription not found' }
  }

  async upsertSubscription(args: Record<string, unknown> & { userId: string }): Promise<{ userId: string }> {
    const provider = textValue(args.provider) ?? 'stripe'
    const customerId = textValue(args.stripeCustomerId ?? args.providerCustomerId)
    const subscriptionId = textValue(args.stripeSubscriptionId ?? args.providerSubscriptionId)
    await this.db.transaction(async (tx) => {
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
          user_id, email, name, provider, provider_customer_id, provider_subscription_id,
          provider_price_id, provider_quantity, tier, plan_kind, plan_version,
          plan_amount_cents, markup_basis_points, status, auto_top_up_enabled,
          auto_top_up_amount_cents, off_session_consent_at, current_period_start,
          current_period_end, updated_at
        ) VALUES (
          ${args.userId}, ${textValue(args.email) ?? null}, ${textValue(args.name) ?? null},
          ${provider}, ${customerId ?? null}, ${subscriptionId ?? null},
          ${textValue(args.stripePriceId ?? args.providerPriceId) ?? null},
          ${numberValue(args.stripeQuantity ?? args.providerQuantity) ?? null},
          ${tierValue(args.tier)}, ${planKindValue(args.planKind)}, ${textValue(args.planVersion) ?? null},
          ${numberValue(args.planAmountCents) ?? 0}, ${numberValue(args.markupBasisPoints) ?? null},
          ${statusValue(args.status)}, ${booleanValue(args.autoTopUpEnabled) ?? false},
          ${numberValue(args.autoTopUpAmountCents) ?? 0}, ${dateValue(args.offSessionConsentAt)},
          ${dateValue(args.currentPeriodStart)}, ${dateValue(args.currentPeriodEnd)}, now()
        )
        ON CONFLICT (user_id) DO UPDATE SET
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
          updated_at = now()
      `)
      await tx.execute(sql`
        INSERT INTO usage_budget_accounts (user_id, mode)
        VALUES (${args.userId}, 'budgeted')
        ON CONFLICT (user_id) DO UPDATE SET mode = 'budgeted', updated_at = now()
      `)
    })
    return { userId: args.userId }
  }

  async listBudgetTopUpsByServer(args: { userId: string }): Promise<BudgetTopUpRecord[]> {
    const result = await this.db.execute<{
      amountCents: number
      createdAt: Date | string
      errorMessage: string | null
      id: string
      source: 'manual' | 'auto'
      status: 'pending' | 'succeeded' | 'failed' | 'canceled'
      updatedAt: Date | string
    }>(sql`
      SELECT id, amount_cents AS "amountCents", source, status,
             created_at AS "createdAt", updated_at AS "updatedAt", error_message AS "errorMessage"
      FROM billing_top_ups
      WHERE user_id = ${args.userId}
      ORDER BY created_at DESC
      LIMIT 100
    `)
    return result.rows.map((row) => ({
      _id: row.id,
      amountCents: Number(row.amountCents),
      source: row.source,
      status: row.status,
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
    userId: string
  }): Promise<{ id: string; granted: boolean }> {
    return await this.db.transaction(async (tx) => {
      const existing = await tx.execute<{ id: string; status: string }>(sql`
        SELECT id, status
        FROM billing_top_ups
        WHERE (${args.stripeCheckoutSessionId ?? null}::text IS NOT NULL AND provider_checkout_session_id = ${args.stripeCheckoutSessionId ?? null})
           OR (${args.stripePaymentIntentId ?? null}::text IS NOT NULL AND provider_payment_intent_id = ${args.stripePaymentIntentId ?? null})
        FOR UPDATE
      `)
      const row = existing.rows[0]
      const id = row?.id ?? `billing_topup_${randomUUID()}`
      const grant = args.status === 'succeeded' && row?.status !== 'succeeded'
      const persistedStatus = row?.status === 'succeeded' ? 'succeeded' : args.status
      if (row) {
        await tx.execute(sql`
          UPDATE billing_top_ups
          SET status = ${persistedStatus}, updated_at = now()
          WHERE id = ${id} AND user_id = ${args.userId}
        `)
      } else {
        await tx.execute(sql`
          INSERT INTO billing_top_ups (
            id, user_id, amount_cents, source, status, provider_checkout_session_id,
            provider_customer_id, provider_payment_intent_id
          ) VALUES (
            ${id}, ${args.userId}, ${args.amountCents}, ${args.source}, ${args.status},
            ${args.stripeCheckoutSessionId ?? null}, ${args.stripeCustomerId ?? null},
            ${args.stripePaymentIntentId ?? null}
          )
        `)
      }
      if (grant) {
        await tx.execute(sql`
          INSERT INTO usage_budget_accounts (user_id, mode, granted_micros)
          VALUES (${args.userId}, 'budgeted', ${args.amountCents * MICROS_PER_CENT})
          ON CONFLICT (user_id) DO UPDATE
          SET mode = 'budgeted',
              granted_micros = usage_budget_accounts.granted_micros + EXCLUDED.granted_micros,
              version = usage_budget_accounts.version + 1,
              updated_at = now()
        `)
      }
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
             provider_customer_id AS "providerCustomerId",
             provider_subscription_id AS "providerSubscriptionId",
             tier, plan_kind AS "planKind", plan_amount_cents AS "planAmountCents",
             status, auto_top_up_enabled AS "autoTopUpEnabled",
             auto_top_up_amount_cents AS "autoTopUpAmountCents",
             off_session_consent_at AS "offSessionConsentAt",
             current_period_end AS "currentPeriodEnd"
      FROM billing_subscriptions WHERE user_id = ${userId} LIMIT 1
    `)
    const row = result.rows[0]
    if (!row) return null
    return {
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
    }
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
