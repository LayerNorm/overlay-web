import type { OptimisticLocalStore } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import type { NativeAgent } from './AgentDirectoryProvider'

type NativeAgentPage = { page: NativeAgent[]; continueCursor: string; isDone: boolean }

export function updateDirectoryLists(
  store: OptimisticLocalStore,
  workspaceId: string,
  update: (query: { args: { includeArchived?: boolean; paginationOpts: { cursor: string | null } } }, value: NativeAgentPage) => NativeAgentPage,
) {
  for (const query of store.getAllQueries(api.agents.nativeDirectory.list)) {
    if (query.value === undefined || query.args.workspaceId !== workspaceId) continue
    store.setQuery(api.agents.nativeDirectory.list, query.args, update(query, query.value))
  }
}

export function updateAgentCaches(
  store: OptimisticLocalStore,
  workspaceId: string,
  agentId: string,
  update: (agent: NativeAgent) => NativeAgent,
) {
  updateDirectoryLists(store, workspaceId, (query, value) => ({
    ...value,
    page: query.args.includeArchived
      ? value.page
      : value.page.map((agent) => agent.id === agentId ? update(agent) : agent),
  }))
  for (const query of store.getAllQueries(api.agents.nativeDirectory.get)) {
    if (query.value == null || query.args.workspaceId !== workspaceId || query.args.agentId !== agentId) continue
    store.setQuery(api.agents.nativeDirectory.get, query.args, update(query.value))
  }
}

export function restoreAgentCaches(store: OptimisticLocalStore, workspaceId: string, agentId: string) {
  let restoredAgent: NativeAgent | null = null
  for (const query of store.getAllQueries(api.agents.nativeDirectory.list)) {
    if (query.args.workspaceId !== workspaceId || !query.args.includeArchived || query.value === undefined) continue
    restoredAgent = query.value.page.find((agent) => agent.id === agentId) ?? restoredAgent
  }
  for (const query of store.getAllQueries(api.agents.nativeDirectory.get)) {
    if (query.args.workspaceId !== workspaceId || query.args.agentId !== agentId || !query.value) continue
    restoredAgent = query.value
  }
  if (!restoredAgent) return
  const restored = { ...restoredAgent }
  delete restored.archivedAt
  updateDirectoryLists(store, workspaceId, (query, value) => {
    if (query.args.includeArchived) {
      return { ...value, page: value.page.filter((agent) => agent.id !== agentId) }
    }
    if (query.args.paginationOpts.cursor !== null) return value
    return {
      ...value,
      page: [restored, ...value.page.filter((agent) => agent.id !== agentId)],
    }
  })
  for (const query of store.getAllQueries(api.agents.nativeDirectory.get)) {
    if (query.value === undefined || query.args.workspaceId !== workspaceId || query.args.agentId !== agentId) continue
    store.setQuery(api.agents.nativeDirectory.get, query.args, restored)
  }
}
