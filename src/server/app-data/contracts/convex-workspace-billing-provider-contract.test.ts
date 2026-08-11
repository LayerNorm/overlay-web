import 'server-only'

import test from 'node:test'
import { ConvexBillingRepository } from '@/server/billing/ConvexBillingRepository'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ConvexUsageRepository } from '@/server/usage/ConvexUsageRepository'
import { ConvexWorkspaceRepository } from '@/server/workspaces/ConvexWorkspaceRepository'
import { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import { runWorkspaceBillingProviderContract } from './workspace-billing-provider-contract'

const enabled = process.env.APP_DATA_CONTRACT_CONVEX === '1'
const configured = Boolean(process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL)
  && Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('real Convex workspace billing provider contract', {
  skip: enabled && configured ? false : 'Set APP_DATA_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async (t) => {
  await runWorkspaceBillingProviderContract(t, {
    billing: new ConvexBillingRepository(),
    cleanupUser: async (userId) => {
      await convex.mutation('auth/users:deleteUserAccountByServer', {
        serverSecret: getInternalApiSecret(),
        userId,
      }, { throwOnError: true })
    },
    provider: 'convex',
    usage: new ConvexUsageRepository(),
    workspaces: new WorkspaceService(new ConvexWorkspaceRepository()),
  })
})
