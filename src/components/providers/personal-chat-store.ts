import type { OptimisticLocalStore } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import type { PersonalChatSummary } from './PersonalChatProvider'
import { insertPersonalChatRow, removePersonalChatRow, updatePersonalChatRow } from './personal-chat-optimistic'

export function updatePersonalChatList(
  store: OptimisticLocalStore,
  workspaceId: string,
  archived: boolean,
  conversationId: string,
  update: (row: PersonalChatSummary) => PersonalChatSummary,
) {
  for (const query of store.getAllQueries(api.chat.personal.list)) {
    if (query.value === undefined || query.args.workspaceId !== workspaceId || query.args.archived !== archived) continue
    store.setQuery(api.chat.personal.list, query.args, {
      ...query.value,
      page: updatePersonalChatRow(query.value.page, conversationId, update),
    })
  }
}

export function findPersonalChatSummary(
  store: OptimisticLocalStore,
  workspaceId: string,
  conversationId: string,
): PersonalChatSummary | undefined {
  for (const query of store.getAllQueries(api.chat.personal.list)) {
    if (query.args.workspaceId !== workspaceId || query.value === undefined) continue
    const summary = query.value.page.find((row) => row._id === conversationId)
    if (summary) return summary
  }
  return undefined
}

export function minimalSummary(summary: PersonalChatSummary): PersonalChatSummary {
  return {
    _id: summary._id,
    workspaceId: summary.workspaceId,
    createdAt: summary.createdAt,
    scope: summary.scope,
    conversationType: summary.conversationType,
    kind: summary.kind,
    title: summary.title,
    askModelIds: summary.askModelIds,
    actModelId: summary.actModelId,
    lastMode: summary.lastMode,
    lastModified: summary.lastModified,
    archivedAt: summary.archivedAt,
    lastMessageId: summary.lastMessageId,
    lastMessageAt: summary.lastMessageAt,
    unread: summary.unread,
    lastReadAt: summary.lastReadAt,
    markedUnreadAt: summary.markedUnreadAt,
  }
}

export function movePersonalChatRow(
  store: OptimisticLocalStore,
  workspaceId: string,
  conversationId: string,
  archived: boolean,
  summary: PersonalChatSummary | null,
) {
  for (const query of store.getAllQueries(api.chat.personal.list)) {
    if (query.value === undefined || query.args.workspaceId !== workspaceId) continue
    const isTargetList = query.args.archived === archived
    const pageHasRow = query.value.page.some((row) => row._id === conversationId)
    if (isTargetList && summary && query.args.paginationOpts.cursor === null) {
      store.setQuery(api.chat.personal.list, query.args, {
        ...query.value,
        page: insertPersonalChatRow(query.value.page, summary),
      })
    } else if (!isTargetList || pageHasRow) {
      store.setQuery(api.chat.personal.list, query.args, {
        ...query.value,
        page: removePersonalChatRow(query.value.page, conversationId),
      })
    }
  }
}

export function personalChatListStatus({ workspaceReady, authLoading, workspaceId, isAuthenticated }: {
  workspaceReady: boolean; authLoading: boolean; workspaceId: string | null; isAuthenticated: boolean
}): 'loading' | 'ready' | 'unavailable' {
  return !workspaceReady || authLoading
      ? 'loading'
      : !workspaceId
        ? 'unavailable'
      : isAuthenticated
        ? 'ready'
        : 'unavailable'
}
