import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import type { AutomationRepository } from '@/server/automations/AutomationRepository'
import type { WebhookRepository } from '@/server/webhooks'

export type AutomationWebhookContractBackend = {
  automations: AutomationRepository
  cleanupUser?(userId: string): Promise<void>
  prepareUser?(userId: string): Promise<void>
  provider: 'convex' | 'postgres'
  webhooks: WebhookRepository
}

export async function runAutomationWebhookContract(
  t: TestContext,
  backend: AutomationWebhookContractBackend,
): Promise<void> {
  const userId = `p6_contract_${backend.provider}_${randomUUID()}`
  const foreignUserId = `p6_contract_foreign_${backend.provider}_${randomUUID()}`
  await backend.prepareUser?.(userId)
  await backend.prepareUser?.(foreignUserId)

  try {
    await t.test(`${backend.provider} automation CRUD and ownership`, async () => {
      const automationId = await backend.automations.createAutomation({
        concurrencyPolicy: 'queue',
        description: 'Provider-shared contract',
        enabled: false,
        instructions: 'Return a concise operational status.',
        name: 'P6 contract automation',
        schedule: { intervalMinutes: 30, kind: 'interval' },
        userId,
      })
      assert.equal((await backend.automations.listAutomations({ userId })).length, 1)
      assert.equal((await backend.automations.listAutomations({ userId: foreignUserId })).length, 0)
      assert.equal(await backend.automations.getAutomation({ automationId, userId: foreignUserId }), null)

      await backend.automations.updateAutomation({
        automationId,
        description: 'Updated provider-shared contract',
        name: 'Updated P6 contract automation',
        userId,
      })
      const updated = await backend.automations.getAutomation({ automationId, userId })
      assert.equal(updated?.name, 'Updated P6 contract automation')
      assert.equal(updated?.concurrencyPolicy, 'queue')
      assert.deepEqual(updated?.schedule, { intervalMinutes: 30, kind: 'interval' })

      const runId = await backend.automations.createManualRun({
        automationId,
        scheduledFor: Date.now(),
        userId,
      })
      assert.ok(runId)
      assert.equal(await backend.automations.requestRunCancellation({ runId: runId!, userId: foreignUserId }), false)
      assert.equal(await backend.automations.requestRunCancellation({ runId: runId!, userId }), true)
      const failedRunId = await backend.automations.createManualRun({
        automationId,
        scheduledFor: Date.now(),
        userId,
      })
      assert.ok(failedRunId)
      await backend.automations.markManualRunFailed({
        error: 'Expected provider contract failure',
        now: Date.now(),
        runId: failedRunId!,
        userId,
      })
      const retryRunId = await backend.automations.retryRun({ runId: failedRunId!, userId })
      assert.ok(retryRunId)
      const runs = await backend.automations.listRuns({ automationId, userId })
      assert.ok(runs.some((run) => run._id === runId))
      assert.ok(runs.some((run) => run._id === retryRunId))

      await backend.automations.removeAutomation({ automationId, userId })
      assert.equal(await backend.automations.getAutomation({ automationId, userId }), null)
    })

    await t.test(`${backend.provider} webhook CRUD, dedupe, and ownership`, async () => {
      const created = await backend.webhooks.create({
        description: 'P6 contract receiver',
        events: ['automation.finished'],
        url: 'https://hooks.example.test/overlay',
        userId,
      })
      assert.ok(created.id)
      assert.ok(created.secret)
      const listed = await backend.webhooks.list({ userId })
      assert.equal(listed.length, 1)
      assert.equal('secret' in listed[0]!, false)
      assert.equal(await backend.webhooks.update({
        enabled: false,
        subscriptionId: created.id,
        userId: foreignUserId,
      }), false)
      assert.equal(await backend.webhooks.rotateSecret({
        subscriptionId: created.id,
        userId: foreignUserId,
      }), null)
      const rotated = await backend.webhooks.rotateSecret({ subscriptionId: created.id, userId })
      assert.ok(rotated)
      assert.notEqual(rotated, created.secret)

      const event = {
        createdAt: Date.now(),
        data: { automationId: 'contract-automation' },
        id: `p6_contract_event_${randomUUID()}`,
        type: 'automation.finished' as const,
        userId,
      }
      assert.deepEqual(await backend.webhooks.dispatch({ event, userId }), { enqueued: 1 })
      assert.deepEqual(await backend.webhooks.dispatch({ event, userId }), { enqueued: 0 })
      const deliveries = await backend.webhooks.listDeliveries({
        subscriptionId: created.id,
        userId,
      })
      assert.equal(deliveries.length, 1)
      assert.equal(deliveries[0]?.eventId, event.id)
      assert.equal((await backend.webhooks.listDeliveries({ userId: foreignUserId })).length, 0)
      assert.equal(await backend.webhooks.redriveDelivery({
        deliveryId: deliveries[0]!._id,
        userId: foreignUserId,
      }), null)
      assert.equal(await backend.webhooks.remove({ subscriptionId: created.id, userId: foreignUserId }), false)
      assert.equal(await backend.webhooks.remove({ subscriptionId: created.id, userId }), true)
    })
  } finally {
    await backend.cleanupUser?.(userId)
    await backend.cleanupUser?.(foreignUserId)
  }
}
