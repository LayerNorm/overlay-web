import 'server-only'

export type WorkspaceConnectorRecord = {
  _id: string
  workspaceId: string
  userId: string
  providerKey: string
  connectedAccountId: string
  createdAt: number
  updatedAt: number
}

export interface WorkspaceConnectorRepository {
  listByWorkspace(args: { workspaceId: string; userId: string }): Promise<WorkspaceConnectorRecord[]>
  listByUser(args: { userId: string }): Promise<WorkspaceConnectorRecord[]>
  insert(args: { workspaceId: string; userId: string; providerKey: string; connectedAccountId: string }): Promise<string>
  remove(args: { workspaceId: string; providerKey: string; userId: string }): Promise<void>
  removeByUser(args: { userId: string }): Promise<number>
}
