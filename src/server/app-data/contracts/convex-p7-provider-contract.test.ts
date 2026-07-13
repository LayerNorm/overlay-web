import 'server-only'

import test from 'node:test'
import { ConvexAdministrativeRepository, ConvexAuditRepository } from '@/server/admin'
import { ConvexApiKeyRepository } from '@/server/auth/api-keys'
import { ConvexBillingProviderEventRepository } from '@/server/billing/ConvexBillingProviderEventRepository'
import { ConvexBillingRepository } from '@/server/billing/ConvexBillingRepository'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { ConvexProjectRepository } from '@/server/projects/ConvexProjectRepository'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ConvexUsageRepository } from '@/server/usage/ConvexUsageRepository'
import { runP7ProviderContract } from './p7-provider-contract'

const enabled = process.env.APP_DATA_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('real Convex P7 provider contract', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set APP_DATA_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async (t) => {
  const billing = new ConvexBillingRepository()
  await runP7ProviderContract(t, {
    administration: new ConvexAdministrativeRepository(),
    apiKeys: new ConvexApiKeyRepository(),
    audit: new ConvexAuditRepository(),
    billing,
    billingEvents: new ConvexBillingProviderEventRepository(),
    cleanupUser: deleteUser,
    deleteUser,
    projects: new ConvexProjectRepository(),
    provider: 'convex',
    usage: new ConvexUsageRepository(),
  })
})

async function deleteUser(userId: string): Promise<void> {
  await convex.mutation('auth/users:deleteUserAccountByServer', {
    serverSecret: getInternalApiSecret(),
    userId,
  }, { throwOnError: true })
}
