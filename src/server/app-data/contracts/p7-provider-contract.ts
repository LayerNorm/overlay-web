import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import type { AuditRepository } from '@/server/admin'
import { ApiKeyService, type ApiKeyRepository } from '@/server/auth/api-keys'
import type { BillingProviderEventRepository } from '@/server/billing/BillingProviderEventRepository'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import type { UsageRepository } from '@/server/usage/UsageRepository'

export type P7ProviderContractBackend = {
  apiKeys: ApiKeyRepository
  audit: AuditRepository
  billing: BillingRepository
  billingEvents: BillingProviderEventRepository
  cleanupUser?(userId: string): Promise<void>
  deleteUser(userId: string): Promise<void>
  prepareUser?(userId: string): Promise<void>
  provider: 'convex'
  usage: UsageRepository
}

function reservationSecurityContext(reservationId: string) {
  return {
    operationId: 'contract.usage-reservation',
    requestFingerprint: reservationId,
  }
}

export async function runP7ProviderContract(
  t: TestContext,
  backend: P7ProviderContractBackend,
): Promise<void> {
  const scope = `p7g_${backend.provider}_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`
  const foreignUserId = `${scope}_foreign`
  for (const id of [userId, foreignUserId]) await backend.prepareUser?.(id)

  const apiKeys = new ApiKeyService(backend.apiKeys)

  try {
    await t.test(`${backend.provider} personal billing accounts are idempotent and explicitly priced`, async () => {
      const concurrent = await Promise.all(Array.from({ length: 8 }, () =>
        backend.billing.ensurePersonalBillingAccount({ userId })))
      assert.equal(new Set(concurrent.map((account) => account.billingAccountId)).size, 1)
      const first = concurrent[0]!
      const replay = await backend.billing.ensurePersonalBillingAccount({ userId })

      assert.equal(replay.billingAccountId, first.billingAccountId)
      assert.equal(first.scope, 'personal')
      assert.equal(first.userId, userId)
      assert.equal(first.workspaceId, undefined)
      assert.equal(first.status, 'active')
      assert.equal(first.pricingVersion, 'markup_25_v1')
      assert.equal(first.markupBasisPoints, 2_500)
      assert.deepEqual(
        await backend.billing.getBillingAccountByIdByServer({
          billingAccountId: first.billingAccountId,
        }),
        first,
      )
      assert.deepEqual(
        await backend.billing.getPersonalBillingAccountByUserIdByServer({ userId }),
        first,
      )
      assert.equal(
        await backend.billing.getWorkspaceBillingAccountByWorkspaceIdByServer({
          workspaceId: `${scope}_missing_workspace`,
        }),
        null,
      )
    })

    await t.test(`${backend.provider} a person's own entitlements are always free`, async () => {
      const account = await backend.billing.ensurePersonalBillingAccount({ userId })
      const entitlements = await backend.billing.getEntitlementsByServer({ userId })
      assert.ok(entitlements)
      assert.equal(entitlements!.planKind, 'free')
      assert.equal(entitlements!.budgetTotalCents, 0)
      assert.equal(entitlements!.budgetRemainingCents, 0)
      assert.equal(entitlements!.billingAccountId ?? account.billingAccountId, account.billingAccountId)
    })

    await t.test(`${backend.provider} usage reserve/finalize/release and idempotency`, async () => {
      const entitlements = await requireEntitlements(backend.usage, userId)
      const reservationId = `${scope}_finalize`
      const reserved = await backend.usage.reserve({
        entitlements,
        kind: 'ask',
        ...reservationSecurityContext(reservationId),
        reservationId,
        reservedCents: 0,
        userId,
      })
      assert.equal(reserved.ok, true)
      // A person's own account has no credit: anything but free work is refused.
      const paidId = `${scope}_paid`
      const refused = await backend.usage.reserve({
        entitlements,
        kind: 'ask',
        ...reservationSecurityContext(paidId),
        reservationId: paidId,
        reservedCents: 100,
        userId,
      })
      assert.equal(refused.ok, false)
      assert.equal(refused.ok ? null : refused.code, 'insufficient_budget')
      await assert.rejects(
        backend.usage.reserve({
          entitlements,
          kind: 'agent',
          ...reservationSecurityContext(reservationId),
          modelId: 'different/model',
          reservationId,
          reservedCents: 0,
          userId,
        }),
        /mismatch|different parameters/,
      )
      assert.equal((await backend.usage.finalize({ actualCostCents: 0, reservationId, userId })).status, 'finalized')
      assert.equal((await backend.usage.finalize({ actualCostCents: 0, reservationId, userId })).status, 'finalized')

      const releaseId = `${scope}_release`
      assert.equal((await backend.usage.reserve({
        entitlements: await requireEntitlements(backend.usage, userId),
        kind: 'generation',
        ...reservationSecurityContext(releaseId),
        reservationId: releaseId,
        reservedCents: 0,
        userId,
      })).ok, true)
      assert.equal((await backend.usage.release({ reservationId: releaseId, userId })).status, 'released')
      assert.equal((await backend.usage.release({ reservationId: releaseId, userId })).status, 'released')

      const overageId = `${scope}_overage`
      assert.equal((await backend.usage.reserve({
        entitlements: await requireEntitlements(backend.usage, userId),
        kind: 'generation',
        ...reservationSecurityContext(overageId),
        reservationId: overageId,
        reservedCents: 0,
        userId,
      })).ok, true)
      await backend.usage.markStarted({ reservationId: overageId, userId })
      await assert.rejects(
        backend.usage.finalize({ actualCostCents: 1, reservationId: overageId, userId }),
        /actual_cost_exceeds_reservation/,
      )

      const operationId = `${scope}_record`
      const event = {
        costCents: 5,
        eventId: `${operationId}_event`,
        kind: 'embedding' as const,
        occurredAt: Date.now(),
      }
      assert.equal((await backend.usage.recordBatch({ events: [event], operationId, userId })).recorded, 1)
      assert.equal((await backend.usage.recordBatch({ events: [event], operationId, userId })).recorded, 0)
      // Usage outside a paid workspace is recorded but never charged to the person.
      const after = await requireEntitlements(backend.usage, userId)
      assert.equal(after.budgetUsedCents, 0)
    })

    await t.test(`${backend.provider} recovers provider-work and expired reservations`, async () => {
      const reconcileId = `${scope}_provider_work`
      await backend.usage.reserve({
        entitlements: await requireEntitlements(backend.usage, userId),
        kind: 'generation',
        ...reservationSecurityContext(reconcileId),
        reservationId: reconcileId,
        reservedCents: 0,
        userId,
      })
      assert.equal((await backend.usage.markStarted({
        reservationId: reconcileId,
        userId,
      })).status, 'reserved')
      assert.equal((await backend.usage.release({
        reason: 'simulated worker death',
        reservationId: reconcileId,
        userId,
      })).status, 'reconcile_required')
      assert.equal((await backend.usage.finalize({
        actualCostCents: 0,
        reservationId: reconcileId,
        userId,
      })).status, 'finalized')

      const expiredId = `${scope}_expired`
      await backend.usage.reserve({
        entitlements: await requireEntitlements(backend.usage, userId),
        expiresAt: Date.now() - 1,
        kind: 'ask',
        ...reservationSecurityContext(expiredId),
        reservationId: expiredId,
        reservedCents: 0,
        userId,
      })
      const reconciled = await backend.usage.reconcileExpired({ now: Date.now() })
      assert.ok(reconciled.released >= 1)
    })

    await t.test(`${backend.provider} resolves quarantined reservations only with replay-safe evidence`, async () => {
      const releaseId = `${scope}_evidence_release`
      await backend.usage.reserve({
        entitlements: await requireEntitlements(backend.usage, userId),
        kind: 'generation',
        ...reservationSecurityContext(releaseId),
        reservationId: releaseId,
        reservedCents: 0,
        userId,
      })
      await backend.usage.markStarted({ reservationId: releaseId, userId })
      await backend.usage.release({
        reason: 'simulated provider timeout',
        reservationId: releaseId,
        userId,
      })
      const queue = await backend.usage.listReconciliationQueue({ limit: 100, userId })
      assert.ok(queue.some((item) => item.reservationId === releaseId))

      const evidence = {
        reason: 'Provider confirms the request was never accepted.',
        reference: `${scope}_provider_request_missing`,
        source: 'provider-api',
      }
      assert.deepEqual(await backend.usage.resolveReconciliation({
        evidence,
        reservationId: releaseId,
        resolution: 'release',
        userId,
      }), { idempotent: false, status: 'released' })
      assert.deepEqual(await backend.usage.resolveReconciliation({
        evidence,
        reservationId: releaseId,
        resolution: 'release',
        userId,
      }), { idempotent: true, status: 'released' })
      await assert.rejects(backend.usage.resolveReconciliation({
        actualCostCents: 0,
        evidence,
        reservationId: releaseId,
        resolution: 'finalize',
        userId,
      }), /reconciliation_resolution_conflict/)

      const finalizeId = `${scope}_evidence_finalize`
      await backend.usage.reserve({
        entitlements: await requireEntitlements(backend.usage, userId),
        kind: 'generation',
        ...reservationSecurityContext(finalizeId),
        reservationId: finalizeId,
        reservedCents: 0,
        userId,
      })
      await backend.usage.markStarted({ reservationId: finalizeId, userId })
      await backend.usage.release({
        reason: 'simulated response loss',
        reservationId: finalizeId,
        userId,
      })
      const finalized = await backend.usage.resolveReconciliation({
        actualCostCents: 0,
        evidence: {
          reason: 'Provider usage record confirms the completed request.',
          reference: `${scope}_provider_usage_record`,
          source: 'provider-api',
        },
        reservationId: finalizeId,
        resolution: 'finalize',
        userId,
      })
      assert.deepEqual(finalized, {
        finalizedCents: 0,
        idempotent: false,
        status: 'finalized',
      })
      assert.equal(
        (await backend.usage.listReconciliationQueue({ limit: 100, userId }))
          .some((item) => item.reservationId === finalizeId || item.reservationId === releaseId),
        false,
      )
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

    await t.test(`${backend.provider} operational audit is append-only for the customer web`, async () => {
      const event = await backend.audit.append({
        action: 'p7.contract.audit', actorType: 'user', actorUserId: userId,
        metadata: { apiKey: 'redact-me', safe: 'visible' }, outcome: 'success',
        resourceId: userId, resourceType: 'contract',
      })
      assert.deepEqual(event.metadata, { apiKey: '[REDACTED]', safe: 'visible' })
      await assert.rejects(backend.audit.list({ actorUserId: userId }), /standalone admin/)
    })

    await t.test(`${backend.provider} account deletion removes owned P7 state`, async () => {
      const key = await apiKeys.create({ createdBy: userId, scopes: ['chat:read'], userId })
      assert.ok(key)
      await backend.deleteUser(userId)
      assert.equal((await apiKeys.list({ userId })).length, 0)
    })
  } finally {
    for (const id of [userId, foreignUserId]) await backend.cleanupUser?.(id)
  }
}

async function requireEntitlements(usage: UsageRepository, userId: string) {
  const entitlements = await usage.getEntitlements({ userId })
  assert.ok(entitlements, `Expected entitlements for ${userId}`)
  return entitlements!
}
