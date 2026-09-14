import 'server-only'

import type { SurfaceBinding, SurfaceConnection, SurfacePlatform } from '@overlay/workspace-contracts'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Doc } from '../../../convex/_generated/dataModel'
import type { SurfaceRepository } from './SurfaceRepository'

type ConnectionDoc = Doc<'surfaceConnections'>
type BindingDoc = Doc<'surfaceBindings'>

export class ConvexSurfaceRepository implements SurfaceRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async upsertConnection(row: SurfaceConnection): Promise<SurfaceConnection> {
    const id = await convex.mutation<string>('surfaces/surfaces:upsertConnection', {
      serverSecret: this.serverSecret,
      id: row.id,
      workspaceId: row.workspaceId,
      platform: row.platform,
      externalTeamId: row.externalTeamId,
      externalTeamName: row.externalTeamName ?? undefined,
      externalEnterpriseId: row.externalEnterpriseId ?? undefined,
      botUserId: row.botUserId ?? undefined,
      status: row.status,
      installedByUserId: row.installedByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }, { throwOnError: true })
    if (!id) throw new Error('Failed to upsert surface connection')
    const connection = await this.getConnection(id)
    if (!connection) throw new Error('Failed to upsert surface connection')
    return connection
  }

  async getConnection(id: string): Promise<SurfaceConnection | null> {
    const doc = await convex.query<ConnectionDoc | null>('surfaces/surfaces:getConnection', {
      id,
      serverSecret: this.serverSecret,
    })
    return doc ? mapConnectionDoc(doc) : null
  }

  async findConnectionByTeam(
    platform: SurfacePlatform,
    externalTeamId: string,
  ): Promise<SurfaceConnection | null> {
    const doc = await convex.query<ConnectionDoc | null>('surfaces/surfaces:findConnectionByTeam', {
      platform,
      externalTeamId,
      serverSecret: this.serverSecret,
    })
    return doc ? mapConnectionDoc(doc) : null
  }

  async listConnections(workspaceId: string): Promise<SurfaceConnection[]> {
    const docs = await convex.query<ConnectionDoc[]>('surfaces/surfaces:listConnections', {
      workspaceId,
      serverSecret: this.serverSecret,
    })
    return (docs ?? []).map(mapConnectionDoc)
  }

  async updateConnection(id: string, patch: Partial<SurfaceConnection>): Promise<SurfaceConnection> {
    await convex.mutation('surfaces/surfaces:updateConnection', {
      id,
      serverSecret: this.serverSecret,
      externalTeamName: patch.externalTeamName ?? undefined,
      externalEnterpriseId: patch.externalEnterpriseId ?? undefined,
      botUserId: patch.botUserId ?? undefined,
      status: patch.status,
      updatedAt: patch.updatedAt ?? Date.now(),
    }, { throwOnError: true })
    const connection = await this.getConnection(id)
    if (!connection) throw new Error('Failed to update surface connection')
    return connection
  }

  async createBinding(row: SurfaceBinding): Promise<SurfaceBinding> {
    const id = await convex.mutation<string>('surfaces/surfaces:createBinding', {
      serverSecret: this.serverSecret,
      id: row.id,
      connectionId: row.connectionId,
      agentId: row.agentId,
      channelId: row.channelId,
      channelName: row.channelName ?? undefined,
      status: row.status,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }, { throwOnError: true })
    if (!id) throw new Error('Failed to create surface binding')
    const binding = await this.getBinding(id)
    if (!binding) throw new Error('Failed to create surface binding')
    return binding
  }

  async getBinding(id: string): Promise<SurfaceBinding | null> {
    const doc = await convex.query<BindingDoc | null>('surfaces/surfaces:getBinding', {
      id,
      serverSecret: this.serverSecret,
    })
    return doc ? mapBindingDoc(doc) : null
  }

  async findBindingByChannel(connectionId: string, channelId: string): Promise<SurfaceBinding | null> {
    const doc = await convex.query<BindingDoc | null>('surfaces/surfaces:findBindingByChannel', {
      connectionId,
      channelId,
      serverSecret: this.serverSecret,
    })
    return doc ? mapBindingDoc(doc) : null
  }

  async listBindingsByAgent(agentId: string): Promise<SurfaceBinding[]> {
    const docs = await convex.query<BindingDoc[]>('surfaces/surfaces:listBindingsByAgent', {
      agentId,
      serverSecret: this.serverSecret,
    })
    return (docs ?? []).map(mapBindingDoc)
  }

  async listBindingsByConnection(connectionId: string): Promise<SurfaceBinding[]> {
    const docs = await convex.query<BindingDoc[]>('surfaces/surfaces:listBindingsByConnection', {
      connectionId,
      serverSecret: this.serverSecret,
    })
    return (docs ?? []).map(mapBindingDoc)
  }

  async updateBinding(id: string, patch: Partial<SurfaceBinding>): Promise<SurfaceBinding> {
    await convex.mutation('surfaces/surfaces:updateBinding', {
      id,
      serverSecret: this.serverSecret,
      agentId: patch.agentId,
      channelName: patch.channelName ?? undefined,
      status: patch.status,
      createdByUserId: patch.createdByUserId,
      updatedAt: patch.updatedAt ?? Date.now(),
    }, { throwOnError: true })
    const binding = await this.getBinding(id)
    if (!binding) throw new Error('Failed to update surface binding')
    return binding
  }
}

function mapConnectionDoc(doc: ConnectionDoc): SurfaceConnection {
  return {
    id: doc.id,
    workspaceId: doc.workspaceId,
    platform: doc.platform,
    externalTeamId: doc.externalTeamId,
    externalTeamName: doc.externalTeamName ?? null,
    externalEnterpriseId: doc.externalEnterpriseId ?? null,
    botUserId: doc.botUserId ?? null,
    status: doc.status,
    installedByUserId: doc.installedByUserId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

function mapBindingDoc(doc: BindingDoc): SurfaceBinding {
  return {
    id: doc.id,
    connectionId: doc.connectionId,
    agentId: doc.agentId,
    channelId: doc.channelId,
    channelName: doc.channelName ?? null,
    status: doc.status,
    createdByUserId: doc.createdByUserId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}
