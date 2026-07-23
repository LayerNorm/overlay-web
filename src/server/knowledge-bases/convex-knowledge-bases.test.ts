import 'server-only'

import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createConvexKnowledgeBaseRepositories } from './ConvexKnowledgeBaseRepositories'
import { runKnowledgeBaseRepositoryContract } from './knowledge-base-repository-contract'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

const enabled = process.env.KNOWLEDGE_BASE_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('real Convex knowledge-base repository contract', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set KNOWLEDGE_BASE_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async (t) => {
  const scope = `kb_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_user`
  try {
    await runKnowledgeBaseRepositoryContract(t, {
      repositories: createConvexKnowledgeBaseRepositories(),
      scope,
      ownerUserId,
      conversationId: `${scope}_conversation`,
    })
  } finally {
    await convex.mutation('knowledge/bases:purgeOwnerDataByServer', {
      serverSecret: getInternalApiSecret(),
      ownerUserId,
    }, { throwOnError: true })
  }
})
