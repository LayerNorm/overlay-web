'use client'

import { useMemo } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'
import type { AutomationSummary, FileTreeEntry, McpServerSummary, SkillSummary, WorkItem } from '@overlay/app-core'
import type { WorkspaceAgentDirectoryItem, WorkspaceArchivedAgentThread } from '@overlay/workspace-contracts'
import { api } from '../../../../convex/_generated/api'
import {
  archivedAgents,
  archivedAutomations,
  archivedExtensions,
  archivedFiles,
  archivedRooms,
  archivedWork,
  type ArchivedConversationRow,
} from './archived-actions'
import type { ArchivedCategory, ArchivedItem } from './archived-items'

/**
 * Everything archived in a workspace that the person may see, live from each resource's own native query (each with
 * its own access rules): rooms, files and notes, skills and MCP servers, automations, tasks, agents and their threads.
 * Personal AI chats come from the chat list. An archive, restore or delete anywhere shows at once. `items` is null
 * while any source loads; `failed` names sources the person cannot read.
 */
export function useLiveArchivedItems(workspaceId: string | null): { items: ArchivedItem[] | null; failed: ArchivedCategory[] } {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const args = workspaceId && isAuthenticated && !isLoading ? { workspaceId } : 'skip'
  const archived = workspaceId && isAuthenticated && !isLoading ? { workspaceId, view: 'archived' as const } : 'skip'
  const rooms = useQuery(api.collaboration.archive.rooms, args)
  const files = useQuery(api.files.browse.list, archived)
  const skills = useQuery(api.integrations.skillsBrowse.list, archived)
  const servers = useQuery(api.integrations.mcpBrowse.servers, archived)
  const automations = useQuery(api.automations.browse.list, archived)
  const work = useQuery(api.work.browse.list, archived)
  const agents = useQuery(api.agents.directory.list, workspaceId && isAuthenticated && !isLoading ? { workspaceId, includeArchived: true } : 'skip')
  const threads = useQuery(api.agents.threads.archived, args)

  return useMemo(() => {
    const sources = [rooms, files, skills, servers, automations, work, agents, threads]
    if (!workspaceId || sources.some((source) => source === undefined)) return { items: null, failed: [] }
    const failed = new Set<ArchivedCategory>()
    const read = <T,>(value: unknown, category: ArchivedCategory): T[] => {
      if (value === null) {
        failed.add(category)
        return []
      }
      return value as T[]
    }
    const items = [
      ...archivedRooms(read<ArchivedConversationRow>(rooms, 'chats')),
      ...archivedFiles(read<FileTreeEntry>(files, 'files')),
      ...archivedExtensions(read<SkillSummary>(skills, 'extensions'), read<McpServerSummary>(servers, 'extensions')),
      ...archivedAutomations(read<AutomationSummary>(automations, 'automations')),
      ...archivedWork(read<WorkItem>(work, 'work')),
      ...archivedAgents(read<WorkspaceAgentDirectoryItem>(agents, 'agents'), read<WorkspaceArchivedAgentThread>(threads, 'agents')),
    ]
    return { items, failed: [...failed] }
  }, [agents, automations, files, rooms, servers, skills, threads, work, workspaceId])
}
