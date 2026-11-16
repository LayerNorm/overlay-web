import 'server-only'

import type { ThreadWork } from '@/shared/agents/thread-work'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export type FolderCopyStatus = 'copying' | 'copied' | 'saving' | 'saved' | 'failed'

export type FolderCopyEntry = {
  path: string
  fileId: string
  parentId: string
  kind: 'note' | 'text' | 'binary'
  updatedAt: number
  sha256: string
}

export type FolderCopyRecord = {
  copyId: string
  agentRunId: string
  conversationId: string
  workspaceId: string
  userId: string
  agentId: string
  agentName?: string
  messageId?: string
  target: 'cloud' | 'mac'
  environmentId?: string
  folderId: string
  folderName: string
  root: string
  entries: FolderCopyEntry[]
  folders: Array<{ path: string; fileId: string }>
  skipped: string[]
  status: FolderCopyStatus
  summary?: unknown
  error?: string
  createdAt: number
}

export type FolderSubtreeRow = {
  id: string
  name: string
  type: 'file' | 'folder'
  kind?: string
  parentId: string
  mimeType?: string
  sizeBytes?: number
  updatedAt: number
  hasStorageObject: boolean
  textInObjectStore: boolean
}

export type FolderSubtree = {
  folder: { id: string; name: string; scope: 'personal' | 'workspace'; userId: string }
  rows: FolderSubtreeRow[]
  truncated: boolean
}

export interface ThreadWorkRepository {
  getWork(conversationId: string): Promise<ThreadWork | null>
  subtree(input: { userId: string; workspaceId: string; folderId: string }): Promise<FolderSubtree>
  startCopy(input: Omit<FolderCopyRecord, 'entries' | 'folders' | 'skipped' | 'status' | 'summary' | 'error' | 'createdAt'>): Promise<{ created: boolean; status: FolderCopyStatus }>
  listCopies(agentRunId: string): Promise<FolderCopyRecord[]>
  attachSummary(input: { conversationId: string; messageId: string; data: unknown }): Promise<void>
  updateCopy(input: {
    copyId: string
    expectedStatus?: FolderCopyStatus
    status: FolderCopyStatus
    entries?: FolderCopyEntry[]
    folders?: Array<{ path: string; fileId: string }>
    skipped?: string[]
    summary?: unknown
    error?: string
  }): Promise<{ updated: boolean; status: FolderCopyStatus }>
}

/** Async, so a missing server secret rejects like any other failure instead of throwing synchronously. */
const call = async <T>(kind: 'query' | 'mutation', name: string, args: Record<string, unknown>): Promise<T> =>
  await (convex[kind]<T>(name, { ...args, serverSecret: getInternalApiSecret() }, { throwOnError: true }) as Promise<T>)

export class ConvexThreadWorkRepository implements ThreadWorkRepository {
  getWork(conversationId: string) {
    return call<ThreadWork | null>('query', 'agents/threadWork:getByServer', { conversationId })
  }

  subtree(input: { userId: string; workspaceId: string; folderId: string }) {
    return call<FolderSubtree>('query', 'files/folderCopies:subtreeByServer', input)
  }

  startCopy(input: Parameters<ThreadWorkRepository['startCopy']>[0]) {
    return call<{ created: boolean; status: FolderCopyStatus }>('mutation', 'files/folderCopies:startByServer', input)
  }

  listCopies(agentRunId: string) {
    return call<FolderCopyRecord[]>('query', 'files/folderCopies:listForRunByServer', { agentRunId })
  }

  async attachSummary(input: { conversationId: string; messageId: string; data: unknown }) {
    await call<null>('mutation', 'files/folderCopies:attachSummaryByServer', input)
  }

  updateCopy(input: Parameters<ThreadWorkRepository['updateCopy']>[0]) {
    return call<{ updated: boolean; status: FolderCopyStatus }>('mutation', 'files/folderCopies:updateByServer', input)
  }
}
