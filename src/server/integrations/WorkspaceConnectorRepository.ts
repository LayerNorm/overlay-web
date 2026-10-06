import 'server-only'

export type WorkspaceConnectorRecord = {
  _id: string
  workspaceId: string
  userId: string
  providerKey: string
  connectedAccountId: string
  scope?: 'personal' | 'workspace'
  archivedAt?: number
  archivedFromScope?: 'personal' | 'workspace'
  createdAt: number
  updatedAt: number
}

export interface WorkspaceConnectorRepository {
  listByWorkspace(args: { workspaceId: string; userId: string }): Promise<WorkspaceConnectorRecord[]>
  /** One view of the connectors the caller may see: their own and those other members shared. Others' rows carry no account id. */
  listScopedByWorkspace(args: { workspaceId: string; userId: string; view?: 'personal' | 'workspace' | 'archived' }): Promise<Array<Omit<WorkspaceConnectorRecord, 'connectedAccountId'> & { connectedAccountId?: string }>>
  listByUser(args: { userId: string }): Promise<WorkspaceConnectorRecord[]>
  insert(args: { workspaceId: string; userId: string; providerKey: string; connectedAccountId: string }): Promise<string>
  remove(args: { workspaceId: string; providerKey: string; userId: string }): Promise<void>
  removeByUser(args: { userId: string }): Promise<number>
}
