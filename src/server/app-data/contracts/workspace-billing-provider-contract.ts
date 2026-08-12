import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import { BillingPayerResolver } from '@/server/billing/BillingPayerResolver'
import type { UsageRepository } from '@/server/usage/UsageRepository'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'

export type WorkspaceBillingContractBackend = {
  billing: BillingRepository
  cleanupWorkspace?(workspaceId: string): Promise<void>
  cleanupUser?(userId: string): Promise<void>
  prepareUser?(userId: string, email: string): Promise<void>
  provider: 'convex' | 'postgres'
  usage: UsageRepository
  workspaces: WorkspaceService
}

export async function runWorkspaceBillingProviderContract(
  t: TestContext,
  backend: WorkspaceBillingContractBackend,
): Promise<void> {
  const scope = `workspace_contract_${backend.provider}_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const memberUserId = `${scope}_member`
  const ownerEmail = `${ownerUserId}@example.test`
  const memberEmail = `${memberUserId}@example.test`
  await backend.prepareUser?.(ownerUserId, ownerEmail)
  await backend.prepareUser?.(memberUserId, memberEmail)
  const workspace = await backend.workspaces.createOrganization({
    actorUserId: ownerUserId,
    email: ownerEmail,
    name: scope,
  })
  const emptyWorkspace = await backend.workspaces.createOrganization({
    actorUserId: ownerUserId,
    email: ownerEmail,
    name: `${scope} empty`,
  })
  const account = await backend.billing.ensureWorkspaceBillingAccount({
    primaryBillingContactUserId: ownerUserId,
    workspaceId: workspace.workspace.id,
  })
  const emptyAccount = await backend.billing.ensureWorkspaceBillingAccount({
    primaryBillingContactUserId: ownerUserId,
    workspaceId: emptyWorkspace.workspace.id,
  })

  try {
    await t.test(`${backend.provider} empty workspace wallet hard-stops without a personal account`, async () => {
      const result = await backend.usage.reserveWorkspace({
        kind: 'agent',
        operationId: `${scope}_empty`,
        payer: {
          billingAccountId: emptyAccount.billingAccountId,
          scope: 'workspace',
          subject: { id: ownerUserId, kind: 'member' },
          workspaceId: emptyWorkspace.workspace.id,
        },
        requestFingerprint: `${scope}_empty`,
        reservationId: `${scope}_empty`,
        reservedCents: 1,
        userId: ownerUserId,
      })
      assert.equal(result.ok, false)
      assert.equal(await backend.billing.getPersonalBillingAccountByUserIdByServer({ userId: ownerUserId }), null)
    })

    await backend.billing.upsertBillingAccountSubscription({
      billingAccountId: account.billingAccountId,
      currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60_000,
      currentPeriodStart: Date.now() - 60_000,
      planAmountCents: 800,
      planKind: 'paid',
      status: 'active',
      stripeCustomerId: `${scope}_customer`,
      stripePriceId: `${scope}_price`,
      stripeQuantity: 8,
      stripeSubscriptionId: `${scope}_subscription`,
    })
    await backend.billing.recordBillingAccountTopUp({
      actorUserId: ownerUserId,
      amountCents: 800,
      billingAccountId: account.billingAccountId,
      source: 'manual',
      status: 'succeeded',
      stripePaymentIntentId: `${scope}_topup`,
    })

    await t.test(`${backend.provider} member and wallet limits are atomic and account identity cannot be spoofed`, async () => {
      const periodStart = Date.now() - 60_000
      const periodEnd = Date.now() + 60 * 60_000
      await backend.billing.upsertBillingAccountSpendLimit({
        billingAccountId: account.billingAccountId,
        limitCents: 300,
        periodEnd,
        periodStart,
        subject: { id: ownerUserId, kind: 'member' },
      })
      const payer = {
        billingAccountId: account.billingAccountId,
        scope: 'workspace' as const,
        subject: { id: ownerUserId, kind: 'member' as const },
        workspaceId: workspace.workspace.id,
      }
      const attempts = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
        try {
          return await backend.usage.reserveWorkspace({
            kind: 'agent',
            operationId: `${scope}_concurrent_${index}`,
            payer,
            requestFingerprint: `${scope}_concurrent_${index}`,
            reservationId: `${scope}_concurrent_${index}`,
            reservedCents: 100,
            userId: ownerUserId,
          })
        } catch (_error) {
          return { ok: false as const }
        }
      }))
      const accepted = attempts.filter((result) => result.ok)
      assert.equal(accepted.length, 3)
      for (const result of accepted) {
        if (result.ok && result.reservationId) {
          await backend.usage.release({ reservationId: result.reservationId, userId: ownerUserId })
        }
      }
      await assert.rejects(backend.usage.reserveWorkspace({
        kind: 'agent',
        operationId: `${scope}_spoof`,
        payer: { ...payer, workspaceId: emptyWorkspace.workspace.id },
        requestFingerprint: `${scope}_spoof`,
        reservationId: `${scope}_spoof`,
        reservedCents: 1,
        userId: ownerUserId,
      }), /workspace_billing_account_mismatch/)
    })

    await t.test(`${backend.provider} removed members cannot resolve the workspace payer`, async () => {
      const invitation = await backend.workspaces.invite({
        actorUserId: ownerUserId,
        email: memberEmail,
        role: 'member',
        workspaceId: workspace.workspace.id,
      })
      const memberAccess = await backend.workspaces.acceptInvitation({
        email: memberEmail,
        invitationId: invitation.id,
        userId: memberUserId,
      })
      const resolver = new BillingPayerResolver({
        billing: backend.billing,
        workspaceWalletsEnabled: () => true,
        workspaces: backend.workspaces,
      })
      assert.equal((await resolver.resolve({ userId: memberUserId, workspaceId: workspace.workspace.id })).billingAccountId, account.billingAccountId)
      await backend.workspaces.removeMember({
        actorUserId: ownerUserId,
        principalId: memberAccess.principal.id,
        workspaceId: workspace.workspace.id,
      })
      await assert.rejects(
        resolver.resolve({ userId: memberUserId, workspaceId: workspace.workspace.id }),
        /not found|access|usable|denied/i,
      )
    })

    await t.test(`${backend.provider} allowance, top-up, cost, margin, and reconciliation remain observable`, async () => {
      const reservationId = `${scope}_margin`
      const reserved = await backend.usage.reserveWorkspace({
        kind: 'agent',
        operationId: reservationId,
        payer: {
          billingAccountId: account.billingAccountId,
          scope: 'workspace',
          subject: { id: 'shared_agent', kind: 'programmatic' },
          workspaceId: workspace.workspace.id,
        },
        requestFingerprint: reservationId,
        reservationId,
        reservedCents: 100,
        userId: ownerUserId,
      })
      assert.ok(reserved.ok)
      await backend.usage.finalize({
        actualCostCents: 80,
        events: [{
          costCents: 80,
          eventId: `${reservationId}_event`,
          kind: 'agent',
          occurredAt: Date.now(),
          providerCostUsd: 0.64,
        }],
        reservationId,
        userId: ownerUserId,
      })
      const entitlements = await backend.billing.getBillingAccountEntitlementsByServer({ billingAccountId: account.billingAccountId })
      assert.equal(entitlements?.allowanceUsedCents, 80)
      assert.equal(entitlements?.topUpBalanceCents, 800)
      const report = await backend.usage.getBillingAccountOperationalReport({
        billingAccountId: account.billingAccountId,
        periodStart: Date.now() - 60 * 60_000,
        reconciliationSlaMs: 15 * 60_000,
      })
      assert.ok(report.actualProviderCostCents >= 64)
      assert.ok(report.retailCredits >= 800)
      assert.equal(report.realizedMarginPercent, 20)
      assert.equal(report.costCoveragePercent, 100)
      assert.equal(report.staleReconciliationReservations, 0)
    })
  } finally {
    await backend.workspaces.archiveWorkspace({ actorUserId: ownerUserId, workspaceId: workspace.workspace.id }).catch((_error) => undefined)
    await backend.workspaces.archiveWorkspace({ actorUserId: ownerUserId, workspaceId: emptyWorkspace.workspace.id }).catch((_error) => undefined)
    await backend.cleanupWorkspace?.(workspace.workspace.id)
    await backend.cleanupWorkspace?.(emptyWorkspace.workspace.id)
    await backend.cleanupUser?.(memberUserId)
    await backend.cleanupUser?.(ownerUserId)
  }
}
