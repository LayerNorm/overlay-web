import 'server-only'

import {
  matchesSearchQuery,
  rankSearchResults,
  WORKSPACE_SEARCH_DEFAULT_LIMIT,
  WORKSPACE_SEARCH_MIN_QUERY_LENGTH,
  type WorkspaceSearchKind,
  type WorkspaceSearchResponse,
  type WorkspaceSearchResult,
} from '@/shared/search/workspace-search'
import type { ActConversationRepository } from '@/server/conversations/ActConversationRepository'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import { canSeeAgent } from '@/server/agents/WorkspaceAgentService'
import type { WorkspaceAgentRepository } from '@/server/agents/WorkspaceAgentRepository'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { WorkspaceSharingService } from '@/server/sharing/WorkspaceSharingService'

type OwnedLister<T> = (args: { userId: string }) => Promise<T[]>

export type WorkspaceSearchSources = {
  files: OwnedLister<{ _id?: string; id?: string; name?: string; title?: string; updatedAt?: number; workspaceId?: string }>
  projects: OwnedLister<{ id?: string; _id?: string; name?: string; updatedAt?: number }>
  knowledgeBases: OwnedLister<{ id: string; title: string; updatedAt?: number }>
  automations: OwnedLister<{ id?: string; _id?: string; name?: string; updatedAt?: number }>
}

type ResourceLoader = (args: {
  resourceId: string
  ownerUserId: string
}) => Promise<{ title: string; updatedAt?: number } | null>

/**
 * Workspace-wide search that only ever returns what the actor may open.
 *
 * Ownership and sharing are resolved separately: owned resources come from the
 * owner-scoped repositories, shared ones from the sharing service's accessible
 * lists. Nothing is title-matched before authorization, so a snippet can never
 * disclose a resource the actor cannot reach.
 */
export class WorkspaceSearchService {
  constructor(private readonly deps: {
    agents: WorkspaceAgentRepository
    collaboration: ConversationCollaborationRepository
    conversations: ActConversationRepository
    sharing: WorkspaceSharingService
    sources: WorkspaceSearchSources
    loaders: Partial<Record<WorkspaceSearchKind, ResourceLoader>>
    workspaces: WorkspaceService
  }) {}

  async search(args: {
    actorUserId: string
    workspaceId: string
    query: string
    kinds: WorkspaceSearchKind[]
    limitPerKind?: number
  }): Promise<WorkspaceSearchResponse> {
    const query = args.query.trim()
    const limit = args.limitPerKind ?? WORKSPACE_SEARCH_DEFAULT_LIMIT
    if (query.length < WORKSPACE_SEARCH_MIN_QUERY_LENGTH) {
      return { query, results: [], kinds: args.kinds }
    }
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const workspaceId = access.workspace.id
    const groups = await Promise.all(args.kinds.map(async (kind) => {
      const results = await this.searchKind({
        actorUserId: args.actorUserId,
        kind,
        query,
        workspaceId,
      })
      return rankSearchResults(results, query).slice(0, limit)
    }))
    return { query, results: groups.flat(), kinds: args.kinds }
  }

  /** Resources reachable only through a grant, for the Shared with me surface. */
  async listSharedWithMe(args: {
    actorUserId: string
    workspaceId: string
    kinds: WorkspaceSearchKind[]
  }): Promise<WorkspaceSearchResult[]> {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const groups = await Promise.all(args.kinds.map((kind) => this.sharedResources({
      actorUserId: args.actorUserId,
      kind,
      workspaceId: access.workspace.id,
    })))
    return groups.flat().sort((a, b) => (
      (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.title.localeCompare(b.title)
    ))
  }

  private async searchKind(args: {
    actorUserId: string
    kind: WorkspaceSearchKind
    query: string
    workspaceId: string
  }): Promise<WorkspaceSearchResult[]> {
    if (args.kind === 'conversation') return await this.searchConversations(args)
    if (args.kind === 'agent') return await this.searchAgents(args)
    const [owned, shared] = await Promise.all([
      this.ownedResources(args),
      this.sharedResources(args),
    ])
    const seen = new Set(owned.map((result) => result.id))
    return [
      ...owned.filter((result) => matchesSearchQuery(result.title, args.query)),
      ...shared.filter((result) => (
        !seen.has(result.id) && matchesSearchQuery(result.title, args.query)
      )),
    ]
  }

  /**
   * Chat search is delegated to the collaboration repository, which already
   * filters by participation, so message snippets stay authorized.
   */
  private async searchConversations(args: {
    actorUserId: string
    query: string
    workspaceId: string
  }): Promise<WorkspaceSearchResult[]> {
    const results = await this.deps.collaboration.searchWorkspaceChats({
      actorUserId: args.actorUserId,
      query: args.query,
      workspaceId: args.workspaceId,
    })
    return results.map((result) => ({
      kind: 'conversation' as const,
      id: result.conversationId,
      title: result.conversationType === 'channel' ? `#${result.title}` : result.title,
      snippet: result.snippet,
      subtitle: result.authorDisplayName,
      updatedAt: result.createdAt,
    }))
  }

  private async searchAgents(args: {
    actorUserId: string
    query: string
    workspaceId: string
  }): Promise<WorkspaceSearchResult[]> {
    const [access, agents] = await Promise.all([
      this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId),
      this.deps.agents.list({ workspaceId: args.workspaceId }),
    ])
    return agents
      .filter((agent) => canSeeAgent(agent, access.principal.id))
      .filter((agent) => (
        matchesSearchQuery(agent.name, args.query)
        || matchesSearchQuery(agent.description ?? undefined, args.query)
      ))
      .map((agent) => ({
        kind: 'agent' as const,
        id: agent.id,
        title: agent.name,
        subtitle: agent.description ?? undefined,
        updatedAt: agent.updatedAt,
      }))
  }

  private async ownedResources(args: {
    actorUserId: string
    kind: WorkspaceSearchKind
    workspaceId: string
  }): Promise<WorkspaceSearchResult[]> {
    const rows = await this.listOwned(args.kind, args.actorUserId)
    return rows.map((row) => ({
      kind: args.kind,
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt,
    }))
  }

  private async listOwned(
    kind: WorkspaceSearchKind,
    userId: string,
  ): Promise<Array<{ id: string; title: string; updatedAt?: number }>> {
    if (kind === 'file') {
      const files = await this.deps.sources.files.call(this.deps.sources, { userId })
      return files.map((file) => ({
        id: String(file._id ?? file.id ?? ''),
        title: file.name ?? file.title ?? 'Untitled',
        updatedAt: file.updatedAt,
      })).filter((row) => row.id)
    }
    if (kind === 'project') {
      const projects = await this.deps.sources.projects.call(this.deps.sources, { userId })
      return projects.map((project) => ({
        id: String(project.id ?? project._id ?? ''),
        title: project.name ?? 'Untitled project',
        updatedAt: project.updatedAt,
      })).filter((row) => row.id)
    }
    if (kind === 'knowledge_base') {
      const bases = await this.deps.sources.knowledgeBases.call(this.deps.sources, { userId })
      return bases.map((base) => ({ id: base.id, title: base.title, updatedAt: base.updatedAt }))
    }
    if (kind === 'automation') {
      const automations = await this.deps.sources.automations.call(this.deps.sources, { userId })
      return automations.map((automation) => ({
        id: String(automation.id ?? automation._id ?? ''),
        title: automation.name ?? 'Untitled automation',
        updatedAt: automation.updatedAt,
      })).filter((row) => row.id)
    }
    return []
  }

  private async sharedResources(args: {
    actorUserId: string
    kind: WorkspaceSearchKind
    workspaceId: string
  }): Promise<WorkspaceSearchResult[]> {
    if (args.kind === 'conversation' || args.kind === 'agent') return []
    const accessible = await this.deps.sharing.listAccessibleResources({
      action: 'view',
      actorUserId: args.actorUserId,
      workspaceId: args.workspaceId,
      resourceType: args.kind,
    })
    const loader = this.deps.loaders[args.kind]
    if (!loader) return []
    const loaded = await Promise.all(accessible.map(async (entry): Promise<WorkspaceSearchResult | null> => {
      const resource = await loader({
        resourceId: entry.resourceId,
        ownerUserId: entry.ownerUserId,
      }).catch((_error) => null)
      if (!resource) return null
      return {
        kind: args.kind,
        id: entry.resourceId,
        title: resource.title,
        updatedAt: resource.updatedAt,
        accessRole: entry.accessRole,
        sharedVia: entry.targetType === 'principal' ? 'direct' : entry.targetType,
      } satisfies WorkspaceSearchResult
    }))
    return loaded.filter((result): result is WorkspaceSearchResult => result !== null)
  }
}
