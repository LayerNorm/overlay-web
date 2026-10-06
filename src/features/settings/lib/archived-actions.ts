import {
  EXTENSIONS_CHANGED_EVENT,
  KNOWLEDGE_RECONCILE_EVENT,
  AUTOMATIONS_UPDATED_EVENT,
  MCPS_CHANGED_EVENT,
  SKILLS_CHANGED_EVENT,
  automationHref,
  fileTreeRouteView,
  getAutomationDisplayName,
  type AutomationSummary,
  type FileTreeEntry,
  type McpServerSummary,
  type NoteDoc,
  type SkillSummary,
} from '@overlay/app-core'
import type { WorkspaceAgentDirectoryItem, WorkspaceArchivedAgentThread } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import { dispatchChatDeleted, dispatchChatModified } from '@/shared/chat/chat-title'
import {
  archivedItemKey,
  orderForDelete,
  type ArchivedCategory,
  type ArchivedItem,
  type BulkOutcome,
} from './archived-items'

const LIST_LIMIT = 100

type ScopedFields = { archivedFromScope?: 'personal' | 'workspace'; scope?: 'personal' | 'workspace'; archivedAt?: number }
const scopeOf = (row: ScopedFields) => row.archivedFromScope ?? row.scope ?? 'personal'
const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

type ArchivedConversationRow = {
  _id: string
  title?: string | null
  conversationType?: string
  archivedAt?: number
  lastModified?: number
}

export interface ArchivedLoadResult {
  items: ArchivedItem[]
  /** Sources that could not be read; the rest still show. */
  failed: ArchivedCategory[]
}

async function loadChats(): Promise<ArchivedItem[]> {
  const response = await fetch('/api/v1/conversations?archived=true', { cache: 'no-store', credentials: 'same-origin' })
  if (!response.ok) throw new Error('Could not load archived chats.')
  const body: unknown = await response.json()
  const rows = asArray<ArchivedConversationRow>(Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data)
  return rows.map((row) => ({
    key: archivedItemKey('chat', row._id),
    kind: 'chat' as const,
    category: 'chats' as const,
    id: row._id,
    name: row.title?.trim() || 'Untitled conversation',
    detail: row.conversationType === 'channel' ? 'Channel' : row.conversationType === 'dm' ? 'Direct message' : undefined,
    scope: null,
    archivedAt: row.archivedAt,
    conversationType: row.conversationType,
    href: `/app/archived?id=${encodeURIComponent(row._id)}`,
  }))
}

async function loadFiles(): Promise<ArchivedItem[]> {
  const [fileRows, noteRows] = await Promise.all([
    overlayAppClient.files.get<FileTreeEntry[]>({ limit: LIST_LIMIT, summary: true, view: 'archived' }),
    overlayAppClient.notes.get<NoteDoc[]>({ limit: LIST_LIMIT, view: 'archived' }),
  ])
  const files = asArray<FileTreeEntry & ScopedFields>(fileRows)
  const fileIds = new Set(files.map((file) => file._id))
  const notes = asArray<NoteDoc & ScopedFields>(noteRows).filter((note) => !fileIds.has(note._id))
  const all: Array<{ id: string; parentId?: string | null }> = [...files.map((f) => ({ id: f._id, parentId: f.parentId })), ...notes.map((n) => ({ id: n._id }))]
  const present = new Set(all.map((row) => row.id))
  return [
    ...files
      // A folder's contents are archived with it; list only the top of each archived subtree.
      .filter((file) => !file.parentId || !present.has(file.parentId))
      .map((file): ArchivedItem => {
        const isFolder = file.type === 'folder'
        const kind = isFolder ? 'folder' : fileTreeRouteView(file) === 'note' ? 'note' : 'file'
        return {
          key: archivedItemKey(kind, file._id),
          kind,
          category: 'files',
          id: file._id,
          name: file.name,
          scope: scopeOf(file),
          archivedAt: file.archivedAt,
        }
      }),
    ...notes.map((note): ArchivedItem => ({
      key: archivedItemKey('note', note._id),
      kind: 'note',
      category: 'files',
      id: note._id,
      name: note.title || 'Untitled',
      scope: scopeOf(note),
      archivedAt: note.archivedAt,
    })),
  ]
}

async function loadExtensions(): Promise<ArchivedItem[]> {
  const [skills, servers] = await Promise.all([
    overlayAppClient.skills.get<SkillSummary[]>({ limit: LIST_LIMIT, view: 'archived' }),
    overlayAppClient.mcpServers.get<McpServerSummary[]>({ limit: LIST_LIMIT, view: 'archived' }),
  ])
  return [
    ...asArray<SkillSummary>(skills).map((skill): ArchivedItem => ({
      key: archivedItemKey('skill', skill._id),
      kind: 'skill',
      category: 'extensions',
      id: skill._id,
      name: skill.name,
      detail: skill.description,
      scope: scopeOf(skill),
      archivedAt: skill.archivedAt,
    })),
    ...asArray<McpServerSummary>(servers).map((server): ArchivedItem => ({
      key: archivedItemKey('mcp-server', server._id),
      kind: 'mcp-server',
      category: 'extensions',
      id: server._id,
      name: server.name,
      detail: server.description,
      scope: scopeOf(server),
      archivedAt: server.archivedAt,
    })),
  ]
}

async function loadAutomations(): Promise<ArchivedItem[]> {
  const page = await overlayAppClient.automations.getPage<AutomationSummary>({ limit: LIST_LIMIT, view: 'archived' })
  return asArray<AutomationSummary>(page.data).map((automation) => ({
    key: archivedItemKey('automation', automation._id),
    kind: 'automation' as const,
    category: 'automations' as const,
    id: automation._id,
    name: getAutomationDisplayName(automation),
    scope: scopeOf(automation),
    archivedAt: automation.archivedAt,
    href: automationHref(automation),
  }))
}

/** Archived agents, and the threads archived on their own (an agent stays live when only a thread is archived). */
async function loadAgents(workspaceId: string): Promise<ArchivedItem[]> {
  const response = await overlayAppClient.agents.list(workspaceId, { includeArchived: true })
  const agents = asArray<WorkspaceAgentDirectoryItem>(response.agents)
  const threads = asArray<WorkspaceArchivedAgentThread>(response.archivedThreads)
  return [
    ...agents
      .filter((agent) => Boolean(agent.archivedAt))
      .map((agent): ArchivedItem => ({
        key: archivedItemKey('agent', agent.id),
        kind: 'agent',
        category: 'agents',
        id: agent.id,
        name: agent.name,
        detail: agent.description || undefined,
        scope: agent.visibility === 'creator' ? 'personal' : 'workspace',
        archivedAt: agent.archivedAt,
      })),
    ...threads.map((thread): ArchivedItem => ({
      key: archivedItemKey('agent-thread', thread.conversationId),
      kind: 'agent-thread',
      category: 'agents',
      id: thread.conversationId,
      name: thread.title,
      detail: `Thread with ${thread.agentName}${thread.agentArchived ? ' (archived)' : ''}`,
      scope: null,
      archivedAt: thread.archivedAt,
      agentId: thread.agentId,
      agentArchived: thread.agentArchived,
    })),
  ]
}

/** Everything the person has archived, from every source. A source that fails is reported; the others still show. */
export async function loadArchivedItems(workspaceId: string | null): Promise<ArchivedLoadResult> {
  const sources: Array<[ArchivedCategory, Promise<ArchivedItem[]>]> = [
    ['chats', loadChats()],
    ['files', loadFiles()],
    ['extensions', loadExtensions()],
    ['automations', loadAutomations()],
    ['agents', workspaceId ? loadAgents(workspaceId) : Promise.resolve([])],
  ]
  const settled = await Promise.allSettled(sources.map(([, promise]) => promise))
  const items: ArchivedItem[] = []
  const failed: ArchivedCategory[] = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') items.push(...result.value)
    else failed.push(sources[index]![0])
  })
  return { items, failed }
}

async function requireOk(response: Response, message: string): Promise<void> {
  if (!response.ok) throw new Error(message)
}

/** Puts one archived item back where it came from. The server decides who may; a refusal throws. */
export async function restoreArchivedItem(item: ArchivedItem, workspaceId: string | null): Promise<void> {
  switch (item.kind) {
    case 'chat':
      await overlayAppClient.conversations.updateParticipantState(item.id, { archived: false })
      dispatchChatModified({
        chat: {
          _id: item.id,
          title: item.name,
          lastModified: Date.now(),
          conversationType: item.conversationType === 'channel' || item.conversationType === 'dm' ? item.conversationType : 'personal',
        },
      })
      return
    case 'file':
    case 'folder':
    case 'note':
      await overlayAppClient.scope.restore('files', item.id)
      window.dispatchEvent(new Event(KNOWLEDGE_RECONCILE_EVENT))
      return
    case 'skill':
      await overlayAppClient.scope.restore('skills', item.id)
      window.dispatchEvent(new CustomEvent(SKILLS_CHANGED_EVENT))
      window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT))
      return
    case 'mcp-server':
      await overlayAppClient.scope.restore('mcp-servers', item.id)
      window.dispatchEvent(new CustomEvent(MCPS_CHANGED_EVENT))
      window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT))
      return
    case 'automation':
      await overlayAppClient.scope.restore('automations', item.id)
      window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
      return
    case 'agent':
      if (!workspaceId) throw new Error('No workspace')
      await overlayAppClient.agents.restore(workspaceId, item.id)
      dispatchAgentDirectoryChanged(workspaceId)
      return
    case 'agent-thread':
      // Only the thread: the agent's own state is not touched.
      if (!workspaceId || !item.agentId) throw new Error('No workspace')
      await overlayAppClient.agents.setThreadArchived(workspaceId, item.agentId, item.id, false)
      dispatchAgentDirectoryChanged(workspaceId)
      return
  }
}

/** Deletes one archived item for good. Only ever called on rows from the Archived list. */
export async function deleteArchivedItem(item: ArchivedItem, workspaceId: string | null): Promise<void> {
  switch (item.kind) {
    case 'chat':
      await deleteArchivedChat(item)
      dispatchChatDeleted({ chatId: item.id })
      return
    case 'file':
    case 'folder':
      await requireOk(await overlayAppClient.files.deleteResponse({ fileId: item.id }), 'File was not deleted')
      window.dispatchEvent(new Event(KNOWLEDGE_RECONCILE_EVENT))
      return
    case 'note':
      await requireOk(await overlayAppClient.notes.deleteResponse({ noteId: item.id }), 'Note was not deleted')
      window.dispatchEvent(new Event(KNOWLEDGE_RECONCILE_EVENT))
      return
    case 'skill':
      await requireOk(await overlayAppClient.skills.deleteResponse({ skillId: item.id }), 'Skill was not deleted')
      window.dispatchEvent(new CustomEvent(SKILLS_CHANGED_EVENT))
      window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT))
      return
    case 'mcp-server':
      await requireOk(await overlayAppClient.mcpServers.deleteResponse({ mcpServerId: item.id }), 'MCP server was not deleted')
      window.dispatchEvent(new CustomEvent(MCPS_CHANGED_EVENT))
      window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT))
      return
    case 'automation': {
      const response = await overlayAppClient.automations.deleteResponse({ automationId: item.id })
      await requireOk(response, 'Automation was not deleted')
      const payload = await overlayAppClient.automations.parseDeleteResponse(response).catch(() => ({} as { linkedConversationIds?: string[] }))
      for (const chatId of payload.linkedConversationIds ?? []) dispatchChatDeleted({ chatId })
      window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
      return
    }
    case 'agent':
      // Deletes the archived agent and its threads. A live agent has no row here, and the server refuses it.
      if (!workspaceId) throw new Error('No workspace')
      await overlayAppClient.agents.deleteArchived(workspaceId, item.id)
      dispatchAgentDirectoryChanged(workspaceId)
      return
    case 'agent-thread':
      // Only this thread. The agent keeps running, and starts a fresh thread the next time it is opened.
      if (!workspaceId || !item.agentId) throw new Error('No workspace')
      await overlayAppClient.agents.deleteThread(workspaceId, item.agentId, item.id)
      dispatchChatDeleted({ chatId: item.id })
      dispatchAgentDirectoryChanged(workspaceId)
      return
  }
}

/** Channels and direct messages are removed for this person only; other members keep them. */
async function deleteArchivedChat(item: ArchivedItem): Promise<void> {
  if (item.conversationType === 'channel' || item.conversationType === 'dm') {
    const { participants, currentPrincipalId } = await overlayAppClient.conversations.participants(item.id)
    // A room must keep one human: when this person is the only one left (imported Slack rooms), delete it outright.
    if (participants.length <= 1) {
      await requireOk(await overlayAppClient.conversations.deleteResponse({ conversationId: item.id, scope: 'self' }), 'Conversation was not deleted')
      return
    }
    const { removed } = await overlayAppClient.conversations.removeParticipant(item.id, currentPrincipalId)
    if (!removed) throw new Error('Conversation was not removed')
    return
  }
  await requireOk(await overlayAppClient.conversations.deleteResponse({ conversationId: item.id, scope: 'self' }), 'Conversation was not deleted')
}

const BULK_CONCURRENCY = 4

/**
 * Runs `act` over every item, a few at a time, and reports each result: one failure (someone else's item, say) never
 * stops the rest. Deletes go threads-first and agents last, so an agent's selected threads are gone before the agent is.
 */
export async function runBulkWith(
  items: readonly ArchivedItem[],
  mode: 'restore' | 'delete',
  act: (item: ArchivedItem) => Promise<void>,
): Promise<BulkOutcome> {
  const ordered = mode === 'delete' ? orderForDelete(items) : [...items]
  const outcome: BulkOutcome = { succeeded: [], failed: [] }
  const lastGroup = mode === 'delete' ? ordered.filter((item) => item.kind === 'agent') : []
  const firstGroup = ordered.filter((item) => !lastGroup.includes(item))
  for (const group of [firstGroup, lastGroup]) {
    let next = 0
    async function worker() {
      while (next < group.length) {
        const item = group[next++]!
        try {
          await act(item)
          outcome.succeeded.push(item.key)
        } catch (error) {
          outcome.failed.push({ key: item.key, message: error instanceof Error ? error.message : 'Failed' })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, group.length) }, worker))
  }
  return outcome
}

export function runBulk(items: readonly ArchivedItem[], mode: 'restore' | 'delete', workspaceId: string | null): Promise<BulkOutcome> {
  return runBulkWith(items, mode, (item) => (mode === 'delete' ? deleteArchivedItem(item, workspaceId) : restoreArchivedItem(item, workspaceId)))
}
