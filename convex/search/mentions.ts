import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'

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

    const [conversationsRaw, filesRaw, notesRaw, automationsRaw, skills, mcpServers] = await Promise.all([
      // Conversations: search by title, filter by user
      ctx.db
        .query('conversations')
        .withSearchIndex('search_title', (search) =>
          search.search('title', q).eq('userId', args.userId),
        )
        .take(MENTION_SEARCH_LIMIT * 2),
      // Files: search by name, filter by user
      ctx.db
        .query('files')
        .withSearchIndex('search_name', (search) =>
          search.search('name', q).eq('userId', args.userId),
        )
        .take(MENTION_SEARCH_LIMIT * 2),
      // Notes: search by title, filter by user
      ctx.db
        .query('notes')
        .withSearchIndex('search_title', (search) =>
          search.search('title', q).eq('userId', args.userId),
        )
        .take(MENTION_SEARCH_LIMIT * 2),
      // Automations: search by name, filter by user
      ctx.db
        .query('automations')
        .withSearchIndex('search_name', (search) =>
          search.search('name', q).eq('userId', args.userId),
        )
        .take(MENTION_SEARCH_LIMIT * 2),
      // Skills: search by name, filter by user
      ctx.db
        .query('skills')
        .withSearchIndex('search_name', (search) =>
          search.search('name', q).eq('userId', args.userId),
        )
        .take(MENTION_SEARCH_LIMIT),
      // MCP servers: search by name, filter by user
      ctx.db
        .query('mcpServers')
        .withSearchIndex('search_name', (search) =>
          search.search('name', q).eq('userId', args.userId),
        )
        .take(MENTION_SEARCH_LIMIT),
    ])

    // Filter out deleted items in JS (Convex search index filters don't
    // expose optional fields like deletedAt in the filter builder).
    const conversations = conversationsRaw.filter((r) => r.deletedAt === undefined).slice(0, MENTION_SEARCH_LIMIT)
    const files = filesRaw.filter((r) => r.deletedAt === undefined).slice(0, MENTION_SEARCH_LIMIT)
    const notes = notesRaw.filter((r) => r.deletedAt === undefined).slice(0, MENTION_SEARCH_LIMIT)
    const automations = automationsRaw.filter((r) => r.deletedAt === undefined).slice(0, MENTION_SEARCH_LIMIT)

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
      notes: notes.map((n) => ({
        _id: n._id,
        title: n.title,
      })),
      automations: automations.map((a) => ({
        _id: a._id,
        name: a.name,
        description: a.description,
      })),
      skills: skills.map((s) => ({
        _id: s._id,
        name: s.name,
        description: s.description,
      })),
      mcpServers: mcpServers.map((m) => ({
        _id: m._id,
        name: m.name,
        description: m.description,
      })),
    }
  },
})
