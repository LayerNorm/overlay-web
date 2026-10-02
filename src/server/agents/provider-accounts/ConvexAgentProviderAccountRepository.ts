import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { AgentProviderAccount } from '@/shared/agents/provider-accounts'
import type {
  AgentProviderAccountRecord,
  AgentProviderAccountRepository,
} from './AgentProviderAccountRepository'

export class ConvexAgentProviderAccountRepository implements AgentProviderAccountRepository {
  async listPublic(args: { userId: string }): Promise<AgentProviderAccount[]> {
    return (await convex.query<AgentProviderAccount[]>(
      'providers/agentAccounts:listPublicByServer',
      { serverSecret: getInternalApiSecret(), userId: args.userId },
      { throwOnError: true },
    )) ?? []
  }

  async get(args: { accountId: string }): Promise<AgentProviderAccountRecord | null> {
    return await convex.query<AgentProviderAccountRecord | null>(
      'providers/agentAccounts:getByServer',
      { serverSecret: getInternalApiSecret(), accountId: args.accountId },
      { throwOnError: true },
    )
  }

  async create(args: Parameters<AgentProviderAccountRepository['create']>[0]): Promise<string> {
    const id = await convex.mutation<string>(
      'providers/agentAccounts:createByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
    if (!id) throw new Error('Failed to create the account')
    return id
  }

  async update(args: Parameters<AgentProviderAccountRepository['update']>[0]): Promise<void> {
    await convex.mutation(
      'providers/agentAccounts:updateByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
  }

  async listCredentialRefs(args: { userId: string }): Promise<string[]> {
    return (await convex.query<string[]>(
      'providers/agentAccounts:listCredentialRefsByServer',
      { serverSecret: getInternalApiSecret(), userId: args.userId },
      { throwOnError: true },
    )) ?? []
  }

  async remove(args: { accountId: string }): Promise<void> {
    await convex.mutation(
      'providers/agentAccounts:deleteByServer',
      { serverSecret: getInternalApiSecret(), accountId: args.accountId },
      { throwOnError: true },
    )
  }
}
