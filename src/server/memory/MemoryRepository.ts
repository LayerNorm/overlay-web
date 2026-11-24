import 'server-only'

export type MemorySource = 'chat' | 'note' | 'manual'
export type MemoryType = 'preference' | 'fact' | 'project' | 'decision' | 'agent'
export type MemoryActor = 'user' | 'agent'

export type MemoryRecord = {
  _id: string
  userId: string
  workspaceId?: string
  clientId?: string
  content: string
  source: MemorySource
  type?: MemoryType
  importance?: number
  conversationId?: string
  noteId?: string
  messageId?: string
  turnId?: string
  tags?: string[]
  actor?: MemoryActor
  supersededBy?: string
  supersededAt?: number
  expiresAt?: number
  eventAt?: number
  visibility?: 'owner' | 'workspace'
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export type MemoryWrite = {
  actor?: MemoryActor
  clientId?: string
  content: string
  conversationId?: string
  importance?: number
  messageId?: string
  noteId?: string
  source: MemorySource
  tags?: string[]
  turnId?: string
  type?: MemoryType
  expiresAt?: number
  eventAt?: number
  visibility?: 'owner' | 'workspace'
  userId: string
  workspaceId?: string
}

export interface MemoryRepository {
  get(args: { includeDeleted?: boolean; memoryId: string; userId: string; workspaceId?: string }): Promise<MemoryRecord | null>
  list(args: {
    conversationId?: string
    creatorUserId?: string
    includeDeleted?: boolean
    noteId?: string
    scope?: 'owner' | 'workspace'
    updatedSince?: number
    userId: string
    workspaceId?: string
  }): Promise<MemoryRecord[]>
  create(args: MemoryWrite): Promise<MemoryRecord>
  update(args: Omit<MemoryWrite, 'clientId' | 'userId'> & {
    memoryId: string
    userId: string
    workspaceId?: string
  }): Promise<MemoryRecord | null>
  remove(args: { memoryId: string; userId: string; workspaceId?: string }): Promise<{ deletedAt: number; memoryId: string } | null>
  /** Freshness bump for a semantic-duplicate write — no reindex needed. */
  touch(args: { memoryId: string; userId: string; workspaceId?: string }): Promise<void>
}
