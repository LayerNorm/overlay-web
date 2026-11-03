import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { BillingPayerResolutionError } from '@/server/billing/BillingPayerResolver'
import { GET } from './route'

const context = {
  auth: { userId: 'user_1' },
  workspace: { workspace: { id: 'workspace_1' } },
} as AppApiRouteContext

test('unfunded workspaces can discover model metadata within the deployment policy', async () => {
  const response = await GET(new NextRequest('https://example.test/api/v1/model-catalog'), context, {
    getEntitlements: async (args) => {
      assert.deepEqual(args, { userId: 'user_1', workspaceId: 'workspace_1' })
      throw new BillingPayerResolutionError('workspace_wallet_not_configured')
    },
    resolveCatalog: async ({ entitlements }) => {
      assert.equal(entitlements, null)
      return { chat: new Set(['allowed-model']), image: new Set(), video: new Set() }
    },
    getCatalog: async () => [
      { id: 'allowed-model', type: 'language' }, { id: 'excluded-model', type: 'language' },
    ] as never,
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { models: [{ id: 'allowed-model', type: 'language' }] })
})

test('catalog discovery does not hide authorization or inactive-account failures', async () => {
  for (const code of ['workspace_wallet_forbidden', 'billing_account_inactive'] as const) {
    await assert.rejects(GET(new NextRequest('https://example.test/api/v1/model-catalog'), context, {
      getEntitlements: async () => { throw new BillingPayerResolutionError(code) },
      resolveCatalog: async () => { assert.fail('must not resolve catalog') },
      getCatalog: async () => { assert.fail('must not read catalog') },
    }), (error: unknown) => error instanceof BillingPayerResolutionError && error.code === code)
  }
})
