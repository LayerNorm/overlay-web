import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { scopeContextLoader } from '../lib/resourceScope'

const MENTION_SEARCH_LIMIT = 10

/**
 * Indexed mention search using Convex search indexes.
 * Returns bounded top-K results per category for the given query.
 * Replaces the previous scan-and-filter approach that fetched all items
 * and filtered client-side.
 *
 * Supports both accessToken (browser) and serverSecret (BFF) auth.
 */
export const searchMentions = query({
  args: {
    accessToken: v.optional(v.string()),
    userId: v.string(),
    query: v.string(),
    serverSecret: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
  },
  returns: v.object({
    conversations: v.array(v.object({
      _id: v.string(),
      title: v.string(),
      _creationTime: v.number(),
    })),
    files: v.array(v.object({
      _id: v.string(),
      name: v.string(),
      kind: v.optional(v.string()),
      mimeType: v.optional(v.string()),
    })),
    notes: v.array(v.object({
      _id: v.string(),
      title: v.string(),
    })),
    automations: v.array(v.object({
      _id: v.string(),
      name: v.optional(v.string()),
      description: v.optional(v.string()),
    })),
    skills: v.array(v.object({
      _id: v.string(),
      name: v.string(),
      description: v.string(),
    })),
    mcpServers: v.array(v.object({
      _id: v.string(),
      name: v.string(),
      description: v.optional(v.string()),
    })),
  }),
  handler: async (ctx, args) => {
    // Auth: accept either serverSecret (BFF) or accessToken (browser).
    if (!validateServerSecret(args.serverSecret)) {
      try {
        await requireAccessToken(args.accessToken ?? '', args.userId)
      } catch {
        return { conversations: [], files: [], notes: [], automations: [], skills: [], mcpServers: [] }
      }
    }
    const q = args.query.trim()
    if (!q) {
      return { conversations: [], files: [], notes: [], automations: [], skills: [], mcpServers: [] }
    }

    // Every result is scoped to the caller AND to the active workspace. Search
    // indexes carry `workspaceId` as a filter field, and an explicit workspace
    // matches only documents stamped with it — the same strict equality the
    // conversation/file list queries use, so search can never surface a
    // resource the corresponding list view would hide.
    const workspaceId = args.workspaceId
    const userId = args.userId

    const [conversationsRaw, filesRaw, automationsRaw, skills, mcpServers] = await Promise.all([
      // Conversations: search by title, scoped to user + workspace
      ctx.db
        .query('conversations')
        .withSearchIndex('search_title', (search) => {
          const scoped = search.search('title', q).eq('userId', userId)
          return workspaceId === undefined ? scoped : scoped.eq('workspaceId', workspaceId)
        })
        .take(MENTION_SEARCH_LIMIT * 2),
      // Files: search by name, scoped to user + workspace
      ctx.db
        .query('files')
        .withSearchIndex('search_name', (search) => {
          const scoped = search.search('name', q).eq('userId', userId)
          return workspaceId === undefined ? scoped : scoped.eq('workspaceId', workspaceId)
        })
        .take(MENTION_SEARCH_LIMIT * 2),
      // Automations: search by name, scoped to user + workspace
      ctx.db
        .query('automations')
        .withSearchIndex('search_name', (search) => {
          const scoped = search.search('name', q).eq('userId', userId)
          return workspaceId === undefined ? scoped : scoped.eq('workspaceId', workspaceId)
        })
        .take(MENTION_SEARCH_LIMIT * 2),
      // Skills: search by name, scoped to user + workspace
      ctx.db
        .query('skills')
        .withSearchIndex('search_name', (search) => {
          const scoped = search.search('name', q).eq('userId', userId)
          return workspaceId === undefined ? scoped : scoped.eq('workspaceId', workspaceId)
        })
        .take(MENTION_SEARCH_LIMIT),
      // MCP servers: search by name, scoped to user + workspace
      ctx.db
        .query('mcpServers')
        .withSearchIndex('search_name', (search) => {
          const scoped = search.search('name', q).eq('userId', userId)
          return workspaceId === undefined ? scoped : scoped.eq('workspaceId', workspaceId)
        })
        .take(MENTION_SEARCH_LIMIT),
    ])

    // What other members shared with the workspace is searchable too. The index only filters on workspace, so over-fetch
    // and keep what this person may read: workspace-scoped, not archived, in a workspace they belong to.
    const scopeFilter = scopeContextLoader(ctx, userId)
    const sharedFiles: typeof filesRaw = []
    const sharedAutomations: typeof automationsRaw = []
    const sharedSkills: typeof skills = []
    const sharedMcpServers: typeof mcpServers = []
    if (workspaceId !== undefined) {
      const SHARED_SCAN = MENTION_SEARCH_LIMIT * 5
      const [filesAll, automationsAll, skillsAll, mcpAll] = await Promise.all([
        ctx.db.query('files').withSearchIndex('search_name', (search) => search.search('name', q).eq('workspaceId', workspaceId)).take(SHARED_SCAN),
        ctx.db.query('automations').withSearchIndex('search_name', (search) => search.search('name', q).eq('workspaceId', workspaceId)).take(SHARED_SCAN),
        ctx.db.query('skills').withSearchIndex('search_name', (search) => search.search('name', q).eq('workspaceId', workspaceId)).take(SHARED_SCAN),
        ctx.db.query('mcpServers').withSearchIndex('search_name', (search) => search.search('name', q).eq('workspaceId', workspaceId)).take(SHARED_SCAN),
      ])
      const sharedReadable = async <Row extends { userId: string; scope?: 'personal' | 'workspace'; archivedAt?: number; workspaceId?: string }>(rows: Row[], into: Row[]) => {
        for (const row of rows) {
          if (row.userId !== userId && row.scope === 'workspace' && row.archivedAt === undefined && await scopeFilter.canRead(row)) into.push(row)
        }
      }
      await Promise.all([
        sharedReadable(filesAll, sharedFiles),
        sharedReadable(automationsAll, sharedAutomations),
        sharedReadable(skillsAll, sharedSkills),
        sharedReadable(mcpAll, sharedMcpServers),
      ])
    }

    // Filter out deleted and archived items in JS (Convex search index filters don't
    // expose optional fields like deletedAt in the filter builder).
    const conversations = conversationsRaw.filter((r) => r.deletedAt === undefined).slice(0, MENTION_SEARCH_LIMIT)
    const files = [...filesRaw.filter((r) => r.archivedAt === undefined), ...sharedFiles].filter((r) => r.deletedAt === undefined).slice(0, MENTION_SEARCH_LIMIT)
    const automations = [...automationsRaw.filter((r) => r.archivedAt === undefined), ...sharedAutomations].filter((r) => r.deletedAt === undefined).slice(0, MENTION_SEARCH_LIMIT)
    const skillsAll = [...skills.filter((r) => r.archivedAt === undefined), ...sharedSkills].slice(0, MENTION_SEARCH_LIMIT)
    const mcpServersAll = [...mcpServers.filter((r) => r.archivedAt === undefined), ...sharedMcpServers].slice(0, MENTION_SEARCH_LIMIT)

    return {
      conversations: conversations.map((c) => ({
        _id: c._id,
        title: c.title,
        _creationTime: c._creationTime,
      })),
      files: files.map((f) => ({
        _id: f._id,
        name: f.name,
        kind: f.kind,
        mimeType: f.mimeType,
      })),
      // Notes are `files` rows of kind "note" and arrive in `files`; the separate list is kept for the response shape.
      notes: [],
      automations: automations.map((a) => ({
        _id: a._id,
        name: a.name,
        description: a.description,
      })),
      skills: skillsAll.map((s) => ({
        _id: s._id,
        name: s.name,
        description: s.description,
      })),
      mcpServers: mcpServersAll.map((m) => ({
        _id: m._id,
        name: m.name,
        description: m.description,
      })),
    }
  },
})
