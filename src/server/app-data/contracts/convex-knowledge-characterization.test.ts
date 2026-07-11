import 'server-only'

import test from 'node:test'
import { AccountDeletionService } from '@/server/account'
import type { OverlayServerContext } from '@/server/bootstrap'
import { CONVEX_APP_DATA_CAPABILITIES } from '@/server/app-data/capabilities'
import { ConvexFileRepository } from '@/server/files/ConvexFileRepository'
import { ConvexKnowledgeSearchRepository } from '@/server/knowledge/ConvexKnowledgeSearchRepository'
import { ConvexMemoryRepository } from '@/server/memory/ConvexMemoryRepository'
import { ConvexProjectRepository } from '@/server/projects/ConvexProjectRepository'
import { ConvexUserRepository } from '@/server/users/ConvexUserRepository'
import { runKnowledgeCharacterizationContract } from './knowledge-characterization-contract'

const enabled = process.env.KNOWLEDGE_CHARACTERIZATION_CONVEX === '1'
const hasConvexUrl = Boolean(process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('Convex knowledge characterization', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set KNOWLEDGE_CHARACTERIZATION_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async (t) => {
  const search = new ConvexKnowledgeSearchRepository()
  await runKnowledgeCharacterizationContract(t, {
    awaitIndexed: async (fixture) => {
      const expected = new Set([
        fixture.sourceIds.globalFile,
        fixture.sourceIds.globalMemory,
        fixture.sourceIds.projectAFile,
        fixture.sourceIds.projectAMemory,
        fixture.sourceIds.projectBFile,
      ])
      const query = 'Cedar Lantern Silver Orchard Quartz Harbor Indigo Compass Crimson Delta'
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const result = await search.hybridSearch({ m: 20, query, userId: fixture.userId })
        const found = new Set(result.chunks.map((chunk) => chunk.sourceId))
        if ([...expected].every((sourceId) => found.has(sourceId))) return
        await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
      throw new Error('Convex characterization indexing did not become searchable within 60 seconds')
    },
    cleanupUser: deleteConvexUser,
    files: new ConvexFileRepository(),
    memories: new ConvexMemoryRepository(),
    name: 'convex',
    projects: new ConvexProjectRepository(),
    search,
    users: new ConvexUserRepository(),
  })
})

async function deleteConvexUser(userId: string): Promise<void> {
  await new AccountDeletionService({
    appDataCapabilities: CONVEX_APP_DATA_CAPABILITIES,
    auth: { deleteUser: async () => {} },
    billing: { cancelSubscription: async () => {} },
    objectStore: { deleteObject: async () => {} },
  } as unknown as OverlayServerContext).deleteAccount({ userId })
}
