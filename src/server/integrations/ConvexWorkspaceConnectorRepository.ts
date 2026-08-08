import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { WorkspaceConnectorRecord, WorkspaceConnectorRepository } from './WorkspaceConnectorRepository'

export class ConvexWorkspaceConnectorRepository implements WorkspaceConnectorRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async listByWorkspace(args: { workspaceId: string; userId: string }): Promise<WorkspaceConnectorRecord[]> {
    return await convex.query<WorkspaceConnectorRecord[]>('integrations/workspaceConnectors:listByWorkspace', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async insert(args: { workspaceId: string; userId: string; providerKey: string; connectedAccountId: string }): Promise<string> {
    const id = await convex.mutation<string>('integrations/workspaceConnectors:insert', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!id) throw new Error('Convex workspaceConnectors insert returned no id')
    return id
  }

  async remove(args: { workspaceId: string; providerKey: string; userId: string }): Promise<void> {
    await convex.mutation('integrations/workspaceConnectors:remove', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async removeByUser(args: { userId: string }): Promise<number> {
    return await convex.mutation<number>('integrations/workspaceConnectors:removeByUser', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? 0
  }
}
