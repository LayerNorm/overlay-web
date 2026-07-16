import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import { AdministrativeAuthorizationError, AdministrativeService, AuditService } from '@/server/admin'
import type { AdministrativeRepository, AuditRepository } from '@/server/admin'
import { ApiKeyService, type ApiKeyRepository } from '@/server/auth/api-keys'
import type { BillingProviderEventRepository } from '@/server/billing/BillingProviderEventRepository'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import type { ProjectRepository } from '@/server/projects/ProjectRepository'
import type { UsageRepository } from '@/server/usage/UsageRepository'

export type P7ProviderContractBackend = {
  administration: AdministrativeRepository
  apiKeys: ApiKeyRepository
  audit: AuditRepository
  billing: BillingRepository
  billingEvents: BillingProviderEventRepository
  cleanupUser?(userId: string): Promise<void>
  deleteUser(userId: string): Promise<void>
  prepareUser?(userId: string): Promise<void>
  projects: ProjectRepository
  provider: 'convex' | 'postgres'
  usage: UsageRepository
}

export async function runP7ProviderContract(
  t: TestContext,
  backend: P7ProviderContractBackend,
): Promise<void> {
  const scope = `p7g_${backend.provider}_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`
  const foreignUserId = `${scope}_foreign`
  const budgetUserId = `${scope}_budget`
  for (const id of [userId, foreignUserId, budgetUserId]) await backend.prepareUser?.(id)

  const audit = new AuditService(backend.audit)
  const administration = new AdministrativeService({ audit, repository: backend.administration })
  const apiKeys = new ApiKeyService(backend.apiKeys)

  try {
    await t.test(`${backend.provider} subscription, top-up, and entitlement calculation`, async () => {
      await seedPaidSubscription(backend.billing, userId, scope)
      const before = await backend.billing.getSubscriptionByUserIdByServer({ userId })
      assert.equal(before?.status, 'active')
      assert.equal(before?.planKind, 'paid')

      const topUp = {
        amountCents: 1_000,
        source: 'manual' as const,
        status: 'succeeded' as const,
        stripeCheckoutSessionId: `${scope}_checkout`,
        stripePaymentIntentId: `${scope}_payment`,
        userId,
      }
      await backend.billing.recordBudgetTopUp(topUp)
      await backend.billing.recordBudgetTopUp(topUp)
      await backend.billing.recordBudgetTopUp({ ...topUp, status: 'pending' })
      const topUps = await backend.billing.listBudgetTopUpsByServer({ userId })
      assert.equal(topUps.length, 1)
      assert.equal(topUps[0]?.status, 'succeeded')
      const entitlements = await backend.billing.getEntitlementsByServer({ userId })
      assert.ok(entitlements)
      assert.ok(entitlements!.budgetTotalCents >= 1_000)
      assert.equal(entitlements!.budgetRemainingCents, entitlements!.budgetTotalCents)
    })

    await t.test(`${backend.provider} usage reserve/finalize/release and idempotency`, async () => {
      const entitlements = await requireEntitlements(backend.usage, userId)
      const reservationId = `${scope}_finalize`
      const reserved = await backend.usage.reserve({
        entitlements,
        kind: 'ask',
        reservationId,
        reservedCents: 100,
        userId,
      })
      assert.equal(reserved.ok, true)
      assert.equal((await backend.usage.finalize({ actualCostCents: 75, reservationId, userId })).status, 'finalized')
      assert.equal((await backend.usage.finalize({ actualCostCents: 75, reservationId, userId })).status, 'finalized')

      const releaseId = `${scope}_release`
      assert.equal((await backend.usage.reserve({
        entitlements: await requireEntitlements(backend.usage, userId),
        kind: 'generation',
        reservationId: releaseId,
        reservedCents: 50,
        userId,
      })).ok, true)
      assert.equal((await backend.usage.release({ reservationId: releaseId, userId })).status, 'released')
      assert.equal((await backend.usage.release({ reservationId: releaseId, userId })).status, 'released')

      const operationId = `${scope}_record`
      const event = {
        costCents: 5,
        eventId: `${operationId}_event`,
        kind: 'embedding' as const,
        occurredAt: Date.now(),
      }
      assert.equal((await backend.usage.recordBatch({ events: [event], operationId, userId })).recorded, 1)
      assert.equal((await backend.usage.recordBatch({ events: [event], operationId, userId })).recorded, 0)
    })

    await t.test(`${backend.provider} enforces one budget under 20 concurrent reservations`, async () => {
      await seedPaidSubscription(backend.billing, budgetUserId, `${scope}_budget`)
      await backend.billing.recordBudgetTopUp({
        amountCents: 100,
        source: 'manual',
        status: 'succeeded',
        stripePaymentIntentId: `${scope}_budget_payment`,
        userId: budgetUserId,
      })
      const initial = await requireEntitlements(backend.usage, budgetUserId)
      const perReservationCents = initial.budgetRemainingCents! / 10
      const attempts = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
        const reservationId = `${scope}_concurrent_${index}`
        try {
          const result = await backend.usage.reserve({
            entitlements: await requireEntitlements(backend.usage, budgetUserId),
            kind: 'agent',
            reservationId,
            reservedCents: perReservationCents,
            userId: budgetUserId,
          })
          return { reservationId, ok: result.ok }
        } catch (_error) {
          return { reservationId, ok: false }
        }
      }))
      const accepted = attempts.filter((attempt) => attempt.ok)
      assert.equal(accepted.length, 10)
      for (const attempt of accepted) {
        await backend.usage.release({ reservationId: attempt.reservationId, userId: budgetUserId })
      }
    })

    await t.test(`${backend.provider} recovers provider-work and expired reservations`, async () => {
      const reconcileId = `${scope}_provider_work`
      await backend.usage.reserve({
        entitlements: await requireEntitlements(backend.usage, userId),
        kind: 'generation',
        reservationId: reconcileId,
        reservedCents: 25,
        userId,
      })
      assert.equal((await backend.usage.release({
        providerWorkStarted: true,
        reason: 'simulated worker death',
        reservationId: reconcileId,
        userId,
      })).status, 'reconcile_required')
      assert.equal((await backend.usage.finalize({
        actualCostCents: 20,
        reservationId: reconcileId,
        userId,
      })).status, 'finalized')

      const expiredId = `${scope}_expired`
      await backend.usage.reserve({
        entitlements: await requireEntitlements(backend.usage, userId),
        expiresAt: Date.now() - 1,
        kind: 'ask',
        reservationId: expiredId,
        reservedCents: 10,
        userId,
      })
      const reconciled = await backend.usage.reconcileExpired({ now: Date.now() })
      assert.ok(reconciled.released >= 1)
    })

    await t.test(`${backend.provider} deduplicates provider events and rejects payload changes`, async () => {
      const event = {
        eventId: `${scope}_stripe_event`,
        eventType: 'checkout.session.completed',
        payloadHash: 'contract-payload',
        provider: 'stripe',
      }
      assert.deepEqual(await backend.billingEvents.reserve(event), { status: 'acquired', attempt: 1 })
      await backend.billingEvents.markProcessed({ eventId: event.eventId, provider: event.provider })
      assert.deepEqual(await backend.billingEvents.reserve(event), { status: 'duplicate', processed: true })
      await assert.rejects(
        backend.billingEvents.reserve({ ...event, payloadHash: 'different-payload' }),
        /hash mismatch/,
      )
    })

    await t.test(`${backend.provider} API-key lifecycle, scope enforcement, and ownership`, async () => {
      const created = await apiKeys.create({
        createdBy: userId,
        name: 'P7 shared contract',
        scopes: ['chat:read', 'files:read'],
        userId,
      })
      assert.equal((await apiKeys.validate({ apiKey: created.key, requiredScopes: ['chat:read'] }))?.id, created.id)
      assert.equal(await apiKeys.validate({ apiKey: created.key, requiredScopes: ['chat:write'] }), null)
      assert.equal(await apiKeys.revokeById({ id: created.id, userId: foreignUserId }), false)
      const rotated = await apiKeys.rotateById({
        createdBy: userId,
        id: created.id,
        scopes: ['chat:read', 'chat:write'],
        userId,
      })
      assert.ok(rotated)
      assert.equal(await apiKeys.validate({ apiKey: created.key }), null)
      assert.ok(await apiKeys.validate({ apiKey: rotated!.key, requiredScopes: ['chat:write'] }))
      assert.equal(await apiKeys.revokeById({ id: rotated!.id, userId }), true)
    })

    await t.test(`${backend.provider} admin authorization and owned audit records`, async () => {
      await assert.rejects(administration.list(userId), AdministrativeAuthorizationError)
      await backend.administration.grant({
        grantedBy: 'system:p7-contract',
        reason: 'contract bootstrap',
        role: 'admin',
        userId,
      })
      await administration.grant({
        actorUserId: userId,
        role: 'auditor',
        userId: foreignUserId,
      })
      assert.equal(await administration.canViewAudit(foreignUserId), true)
      assert.equal(await administration.canManageAdministrators(foreignUserId), false)
      const adjusted = await backend.billing.adjustAdministrativeBudget({ amountCents: 250, userId })
      assert.ok(adjusted.budgetTotalCents >= 1_250)
      const usageRows = await backend.billing.listAdministrativeUsage({ userId })
      assert.equal(usageRows.length, 1)
      assert.equal(usageRows[0]?.userId, userId)
      await audit.record({
        action: 'p7.contract.audit',
        actorType: 'user',
        actorUserId: userId,
        metadata: { apiKey: 'redact-me', safe: 'visible' },
        outcome: 'success',
        resourceId: userId,
        resourceType: 'contract',
      })
      const events = await audit.list({ actorUserId: userId, limit: 20 })
      const event = events.find((candidate) => candidate.action === 'p7.contract.audit')
      assert.deepEqual(event?.metadata, { apiKey: '[REDACTED]', safe: 'visible' })
      assert.equal((await audit.list({ actorUserId: foreignUserId, limit: 20 }))
        .some((candidate) => candidate.action === 'p7.contract.audit'), false)
    })

    await t.test(`${backend.provider} project and account deletion remove owned P7 state`, async () => {
      const project = await backend.projects.createProject({ name: 'P7 deletion proof', userId })
      assert.equal(await backend.projects.getProject({ projectId: project._id, userId: foreignUserId }), null)
      assert.ok(await backend.projects.deleteProjectTree({ projectId: project._id, userId }))
      const key = await apiKeys.create({ createdBy: userId, scopes: ['chat:read'], userId })
      assert.ok(key)
      await backend.deleteUser(userId)
      assert.equal((await apiKeys.list({ userId })).length, 0)
      assert.equal(await backend.administration.get({ userId }), null)
      assert.equal((await backend.projects.listProjects({ includeDeleted: true, userId })).length, 0)
      assert.equal(await backend.billing.getSubscriptionByUserIdByServer({ userId }), null)
    })
  } finally {
    for (const id of [userId, foreignUserId, budgetUserId]) await backend.cleanupUser?.(id)
  }
}

async function seedPaidSubscription(billing: BillingRepository, userId: string, scope: string): Promise<void> {
  await billing.upsertSubscription({
    currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
    currentPeriodStart: Date.now(),
    email: `${scope}@example.test`,
    planAmountCents: 0,
    planKind: 'paid',
    status: 'active',
    tier: 'pro',
    userId,
  })
}

async function requireEntitlements(usage: UsageRepository, userId: string) {
  const entitlements = await usage.getEntitlements({ userId })
  assert.ok(entitlements, `Expected entitlements for ${userId}`)
  return entitlements!
}
