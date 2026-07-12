import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  ChatSuggestionRepository,
  ChatSuggestionSnapshot,
} from './ChatSuggestionRepository'

export class ConvexChatSuggestionRepository implements ChatSuggestionRepository {
  async getByUserId(userId: string): Promise<ChatSuggestionSnapshot | null> {
    return await convex.query<ChatSuggestionSnapshot | null>('auth/users:getChatStartersByServer', {
      serverSecret: getInternalApiSecret(),
      userId,
    })
  }

  async setForUser(args: ChatSuggestionSnapshot & { userId: string }): Promise<boolean> {
    const result = await convex.mutation<{ ok?: boolean }>('auth/users:setChatStartersByServer', {
      day: args.day,
      prompts: args.prompts,
      serverSecret: getInternalApiSecret(),
      userId: args.userId,
    })
    return result?.ok === true
  }
}
