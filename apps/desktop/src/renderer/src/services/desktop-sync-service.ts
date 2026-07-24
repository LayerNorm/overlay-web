import type { Chat, Message } from '../components/chat'
import {
  deleteChat,
  loadAllChats,
  loadChat,
  upsertChatReplica,
  CHATS_CHANGED_EVENT
} from '../utils/chatStorage'
import {
  deleteProject,
  loadProjects,
  type Project,
  upsertProjectReplica,
  PROJECTS_CHANGED_EVENT
} from '../utils/projectStorage'
import { loadAuthSessionSecure, type AuthSession } from './auth-service'
import { desktopAppResponse } from './app-api-client'

const SYNC_STATE_KEY = 'overlay-desktop-sync-state-v1'
const DEFAULT_SYNC_INTERVAL_MS = 30_000
const MAX_SYNC_INTERVAL_MS = 5 * 60_000
const SYNC_STATUS_EVENT = 'overlay:sync-status'
const MEMORIES_CHANGED_EVENT = 'overlay:memories-changed'
const KNOWLEDGE_AUTHORITY_KEY = 'overlay-desktop-knowledge-authority-v1'

type SyncEntity = 'projects' | 'conversations' | 'notes' | 'memories'
type QueueAction = 'upsert' | 'delete'

interface SyncQueueItem {
  entity: SyncEntity
  action: QueueAction
  localId: string
  queuedAt: number
}

interface EntitySyncMeta {
  remoteId?: string
  syncedLocalUpdatedAt?: number
  lastKnownRemoteUpdatedAt?: number
  syncedTurnIds?: string[]
}

interface EntitySyncBucket {
  byLocalId: Record<string, EntitySyncMeta>
}

interface SyncWatermarks {
  projects: number
  conversations: number
  notes: number
  memories: number
}

interface SyncStatus {
  running: boolean
  backendHealthy: boolean
  lastSyncAttemptAt?: number
  lastSuccessfulSyncAt?: number
  consecutiveFailures: number
  nextIntervalMs: number
  lastError?: string
}

interface StoredSyncState {
  queue: SyncQueueItem[]
  buckets: Record<SyncEntity, EntitySyncBucket>
  watermarks: SyncWatermarks
  status: SyncStatus
}

interface LocalProjectSnapshot extends Project {
  updatedAt: number
}

interface LocalNoteSnapshot {
  id: string
  title: string
  content: string
  updatedAt: number
}

interface LocalMemorySnapshot {
  id: string
  content: string
  type: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  importance: number
  source: {
    chatId: string
    messageId?: string
    folderId?: string
    noteId?: string
  }
  createdAt: number
  updatedAt: number
}

type RemoteProject = {
  _id: string
  clientId?: string
  name: string
  instructions?: string
  parentId?: string | null
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

type RemoteConversation = {
  _id: string
  clientId?: string
  title: string
  projectId?: string
  askModelIds: string[]
  actModelId: string
  lastMode: 'ask' | 'act'
  lastModified: number
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

type RemoteConversationMessage = {
  id: string
  turnId: string
  mode: 'ask' | 'act'
  contentType: 'text' | 'image' | 'video'
  variantIndex?: number
  role: 'user' | 'assistant'
  parts?: Array<
    | { type: 'text' | 'file'; text?: string; url?: string; mediaType?: string }
    | {
        type: 'tool-invocation'
        toolInvocation: {
          toolCallId?: string
          toolName: string
          state?: string
          toolInput?: Record<string, unknown>
          toolOutput?: unknown
        }
      }
  >
  model?: string
}

type RemoteNote = {
  _id: string
  clientId?: string
  title: string
  content: string
  updatedAt: number
  createdAt: number
  deletedAt?: number
  projectId?: string
}

type RemoteMemory = {
  _id: string
  clientId?: string
  content: string
  source: 'chat' | 'note' | 'manual'
  type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  importance?: number
  projectId?: string
  conversationId?: string
  noteId?: string
  messageId?: string
  turnId?: string
  tags?: string[]
  actor?: 'user' | 'agent'
  status?: 'candidate' | 'approved' | 'rejected'
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

function defaultState(): StoredSyncState {
  return {
    queue: [],
    buckets: {
      projects: { byLocalId: {} },
      conversations: { byLocalId: {} },
      notes: { byLocalId: {} },
      memories: { byLocalId: {} }
    },
    watermarks: {
      projects: 0,
      conversations: 0,
      notes: 0,
      memories: 0
    },
    status: {
      running: false,
      backendHealthy: true,
      consecutiveFailures: 0,
      nextIntervalMs: DEFAULT_SYNC_INTERVAL_MS
    }
  }
}

function readState(): StoredSyncState {
  try {
    const raw = localStorage.getItem(SYNC_STATE_KEY)
    if (!raw) return defaultState()
    return {
      ...defaultState(),
      ...JSON.parse(raw)
    } as StoredSyncState
  } catch {
    return defaultState()
  }
}

function writeState(state: StoredSyncState): void {
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state))
}

function emitSyncStatus(status: SyncStatus): void {
  window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, { detail: status }))
}

function emitMemoriesChanged(): void {
  window.dispatchEvent(new CustomEvent(MEMORIES_CHANGED_EVENT))
}

function normalizeTextContent(message: Message): string {
  if (message.responses?.length) {
    const selected =
      message.responses.find((response) => response.modelId === message.selectedModelId) ??
      message.responses[0]
    return selected?.content || message.content || ''
  }

  const base = message.content?.trim()
  if (base) return base
  if (message.imageData || message.screenshots?.length) return '[Attached image]'
  return ''
}

function toRemoteConversationMessage(message: Message): {
  turnId: string
  role: 'user' | 'assistant'
  mode: 'ask' | 'act'
  content: string
  contentType: 'text' | 'image' | 'video'
  modelId?: string
  variantIndex?: number
  parts: Array<{ type: 'text'; text: string }>
} {
  const content = normalizeTextContent(message)
  return {
    turnId: message.id,
    role: message.role,
    mode: message.isAgentMessage ? 'act' : 'ask',
    content,
    contentType: 'text',
    modelId: message.selectedModelId,
    parts: [{ type: 'text', text: content }]
  }
}

function toLocalMessage(remote: RemoteConversationMessage, index: number): Message {
  const contentFromParts =
    remote.parts
      ?.filter((part) => part.type === 'text')
      .map((part) => ('text' in part ? part.text || '' : ''))
      .join('\n')
      .trim() || ''

  return {
    id: remote.turnId,
    role: remote.role,
    content: contentFromParts || '',
    timestamp: Date.now() + index,
    selectedModelId: remote.model,
    isAgentMessage: remote.mode === 'act' && remote.role === 'assistant'
  }
}

class DesktopSyncService {
  private started = false
  private timer: number | null = null
  private runningPromise: Promise<void> | null = null

  start(): void {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    this.keepLegacyConversationMethodsReferenced()

    window.addEventListener('online', this.handleOnline)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)

    // Authentication startup explicitly forces sync after the resumable
    // knowledge migration. Keeping the timer as a fallback avoids racing the
    // legacy note outbox against its first remote identity assignment.
    this.scheduleNext(DEFAULT_SYNC_INTERVAL_MS)
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    window.removeEventListener('online', this.handleOnline)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
  }

  getStatus(): SyncStatus {
    return readState().status
  }

  async syncNow(reason: string = 'manual'): Promise<void> {
    if (!this.started) return
    if (this.runningPromise) return this.runningPromise

    this.runningPromise = this.runSync(reason).finally(() => {
      this.runningPromise = null
    })

    return this.runningPromise
  }

  private readonly handleOnline = (): void => {
    void this.syncNow('online')
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      void this.syncNow('visible')
    }
  }

  private scheduleNext(intervalMs: number): void {
    if (!this.started) return
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
    }
    this.timer = window.setTimeout(() => {
      void this.syncNow('interval')
    }, intervalMs)
  }

  private keepLegacyConversationMethodsReferenced(): void {
    // Phase 1 keeps the old conversation sync code in place for rollback/reference,
    // but the cloud chat repository owns conversation persistence.
    void this.scanConversationChanges
    void this.pushConversationUpsert
    void this.pushConversationDelete
    void this.pullConversations
  }

  private updateStatus(updater: (status: SyncStatus) => SyncStatus): StoredSyncState {
    const state = readState()
    state.status = updater(state.status)
    writeState(state)
    emitSyncStatus(state.status)
    return state
  }

  private async runSync(reason: string): Promise<void> {
    let state = this.updateStatus((status) => ({
      ...status,
      running: true,
      lastSyncAttemptAt: Date.now()
    }))

    try {
      const session = await loadAuthSessionSecure()
      if (!session?.authenticated || !session.user?.id) {
        state.status = {
          ...state.status,
          running: false,
          backendHealthy: false,
          lastError: 'Not authenticated'
        }
        writeState(state)
        emitSyncStatus(state.status)
        this.scheduleNext(DEFAULT_SYNC_INTERVAL_MS)
        return
      }

      state = await this.scanLocalChanges(state)
      state = await this.pushQueue(state, session)
      state = await this.pullRemoteChanges(state, session)

      state.status = {
        ...state.status,
        running: false,
        backendHealthy: true,
        consecutiveFailures: 0,
        nextIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
        lastSuccessfulSyncAt: Date.now(),
        lastError: undefined
      }
      writeState(state)
      emitSyncStatus(state.status)
      this.scheduleNext(DEFAULT_SYNC_INTERVAL_MS)
    } catch (error) {
      const nextIntervalMs = Math.min(
        Math.max(state.status.nextIntervalMs * 2, DEFAULT_SYNC_INTERVAL_MS),
        MAX_SYNC_INTERVAL_MS
      )
      state.status = {
        ...state.status,
        running: false,
        backendHealthy: false,
        consecutiveFailures: state.status.consecutiveFailures + 1,
        nextIntervalMs,
        lastError: error instanceof Error ? error.message : String(error)
      }
      writeState(state)
      emitSyncStatus(state.status)
      this.scheduleNext(nextIntervalMs)
      console.error(`[DesktopSync] Sync failed during ${reason}:`, error)
    }
  }

  private queueOperation(state: StoredSyncState, item: SyncQueueItem): void {
    const existingIndex = state.queue.findIndex(
      (queued) => queued.entity === item.entity && queued.localId === item.localId
    )

    if (existingIndex >= 0) {
      const existing = state.queue[existingIndex]
      state.queue[existingIndex] = {
        ...item,
        action:
          item.action === 'delete' ? 'delete' : existing.action === 'delete' ? 'delete' : 'upsert'
      }
    } else {
      state.queue.push(item)
    }
  }

  private findLocalIdByRemoteId(bucket: EntitySyncBucket, remoteId: string): string | null {
    for (const [localId, meta] of Object.entries(bucket.byLocalId)) {
      if (meta.remoteId === remoteId) return localId
    }
    return null
  }

  private async scanLocalChanges(state: StoredSyncState): Promise<StoredSyncState> {
    this.scanProjectChanges(state)
    // Phase 1 cloud chat migration: conversations are cloud-authoritative through
    // chatStorage's web API repository, not this legacy local-first sync queue.
    if (localStorage.getItem(KNOWLEDGE_AUTHORITY_KEY) === 'cloud') {
      await this.scanNoteChanges(state)
    }
    await this.scanMemoryChanges(state)
    writeState(state)
    return state
  }

  private scanProjectChanges(state: StoredSyncState): void {
    const current = new Map<string, LocalProjectSnapshot>()
    for (const project of loadProjects()) {
      current.set(project.id, project)
      const meta = state.buckets.projects.byLocalId[project.id]
      if (!meta || project.updatedAt > (meta.syncedLocalUpdatedAt ?? 0)) {
        this.queueOperation(state, {
          entity: 'projects',
          action: 'upsert',
          localId: project.id,
          queuedAt: Date.now()
        })
      }
    }

    for (const localId of Object.keys(state.buckets.projects.byLocalId)) {
      if (!current.has(localId)) {
        this.queueOperation(state, {
          entity: 'projects',
          action: 'delete',
          localId,
          queuedAt: Date.now()
        })
      }
    }
  }

  private scanConversationChanges(state: StoredSyncState): void {
    const current = new Map<string, Chat>()
    for (const chat of loadAllChats()) {
      current.set(chat.id, chat)
      const meta = state.buckets.conversations.byLocalId[chat.id]
      if (!meta || chat.updatedAt > (meta.syncedLocalUpdatedAt ?? 0)) {
        this.queueOperation(state, {
          entity: 'conversations',
          action: 'upsert',
          localId: chat.id,
          queuedAt: Date.now()
        })
      }
    }

    for (const localId of Object.keys(state.buckets.conversations.byLocalId)) {
      if (!current.has(localId)) {
        this.queueOperation(state, {
          entity: 'conversations',
          action: 'delete',
          localId,
          queuedAt: Date.now()
        })
      }
    }
  }

  private async scanNoteChanges(state: StoredSyncState): Promise<void> {
    const current = new Map<string, LocalNoteSnapshot>()
    const noteMetas = (await window.bridge.loadNotes()) as Array<{
      id: string
      title: string
      updatedAt: number
    }>
    for (const meta of noteMetas) {
      const note = (await window.bridge.loadNote(meta.id)) as {
        title?: string
        content?: string
        updatedAt?: number
      } | null
      if (!note) continue
      current.set(meta.id, {
        id: meta.id,
        title: note.title || meta.title,
        content: note.content || '',
        updatedAt: note.updatedAt || meta.updatedAt
      })
      const syncMeta = state.buckets.notes.byLocalId[meta.id]
      if (!syncMeta || (note.updatedAt || meta.updatedAt) > (syncMeta.syncedLocalUpdatedAt ?? 0)) {
        this.queueOperation(state, {
          entity: 'notes',
          action: 'upsert',
          localId: meta.id,
          queuedAt: Date.now()
        })
      }
    }

    for (const localId of Object.keys(state.buckets.notes.byLocalId)) {
      if (!current.has(localId)) {
        this.queueOperation(state, {
          entity: 'notes',
          action: 'delete',
          localId,
          queuedAt: Date.now()
        })
      }
    }
  }

  private async scanMemoryChanges(state: StoredSyncState): Promise<void> {
    const current = new Map<string, LocalMemorySnapshot>()
    const memories = (await window.bridge.memory.getAll()) as Array<{
      id: string
      content: string
      type: LocalMemorySnapshot['type']
      importance: number
      source: { chatId: string; messageId?: string; folderId?: string; noteId?: string }
      createdAt: number
      updatedAt: number
      lastAccessedAt: number
    }>

    for (const memory of memories) {
      const updatedAt = memory.updatedAt || memory.lastAccessedAt || memory.createdAt
      current.set(memory.id, {
        ...memory,
        updatedAt
      })
      const meta = state.buckets.memories.byLocalId[memory.id]
      if (!meta || updatedAt > (meta.syncedLocalUpdatedAt ?? 0)) {
        this.queueOperation(state, {
          entity: 'memories',
          action: 'upsert',
          localId: memory.id,
          queuedAt: Date.now()
        })
      }
    }

    for (const localId of Object.keys(state.buckets.memories.byLocalId)) {
      if (!current.has(localId)) {
        this.queueOperation(state, {
          entity: 'memories',
          action: 'delete',
          localId,
          queuedAt: Date.now()
        })
      }
    }
  }

  private sortQueue(queue: SyncQueueItem[]): SyncQueueItem[] {
    const order: Record<SyncEntity, number> = {
      projects: 0,
      conversations: 1,
      notes: 2,
      memories: 3
    }
    return [...queue].sort((a, b) => {
      if (order[a.entity] !== order[b.entity]) return order[a.entity] - order[b.entity]
      if (a.action !== b.action) return a.action === 'upsert' ? -1 : 1
      return a.queuedAt - b.queuedAt
    })
  }

  private async pushQueue(state: StoredSyncState, session: AuthSession): Promise<StoredSyncState> {
    const remaining: SyncQueueItem[] = []

    for (const item of this.sortQueue(state.queue)) {
      try {
        await this.pushQueueItem(state, item, session)
      } catch (error) {
        remaining.push(item)
        throw error
      }
    }

    state.queue = remaining
    writeState(state)
    return state
  }

  private async pushQueueItem(
    state: StoredSyncState,
    item: SyncQueueItem,
    session: AuthSession
  ): Promise<void> {
    switch (item.entity) {
      case 'projects':
        if (item.action === 'delete') await this.pushProjectDelete(state, item.localId, session)
        else await this.pushProjectUpsert(state, item.localId, session)
        return
      case 'conversations':
        delete state.buckets.conversations.byLocalId[item.localId]
        return
      case 'notes':
        if (item.action === 'delete') await this.pushNoteDelete(state, item.localId, session)
        else await this.pushNoteUpsert(state, item.localId, session)
        return
      case 'memories':
        if (item.action === 'delete') await this.pushMemoryDelete(state, item.localId, session)
        else await this.pushMemoryUpsert(state, item.localId, session)
        return
    }
  }

  private async authenticatedFetch<T>(
    path: string,
    init: RequestInit,
    _session: AuthSession
  ): Promise<T> {
    const response = await desktopAppResponse(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    })
    return (await response.json()) as T
  }

  private async pushProjectUpsert(
    state: StoredSyncState,
    localId: string,
    session: AuthSession
  ): Promise<void> {
    const project = loadProjects().find((entry) => entry.id === localId)
    if (!project) return

    const meta = state.buckets.projects.byLocalId[localId] || {}
    const remoteParentId = project.parentId
      ? state.buckets.projects.byLocalId[project.parentId]?.remoteId
      : undefined

    if (meta.remoteId) {
      await this.authenticatedFetch(
        '/api/v1/projects',
        {
          method: 'PATCH',
          body: JSON.stringify({
            projectId: meta.remoteId,
            name: project.name,
            instructions: project.instructions,
            parentId: remoteParentId ?? null,
            userId: session.user.id
          })
        },
        session
      )
    } else {
      const created = await this.authenticatedFetch<{ id: string }>(
        '/api/v1/projects',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: localId,
            name: project.name,
            instructions: project.instructions,
            parentId: remoteParentId ?? null,
            userId: session.user.id
          })
        },
        session
      )
      meta.remoteId = created.id
    }

    meta.syncedLocalUpdatedAt = project.updatedAt
    state.buckets.projects.byLocalId[localId] = meta
  }

  private async pushProjectDelete(
    state: StoredSyncState,
    localId: string,
    session: AuthSession
  ): Promise<void> {
    const meta = state.buckets.projects.byLocalId[localId]
    if (!meta?.remoteId) {
      delete state.buckets.projects.byLocalId[localId]
      return
    }
    await this.authenticatedFetch(
      `/api/v1/projects?projectId=${encodeURIComponent(meta.remoteId)}`,
      { method: 'DELETE' },
      session
    )
    delete state.buckets.projects.byLocalId[localId]
  }

  private async pushConversationUpsert(
    state: StoredSyncState,
    localId: string,
    session: AuthSession
  ): Promise<void> {
    const chat = loadChat(localId)
    if (!chat) return

    const meta = state.buckets.conversations.byLocalId[localId] || {}
    const remoteProjectId = chat.folderId
      ? state.buckets.projects.byLocalId[chat.folderId]?.remoteId
      : undefined

    if (meta.remoteId) {
      await this.authenticatedFetch(
        '/api/v1/conversations',
        {
          method: 'PATCH',
          body: JSON.stringify({
            conversationId: meta.remoteId,
            title: chat.title,
            projectId: remoteProjectId ?? null,
            askModelIds: chat.modelId ? [chat.modelId] : undefined,
            actModelId: chat.modelId,
            lastMode: chat.isAgent ? 'act' : 'ask',
            userId: session.user.id
          })
        },
        session
      )
    } else {
      const created = await this.authenticatedFetch<{ id: string }>(
        '/api/v1/conversations',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: chat.id,
            title: chat.title,
            projectId: remoteProjectId ?? null,
            askModelIds: chat.modelId ? [chat.modelId] : undefined,
            actModelId: chat.modelId,
            lastMode: chat.isAgent ? 'act' : 'ask',
            userId: session.user.id
          })
        },
        session
      )
      meta.remoteId = created.id
    }

    const remoteConversationId = meta.remoteId
    if (!remoteConversationId) return

    const localTurnIds = new Set(chat.messages.map((message) => message.id))
    for (const turnId of meta.syncedTurnIds ?? []) {
      if (!localTurnIds.has(turnId)) {
        await this.authenticatedFetch(
          '/api/v1/conversations/message',
          {
            method: 'DELETE',
            body: JSON.stringify({
              conversationId: remoteConversationId,
              turnId,
              userId: session.user.id
            })
          },
          session
        )
      }
    }

    for (const message of chat.messages) {
      const remoteMessage = toRemoteConversationMessage(message)
      await this.authenticatedFetch(
        '/api/v1/conversations/message',
        {
          method: 'POST',
          body: JSON.stringify({
            conversationId: remoteConversationId,
            turnId: remoteMessage.turnId,
            role: remoteMessage.role,
            mode: remoteMessage.mode,
            content: remoteMessage.content,
            parts: remoteMessage.parts,
            modelId: remoteMessage.modelId,
            contentType: remoteMessage.contentType,
            variantIndex: remoteMessage.variantIndex,
            userId: session.user.id
          })
        },
        session
      )
    }

    meta.syncedLocalUpdatedAt = chat.updatedAt
    meta.syncedTurnIds = [...localTurnIds]
    state.buckets.conversations.byLocalId[localId] = meta
  }

  private async pushConversationDelete(
    state: StoredSyncState,
    localId: string,
    session: AuthSession
  ): Promise<void> {
    const meta = state.buckets.conversations.byLocalId[localId]
    if (!meta?.remoteId) {
      delete state.buckets.conversations.byLocalId[localId]
      return
    }
    await this.authenticatedFetch(
      `/api/v1/conversations?conversationId=${encodeURIComponent(meta.remoteId)}`,
      { method: 'DELETE' },
      session
    )
    delete state.buckets.conversations.byLocalId[localId]
  }

  private async pushNoteUpsert(
    state: StoredSyncState,
    localId: string,
    session: AuthSession
  ): Promise<void> {
    const note = (await window.bridge.loadNote(localId)) as {
      title?: string
      content?: string
      updatedAt?: number
    } | null
    if (!note) return

    const meta = state.buckets.notes.byLocalId[localId] || {}
    if (meta.remoteId) {
      await this.authenticatedFetch(
        '/api/v1/notes',
        {
          method: 'PATCH',
          body: JSON.stringify({
            noteId: meta.remoteId,
            title: note.title || 'Untitled',
            content: note.content || '',
            userId: session.user.id
          })
        },
        session
      )
    } else {
      const created = await this.authenticatedFetch<{ id: string }>(
        '/api/v1/notes',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: localId,
            title: note.title || 'Untitled',
            content: note.content || '',
            tags: [],
            userId: session.user.id
          })
        },
        session
      )
      meta.remoteId = created.id
    }

    meta.syncedLocalUpdatedAt = note.updatedAt || Date.now()
    state.buckets.notes.byLocalId[localId] = meta
  }

  private async pushNoteDelete(
    state: StoredSyncState,
    localId: string,
    session: AuthSession
  ): Promise<void> {
    const meta = state.buckets.notes.byLocalId[localId]
    if (!meta?.remoteId) {
      delete state.buckets.notes.byLocalId[localId]
      return
    }
    await this.authenticatedFetch(
      `/api/v1/notes?noteId=${encodeURIComponent(meta.remoteId)}`,
      { method: 'DELETE' },
      session
    )
    delete state.buckets.notes.byLocalId[localId]
  }

  private async pushMemoryUpsert(
    state: StoredSyncState,
    localId: string,
    session: AuthSession
  ): Promise<void> {
    const memories = (await window.bridge.memory.getAll()) as Array<{
      id: string
      content: string
      type: LocalMemorySnapshot['type']
      importance: number
      source: { chatId: string; messageId?: string; folderId?: string; noteId?: string }
      createdAt: number
      updatedAt: number
      lastAccessedAt: number
    }>
    const memory = memories.find((entry) => entry.id === localId)
    if (!memory) return

    const meta = state.buckets.memories.byLocalId[localId] || {}
    const remoteConversationId = memory.source.chatId
      ? state.buckets.conversations.byLocalId[memory.source.chatId]?.remoteId
      : undefined
    const remoteProjectId = memory.source.folderId
      ? state.buckets.projects.byLocalId[memory.source.folderId]?.remoteId
      : undefined

    if (meta.remoteId) {
      await this.authenticatedFetch(
        '/api/v1/memory',
        {
          method: 'PATCH',
          body: JSON.stringify({
            memoryId: meta.remoteId,
            content: memory.content,
            type: memory.type,
            importance: memory.importance,
            conversationId: remoteConversationId,
            projectId: remoteProjectId,
            messageId: memory.source.messageId,
            userId: session.user.id
          })
        },
        session
      )
    } else {
      const created = await this.authenticatedFetch<{ id: string }>(
        '/api/v1/memory',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: localId,
            content: memory.content,
            source: 'manual',
            type: memory.type,
            importance: memory.importance,
            conversationId: remoteConversationId,
            projectId: remoteProjectId,
            messageId: memory.source.messageId,
            userId: session.user.id
          })
        },
        session
      )
      meta.remoteId = created.id
    }

    meta.syncedLocalUpdatedAt = memory.updatedAt || memory.lastAccessedAt || memory.createdAt
    state.buckets.memories.byLocalId[localId] = meta
  }

  private async pushMemoryDelete(
    state: StoredSyncState,
    localId: string,
    session: AuthSession
  ): Promise<void> {
    const meta = state.buckets.memories.byLocalId[localId]
    if (!meta?.remoteId) {
      delete state.buckets.memories.byLocalId[localId]
      return
    }
    await this.authenticatedFetch(
      `/api/v1/memory?memoryId=${encodeURIComponent(meta.remoteId)}`,
      { method: 'DELETE' },
      session
    )
    delete state.buckets.memories.byLocalId[localId]
  }

  private async pullRemoteChanges(
    state: StoredSyncState,
    session: AuthSession
  ): Promise<StoredSyncState> {
    await this.pullProjects(state, session)
    // Conversations are hydrated directly by the cloud chat repository.
    if (localStorage.getItem(KNOWLEDGE_AUTHORITY_KEY) === 'cloud') {
      await this.pullNotes(state, session)
    }
    await this.pullMemories(state, session)
    writeState(state)
    return state
  }

  private async pullProjects(state: StoredSyncState, session: AuthSession): Promise<void> {
    const remoteProjects = await this.authenticatedFetch<RemoteProject[]>(
      `/api/v1/projects?updatedSince=${state.watermarks.projects}&includeDeleted=true`,
      { method: 'GET' },
      session
    )

    if (remoteProjects.length === 0) return

    const remoteToLocal = new Map<string, string>()
    for (const remote of remoteProjects) {
      const localId =
        remote.clientId ||
        this.findLocalIdByRemoteId(state.buckets.projects, remote._id) ||
        `project-remote-${remote._id}`
      remoteToLocal.set(remote._id, localId)
      state.buckets.projects.byLocalId[localId] = {
        ...state.buckets.projects.byLocalId[localId],
        remoteId: remote._id,
        lastKnownRemoteUpdatedAt: remote.updatedAt
      }
    }

    for (const remote of remoteProjects) {
      const localId = remoteToLocal.get(remote._id)!
      if (remote.deletedAt) {
        deleteProject(localId)
        delete state.buckets.projects.byLocalId[localId]
        continue
      }

      upsertProjectReplica({
        id: localId,
        name: remote.name,
        parentId: remote.parentId ? (remoteToLocal.get(remote.parentId) ?? null) : null,
        instructions: remote.instructions,
        createdAt: remote.createdAt,
        updatedAt: remote.updatedAt
      })
      state.buckets.projects.byLocalId[localId] = {
        ...state.buckets.projects.byLocalId[localId],
        remoteId: remote._id,
        syncedLocalUpdatedAt: remote.updatedAt,
        lastKnownRemoteUpdatedAt: remote.updatedAt
      }
    }

    state.watermarks.projects = Math.max(
      state.watermarks.projects,
      ...remoteProjects.map((project) => project.updatedAt)
    )
  }

  private async pullConversations(state: StoredSyncState, session: AuthSession): Promise<void> {
    const remoteConversations = await this.authenticatedFetch<RemoteConversation[]>(
      `/api/v1/conversations?updatedSince=${state.watermarks.conversations}&includeDeleted=true`,
      { method: 'GET' },
      session
    )

    for (const remote of remoteConversations) {
      const localId =
        remote.clientId ||
        this.findLocalIdByRemoteId(state.buckets.conversations, remote._id) ||
        `chat-remote-${remote._id}`

      if (remote.deletedAt) {
        deleteChat(localId)
        delete state.buckets.conversations.byLocalId[localId]
        continue
      }

      const messageResponse = await this.authenticatedFetch<{
        messages: RemoteConversationMessage[]
      }>(
        `/api/v1/conversations?conversationId=${encodeURIComponent(remote._id)}&messages=true`,
        { method: 'GET' },
        session
      )
      const localProjectId = remote.projectId
        ? this.findLocalIdByRemoteId(state.buckets.projects, remote.projectId)
        : null
      const existing = loadChat(localId)

      upsertChatReplica({
        id: localId,
        title: remote.title,
        createdAt: existing?.createdAt || remote.createdAt,
        updatedAt: remote.updatedAt,
        folderId: localProjectId || undefined,
        modelId: remote.actModelId || remote.askModelIds[0],
        isAgent: remote.lastMode === 'act',
        messages: (messageResponse.messages || []).map(toLocalMessage)
      })

      const localTurnIds = (messageResponse.messages || []).map((message) => message.turnId)
      state.buckets.conversations.byLocalId[localId] = {
        remoteId: remote._id,
        syncedLocalUpdatedAt: remote.updatedAt,
        lastKnownRemoteUpdatedAt: remote.updatedAt,
        syncedTurnIds: localTurnIds
      }
    }

    if (remoteConversations.length > 0) {
      state.watermarks.conversations = Math.max(
        state.watermarks.conversations,
        ...remoteConversations.map((conversation) => conversation.updatedAt)
      )
    }
  }

  private async pullNotes(state: StoredSyncState, session: AuthSession): Promise<void> {
    const remoteNotes = await this.authenticatedFetch<RemoteNote[]>(
      `/api/v1/notes?updatedSince=${state.watermarks.notes}&includeDeleted=true`,
      { method: 'GET' },
      session
    )

    for (const remote of remoteNotes) {
      const localId =
        remote.clientId ||
        this.findLocalIdByRemoteId(state.buckets.notes, remote._id) ||
        `note-remote-${remote._id}`

      if (remote.deletedAt) {
        await window.bridge.deleteNote(localId)
        delete state.buckets.notes.byLocalId[localId]
        continue
      }

      await window.bridge.saveNote({
        id: localId,
        title: remote.title,
        content: remote.content,
        updatedAt: remote.updatedAt
      })
      state.buckets.notes.byLocalId[localId] = {
        remoteId: remote._id,
        syncedLocalUpdatedAt: remote.updatedAt,
        lastKnownRemoteUpdatedAt: remote.updatedAt
      }
    }

    if (remoteNotes.length > 0) {
      state.watermarks.notes = Math.max(
        state.watermarks.notes,
        ...remoteNotes.map((note) => note.updatedAt)
      )
    }
  }

  private async pullMemories(state: StoredSyncState, session: AuthSession): Promise<void> {
    const remoteMemories = await this.authenticatedFetch<RemoteMemory[]>(
      `/api/v1/memory?raw=true&updatedSince=${state.watermarks.memories}&includeDeleted=true`,
      { method: 'GET' },
      session
    )

    const existingLocalIds = new Set(
      ((await window.bridge.memory.getAll()) as Array<{ id: string }>).map((memory) => memory.id)
    )

    for (const remote of remoteMemories) {
      const localId =
        remote.clientId ||
        this.findLocalIdByRemoteId(state.buckets.memories, remote._id) ||
        `memory-remote-${remote._id}`

      if (remote.deletedAt) {
        if (existingLocalIds.has(localId)) {
          await window.bridge.memory.delete(localId)
          existingLocalIds.delete(localId)
          delete state.buckets.memories.byLocalId[localId]
        }
        continue
      }

      const localChatId = remote.conversationId
        ? this.findLocalIdByRemoteId(state.buckets.conversations, remote.conversationId) || ''
        : ''
      const localFolderId = remote.projectId
        ? this.findLocalIdByRemoteId(state.buckets.projects, remote.projectId) || undefined
        : undefined

      if (!existingLocalIds.has(localId)) {
        await window.bridge.memory.add({
          id: localId,
          content: remote.content,
          type: remote.type || 'fact',
          importance: remote.importance ?? 0.5,
          source: {
            chatId: localChatId,
            messageId: remote.messageId,
            folderId: localFolderId,
            noteId: remote.noteId
          },
          sourceType: remote.source,
          chunk: false,
          createdAt: remote.createdAt,
          updatedAt: remote.updatedAt,
          lastAccessedAt: remote.updatedAt
        })
        existingLocalIds.add(localId)
      } else {
        await window.bridge.memory.update(localId, {
          content: remote.content,
          type: remote.type || 'fact',
          importance: remote.importance ?? 0.5,
          source: {
            chatId: localChatId,
            messageId: remote.messageId,
            folderId: localFolderId,
            noteId: remote.noteId
          },
          sourceType: remote.source,
          updatedAt: remote.updatedAt,
          lastAccessedAt: remote.updatedAt
        })
      }

      state.buckets.memories.byLocalId[localId] = {
        remoteId: remote._id,
        syncedLocalUpdatedAt: remote.updatedAt,
        lastKnownRemoteUpdatedAt: remote.updatedAt
      }
    }

    if (remoteMemories.length > 0) {
      state.watermarks.memories = Math.max(
        state.watermarks.memories,
        ...remoteMemories.map((memory) => memory.updatedAt)
      )
      emitMemoriesChanged()
    }
  }
}

let desktopSyncServiceInstance: DesktopSyncService | null = null

export function getDesktopSyncService(): DesktopSyncService {
  if (!desktopSyncServiceInstance) {
    desktopSyncServiceInstance = new DesktopSyncService()
  }
  return desktopSyncServiceInstance
}

export function initializeDesktopSync(): DesktopSyncService {
  const service = getDesktopSyncService()
  service.start()
  return service
}

export function forceDesktopSync(): Promise<void> {
  return getDesktopSyncService().syncNow('forced')
}

export function registerMigratedNoteMappings(
  mappings: Readonly<Record<string, { remoteId: string; updatedAt: number }>>
): void {
  const state = readState()
  for (const [localId, mapping] of Object.entries(mappings)) {
    state.buckets.notes.byLocalId[localId] = {
      ...state.buckets.notes.byLocalId[localId],
      remoteId: mapping.remoteId,
      syncedLocalUpdatedAt: mapping.updatedAt,
      lastKnownRemoteUpdatedAt: mapping.updatedAt
    }
  }
  writeState(state)
}

export function getRemoteIdForLocalNote(localId: string): string | undefined {
  return readState().buckets.notes.byLocalId[localId]?.remoteId
}

export function getLocalIdForRemoteNote(remoteId: string): string | undefined {
  const entries = Object.entries(readState().buckets.notes.byLocalId)
  return entries.find(([, metadata]) => metadata.remoteId === remoteId)?.[0]
}

export { CHATS_CHANGED_EVENT, MEMORIES_CHANGED_EVENT, PROJECTS_CHANGED_EVENT, SYNC_STATUS_EVENT }
