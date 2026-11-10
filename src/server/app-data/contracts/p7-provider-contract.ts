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
