import 'server-only'

export type MemorySource = 'chat' | 'note' | 'manual'
export type MemoryType = 'preference' | 'fact' | 'project' | 'decision' | 'agent'
export type MemoryActor = 'user' | 'agent'

export type MemoryRecord = {
  _id: string
  userId: string
  clientId?: string
  content: string
  source: MemorySource
  type?: MemoryType
  importance?: number
  projectId?: string
  conversationId?: string
  noteId?: string
  messageId?: string
  turnId?: string
  tags?: string[]
  actor?: MemoryActor
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
  projectId?: string
  source: MemorySource
  tags?: string[]
  turnId?: string
  type?: MemoryType
  userId: string
  workspaceId?: string
}

export interface MemoryRepository {
  get(args: { includeDeleted?: boolean; memoryId: string; userId: string }): Promise<MemoryRecord | null>
  list(args: {
    conversationId?: string
    includeDeleted?: boolean
    noteId?: string
    projectId?: string
    updatedSince?: number
    userId: string
    workspaceId?: string
  }): Promise<MemoryRecord[]>
  create(args: MemoryWrite): Promise<MemoryRecord>
  update(args: Omit<MemoryWrite, 'clientId' | 'userId'> & {
    memoryId: string
    userId: string
  }): Promise<MemoryRecord | null>
  remove(args: { memoryId: string; userId: string }): Promise<{ deletedAt: number; memoryId: string } | null>
}
