import 'server-only'

import type { SurfaceBinding, SurfaceConnection, SurfacePlatform } from '@overlay/workspace-contracts'

export interface SurfaceRepository {
  /** Insert-or-refresh keyed on (platform, externalTeamId). Never moves a connection between Overlay workspaces. */
  upsertConnection(row: SurfaceConnection): Promise<SurfaceConnection>
  getConnection(id: string): Promise<SurfaceConnection | null>
  findConnectionByTeam(platform: SurfacePlatform, externalTeamId: string): Promise<SurfaceConnection | null>
  listConnections(workspaceId: string): Promise<SurfaceConnection[]>
  updateConnection(id: string, patch: Partial<SurfaceConnection>): Promise<SurfaceConnection>
  /** One binding row per (connectionId, channelId); reactivates a removed row on re-bind. */
  createBinding(row: SurfaceBinding): Promise<SurfaceBinding>
  getBinding(id: string): Promise<SurfaceBinding | null>
  findBindingByChannel(connectionId: string, channelId: string): Promise<SurfaceBinding | null>
  listBindingsByAgent(agentId: string): Promise<SurfaceBinding[]>
  listBindingsByConnection(connectionId: string): Promise<SurfaceBinding[]>
  updateBinding(id: string, patch: Partial<SurfaceBinding>): Promise<SurfaceBinding>
}
