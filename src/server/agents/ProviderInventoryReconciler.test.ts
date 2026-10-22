import assert from 'node:assert/strict'
import test from 'node:test'
import type { SandboxRuntime } from '@overlay/sandbox-runtime'
import { ManagedSandboxError } from './managed-sandbox-runtime'
import { ProviderInventoryReconciler } from './ProviderInventoryReconciler'

test('reports only old unowned live machines and marks remaining pages as truncated', async () => {
  const now = 1_800_000_000_000
  const requests: Array<{ cursor?: string; limit: number }> = []
  const warnings: Array<{ message: string; properties: Record<string, unknown> }> = []
  const runtime = {
    provider: 'box',
    listInventory: async (args: { cursor?: string; limit: number }) => {
      requests.push(args)
      return {
        items: [
          { reference: 'old-unowned', state: 'running', createdAt: now - 30 * 60_000, monthCostCents: 175 },
          { reference: 'old-known', state: 'ready', createdAt: now - 25 * 60_000 },
          { reference: 'young', state: 'running', createdAt: now - 5 * 60_000 },
          { reference: 'paused', state: 'paused', createdAt: now - 40 * 60_000 },
          { reference: 'archived', state: 'archived', createdAt: now - 50 * 60_000 },
          { reference: 'stopped', state: 'stopped', createdAt: now - 50 * 60_000 },
        ],
        nextCursor: 'next-page',
      }
    },
  } as unknown as SandboxRuntime
  const reconciler = new ProviderInventoryReconciler({
    runtime: () => runtime,
    listKnownReferences: async ({ provider, references }) => {
      assert.equal(provider, 'box')
      assert.deepEqual(references, ['old-unowned', 'old-known'])
      return ['old-known']
    },
    now: () => now,
    warn: (message, properties) => warnings.push({ message, properties }),
  })

  const result = await reconciler.reconcile({ maxPages: 1, pageSize: 200, graceMs: 15 * 60_000 })
  assert.deepEqual(result, {
    scanned: 6,
    live: 3,
    unowned: [{ reference: 'old-unowned', state: 'running', ageMinutes: 30, monthCostCents: 175 }],
    truncated: true,
  })
  assert.deepEqual(requests, [{ limit: 200 }])
  assert.deepEqual(warnings, [{
    message: '[sandbox-inventory] unowned provider machines',
    properties: { provider: 'box', count: 1, references: ['old-unowned'] },
  }])
})

test('disables inventory when provider configuration is missing or listing is unsupported', async () => {
  const missingProvider = new ProviderInventoryReconciler({
    runtime: () => { throw new ManagedSandboxError('not configured', 503, 'managed_sandbox_provider_invalid') },
  })
  assert.deepEqual(await missingProvider.reconcile(), { disabled: true })

  const unsupported = new ProviderInventoryReconciler({
    runtime: () => ({ provider: 'box' }) as SandboxRuntime,
  })
  assert.deepEqual(await unsupported.reconcile(), { disabled: true })
})
