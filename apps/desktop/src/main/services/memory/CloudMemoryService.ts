import { app } from 'electron'
import { keyCacheService } from '../key-cache-service'
import { safeStorageService } from '../security/safe-storage-service'

export type MemoryType = 'preference' | 'fact' | 'project' | 'decision' | 'agent' | 'conversation'

export interface AddMemoryOptions {
  id?: string
  content: string
  type?: MemoryType
  source?: string
  chatId?: string
  folderId?: string
  noteId?: string
  messageId?: string
  tags?: string[]
  importance?: number
  actor?: 'user' | 'agent'
  createdAt?: number
  updatedAt?: number
  lastAccessedAt?: number
  accessCount?: number
  chunk?: boolean
}

export interface MemorySearchResult {
  id: string
  content: string
  type: MemoryType
  importance: number
  score: number
  source: string
  chatId?: string
  folderId?: string
  noteId?: string
  messageId?: string
  createdAt: number
  updatedAt: number
  accessCount: number
  lastAccessedAt: number
  actor?: 'user' | 'agent'
  status?: 'candidate' | 'approved' | 'rejected'
  taskFingerprint?: string
  sourceTaskId?: string
}

type AppMemoryRow = {
  _id?: string
  id?: string
  memoryId?: string
  content: string
  source?: string
  type?: Exclude<MemoryType, 'conversation'>
  importance?: number
  projectId?: string
  conversationId?: string
  noteId?: string
  messageId?: string
  turnId?: string
  tags?: string[]
  actor?: 'user' | 'agent'
  createdAt?: number
  updatedAt?: number
  deletedAt?: number
}

export type KnowledgeSearchChunk = {
  text?: string
  sourceKind?: 'file' | 'memory'
  sourceId?: string
  title?: string
  score?: number
}

const APP_API_BASE_URL = (
  process.env.APP_SERVER_URL?.trim() ||
  (app.isPackaged ? 'https://www.getoverlay.io' : 'http://localhost:3000')
).replace(/\/$/, '')
const PRODUCTION_APP_API_BASE_URL = 'https://www.getoverlay.io'

function appApiBaseUrlCandidates(): string[] {
  const candidates = [APP_API_BASE_URL]
  if (isLocalBaseUrl(APP_API_BASE_URL)) candidates.push(PRODUCTION_APP_API_BASE_URL)
  return Array.from(new Set(candidates))
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

function normalizeSource(source?: string): 'chat' | 'note' | 'manual' {
  return source === 'chat' || source === 'note' || source === 'manual' ? source : 'manual'
}

function normalizeImportance(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3
  if (value <= 1) return Math.max(1, Math.round(value * 5))
  return Math.max(1, Math.min(5, Math.round(value)))
}

function mapMemoryRow(row: AppMemoryRow, score = 1): MemorySearchResult {
  const now = Date.now()
  return {
    id: row.memoryId || row._id || row.id || '',
    content: row.content,
    type: row.type || 'fact',
    importance: normalizeImportance(row.importance),
    score,
    source: row.source || 'manual',
    chatId: row.conversationId,
    folderId: row.projectId,
    noteId: row.noteId,
    messageId: row.messageId,
    createdAt: row.createdAt || now,
    updatedAt: row.updatedAt || row.createdAt || now,
    accessCount: 0,
    lastAccessedAt: row.updatedAt || row.createdAt || now,
    actor: row.actor
  }
}

export class CloudMemoryService {
  async initialize(): Promise<void> {
    // Remote memory uses the app API / Convex and does not maintain a local vector index.
  }

  isReady(): boolean {
    const session = safeStorageService.getAuthSession()
    return Boolean(session?.user?.id && (keyCacheService.getAccessToken() || session.accessToken))
  }

  async search(query: string, limit = 10): Promise<MemorySearchResult[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    const response = await this.searchKnowledge(trimmed, {
      sourceKind: 'memory',
      limit
    })

    const chunks = response.filter((chunk) => chunk.sourceKind === 'memory')
    return Promise.all(
      chunks.slice(0, limit).map(async (chunk) => {
        const row = chunk.sourceId
          ? await this.getMemoryRow(chunk.sourceId).catch(() => null)
          : null
        return mapMemoryRow(
          row || {
            _id: chunk.sourceId,
            memoryId: chunk.sourceId,
            content: chunk.text || '',
            source: 'chat',
            type: 'fact'
          },
          chunk.score ?? 1
        )
      })
    )
  }

  async searchKnowledge(
    query: string,
    options: {
      sourceKind?: 'file' | 'memory'
      projectId?: string
      limit?: number
    } = {}
  ): Promise<KnowledgeSearchChunk[]> {
    const limit = options.limit ?? 10
    const response = await this.appApi<{ chunks?: KnowledgeSearchChunk[] }>(
      '/api/v1/knowledge/search',
      {
        method: 'POST',
        body: JSON.stringify({
          query: query.trim().slice(0, 500),
          projectId: options.projectId,
          sourceKind: options.sourceKind,
          m: limit,
          kVec: Math.max(limit * 4, 20),
          kLex: Math.max(limit * 4, 20)
        })
      }
    )
    return response.chunks || []
  }

  async addMemory(options: AddMemoryOptions): Promise<string[]> {
    const response = await this.appApi<{ id?: string; ids?: string[] }>('/api/v1/memory', {
      method: 'POST',
      body: JSON.stringify({
        clientId: options.id,
        content: options.content,
        source: normalizeSource(options.source),
        type: options.type === 'conversation' ? 'fact' : options.type,
        importance: options.importance,
        projectId: options.folderId,
        conversationId: options.chatId,
        noteId: options.noteId,
        messageId: options.messageId,
        tags: options.tags,
        actor: options.actor
      })
    })
    return response.ids?.length ? response.ids : response.id ? [response.id] : []
  }

  async updateMemory(
    id: string,
    updates: {
      content?: string
      type?: MemoryType
      importance?: number
      tags?: string[]
      source?: string
      chatId?: string
      folderId?: string
      noteId?: string
      messageId?: string
      updatedAt?: number
      lastAccessedAt?: number
      accessCount?: number
    }
  ): Promise<boolean> {
    if (!updates.content?.trim()) return false
    await this.appApi('/api/v1/memory', {
      method: 'PATCH',
      body: JSON.stringify({
        memoryId: id,
        content: updates.content,
        source: normalizeSource(updates.source),
        type: updates.type === 'conversation' ? 'fact' : updates.type,
        importance: updates.importance,
        projectId: updates.folderId,
        conversationId: updates.chatId,
        noteId: updates.noteId,
        messageId: updates.messageId,
        tags: updates.tags
      })
    })
    return true
  }

  async deleteMemory(id: string): Promise<boolean> {
    await this.appApi('/api/v1/memory', {
      method: 'DELETE',
      body: JSON.stringify({ memoryId: id })
    })
    return true
  }

  async deleteMemories(ids: string[]): Promise<number> {
    let deleted = 0
    for (const id of ids) {
      if (await this.deleteMemory(id).catch(() => false)) deleted++
    }
    return deleted
  }

  async getByChat(chatId: string): Promise<MemorySearchResult[]> {
    return this.list(`/api/v1/memory?raw=true&conversationId=${encodeURIComponent(chatId)}`)
  }

  async getByFolder(folderId: string): Promise<MemorySearchResult[]> {
    return this.list(`/api/v1/memory?raw=true&projectId=${encodeURIComponent(folderId)}`)
  }

  async getAll(): Promise<MemorySearchResult[]> {
    return this.list('/api/v1/memory?raw=true')
  }

  private async getMemoryRow(memoryId: string): Promise<AppMemoryRow | null> {
    return await this.appApi<AppMemoryRow>(
      `/api/v1/memory?raw=true&memoryId=${encodeURIComponent(memoryId)}`,
      { method: 'GET' }
    )
  }

  async getStats(): Promise<{
    total: number
    byType: Record<string, number>
    recentlyAccessed: number
  }> {
    const memories = await this.getAll()
    const byType: Record<string, number> = {}
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    let recentlyAccessed = 0
    for (const memory of memories) {
      byType[memory.type] = (byType[memory.type] || 0) + 1
      if (memory.updatedAt >= weekAgo) recentlyAccessed++
    }
    return { total: memories.length, byType, recentlyAccessed }
  }

  private async list(path: string): Promise<MemorySearchResult[]> {
    const rows = await this.appApi<AppMemoryRow[]>(path, { method: 'GET' })
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => !row.deletedAt)
      .map((row) => mapMemoryRow(row))
  }

  private async appApi<T = unknown>(
    path: string,
    init: { method?: string; body?: string | null; headers?: Record<string, string> } = {}
  ): Promise<T> {
    const session = safeStorageService.getAuthSession()
    const userId = session?.user?.id?.trim()
    let accessToken = keyCacheService.getAccessToken() || session?.accessToken?.trim() || null

    if (!userId || !accessToken) {
      throw new Error('Not authenticated')
    }

    let response = await this.fetchAppApi(path, init, accessToken, userId)
    if (response.status === 401 && (await keyCacheService.refreshAccessTokenIfPossible())) {
      accessToken =
        keyCacheService.getAccessToken() || safeStorageService.getAuthSession()?.accessToken || null
      if (accessToken) {
        response = await this.fetchAppApi(path, init, accessToken, userId)
      }
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        body || response.statusText || `App API request failed with ${response.status}`
      )
    }

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  private async fetchAppApi(
    path: string,
    init: { method?: string; body?: string | null; headers?: Record<string, string> },
    accessToken: string,
    userId: string
  ): Promise<Response> {
    let lastError: unknown = null
    for (const baseUrl of appApiBaseUrlCandidates()) {
      try {
        const url = new URL(path, baseUrl)
        if (!url.searchParams.get('userId')) url.searchParams.set('userId', userId)
        const headers = new Headers(init.headers || {})
        if (init.body && !headers.has('Content-Type'))
          headers.set('Content-Type', 'application/json')
        headers.set('Authorization', `Bearer ${accessToken}`)
        return await fetch(url, {
          method: init.method || 'GET',
          headers,
          body: init.method === 'GET' ? undefined : init.body
        })
      } catch (error) {
        lastError = error
        if (!app.isPackaged) continue
      }
    }
    throw lastError instanceof Error ? lastError : new Error('App API request failed')
  }
}

let cloudMemoryServiceInstance: CloudMemoryService | null = null

export function getCloudMemoryService(): CloudMemoryService {
  if (!cloudMemoryServiceInstance) {
    cloudMemoryServiceInstance = new CloudMemoryService()
  }
  return cloudMemoryServiceInstance
}
