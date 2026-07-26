import 'server-only'

import test from 'node:test'
import { AccountDeletionService } from '@/server/account'
import type { AccountDeletionResult } from '@/server/account/AccountDeletionService'
import type { OverlayServerContext } from '@/server/bootstrap'
import { CONVEX_APP_DATA_CAPABILITIES } from '@/server/app-data/capabilities'
import { ConvexActConversationRepository } from '@/server/conversations/ConvexActConversationRepository'
import { BillingBackedActUsagePolicy } from '@/server/conversations/ActUsagePolicy'
import { ConvexFileRepository } from '@/server/files/ConvexFileRepository'
import { ConvexNoteRepository } from '@/server/notes'
import { ConvexProjectRepository } from '@/server/projects/ConvexProjectRepository'
import { ConvexUserRepository } from '@/server/users/ConvexUserRepository'
import { runAppDataRepositoryContractSuite } from './app-data-repository-contract'
import { ConvexChatSuggestionRepository } from '@/server/chat-suggestions/ConvexChatSuggestionRepository'
import { ConvexDaytonaWorkspaceRepository } from '@/server/ai/sandbox/ConvexDaytonaWorkspaceRepository'
import { ConvexMemoryRepository } from '@/server/memory/ConvexMemoryRepository'
import { createConvexKnowledgeBaseRepositories } from '@/server/knowledge-bases'

const enabled = process.env.APP_DATA_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('real Convex app-data repository contracts', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set APP_DATA_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET to run real Convex contracts',
}, async (t) => {
  const conversations = new ConvexActConversationRepository()

  await runAppDataRepositoryContractSuite(t, {
    name: 'convex',
    provider: 'convex',
    authProvider: 'workos',
    chatSuggestions: new ConvexChatSuggestionRepository(),
    conversations,
    daytonaWorkspaces: new ConvexDaytonaWorkspaceRepository(),
    deleteAccount: deleteConvexAccount,
    files: new ConvexFileRepository(),
    knowledgeBases: createConvexKnowledgeBaseRepositories(),
    memories: new ConvexMemoryRepository(),
    notes: new ConvexNoteRepository(),
    projects: new ConvexProjectRepository(),
    usagePolicy: new BillingBackedActUsagePolicy({ repository: conversations }),
    users: new ConvexUserRepository(),
  })
})

async function deleteConvexAccount(userId: string): Promise<AccountDeletionResult> {
  return await new AccountDeletionService({
    appDataCapabilities: CONVEX_APP_DATA_CAPABILITIES,
    auth: {
      deleteUser: async () => {},
    },
    billing: {
      cancelSubscription: async () => {},
    },
    objectStore: {
      deleteObject: async () => {},
    },
  } as unknown as OverlayServerContext).deleteAccount({ userId })
}
