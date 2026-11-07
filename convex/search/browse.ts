import { v } from 'convex/values'
import type { AuthorizationCapability } from '@overlay/authz-contracts'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { query } from '../_generated/server'
import { nativePersonalChatScope, requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { scopeContextLoader } from '../lib/resourceScope'

const LIMIT = 10
const SCAN = LIMIT * 5

type Viewer = Awaited<ReturnType<typeof requireNativeWorkspace>>
type Ctx = Pick<QueryCtx, 'db' | 'auth'>
type Scoped = { userId: string; scope?: 'personal' | 'workspace'; archivedAt?: number; workspaceId?: string; deletedAt?: number }

async function allowed(ctx: Ctx, viewer: Viewer, capability: AuthorizationCapability) {
  try {
    await requireNativeCapability(ctx, viewer.userId, capability)
    return true
  } catch {
    return false
  }
}

/** The viewer's own live rows plus what others shared with the workspace and the viewer may read, newest search hits first. */
async function readable<Row extends Scoped>(ctx: Ctx, viewer: Viewer, own: Row[], shared: Row[]) {
  const scope = scopeContextLoader(ctx, viewer.userId)
  const mine = own.filter(row => row.archivedAt === undefined && row.deletedAt === undefined)
  const others: Row[] = []
  for (const row of shared) {
    if (row.userId !== viewer.userId && row.scope === 'workspace' && row.archivedAt === undefined && row.deletedAt === undefined
      && await scope.canRead(row)) others.push(row)
  }
  return [...mine, ...others].slice(0, LIMIT)
}

async function chats(ctx: Ctx, viewer: Viewer, q: string) {
  const rows = q
    ? await ctx.db.query('conversations').withSearchIndex('search_title', s => s.search('title', q)
      .eq('userId', viewer.userId).eq('workspaceId', viewer.workspaceId).eq('deletedAt', undefined)).take(SCAN)
    : await ctx.db.query('conversations').withIndex('by_workspaceId_userId_lastModified', i =>
      i.eq('workspaceId', viewer.workspaceId).eq('userId', viewer.userId)).order('desc').take(SCAN)
  const out: Array<{ id: string; title: string }> = []
  for (const conversation of rows) {
    if (out.length >= LIMIT) break
    // The same rule as the chat list: the viewer's own AI chats, not automation chats, not archived.
    const access = await nativePersonalChatScope(ctx, viewer, conversation)
    if (!access || access.kind === 'automation' || access.participant?.archivedAt !== undefined) continue
    out.push({ id: conversation._id, title: conversation.title })
  }
  return out
}

async function files(ctx: Ctx, viewer: Viewer, q: string) {
  const [own, shared] = q
    ? await Promise.all([
        ctx.db.query('files').withSearchIndex('search_name', s => s.search('name', q)
          .eq('userId', viewer.userId).eq('workspaceId', viewer.workspaceId).eq('deletedAt', undefined)).take(SCAN),
        ctx.db.query('files').withSearchIndex('search_name', s => s.search('name', q)
          .eq('workspaceId', viewer.workspaceId).eq('deletedAt', undefined)).take(SCAN),
      ])
    : await Promise.all([
        ctx.db.query('files').withIndex('by_workspaceId_userId_updatedAt', i =>
          i.eq('workspaceId', viewer.workspaceId).eq('userId', viewer.userId)).order('desc').take(SCAN),
        ctx.db.query('files').withIndex('by_workspaceId_scope_archivedAt', i =>
          i.eq('workspaceId', viewer.workspaceId).eq('scope', 'workspace').eq('archivedAt', undefined)).order('desc').take(SCAN),
      ])
  const notFolder = (row: Doc<'files'>) => row.type !== 'folder' && row.kind !== 'folder'
  return (await readable(ctx, viewer, own.filter(notFolder), shared.filter(notFolder)))
    .map(row => ({ id: row._id, name: row.name, kind: row.kind, mimeType: row.mimeType }))
}

async function automations(ctx: Ctx, viewer: Viewer, q: string) {
  const [own, shared] = q
    ? await Promise.all([
        ctx.db.query('automations').withSearchIndex('search_name', s => s.search('name', q)
          .eq('userId', viewer.userId).eq('workspaceId', viewer.workspaceId).eq('deletedAt', undefined)).take(SCAN),
        ctx.db.query('automations').withSearchIndex('search_name', s => s.search('name', q)
          .eq('workspaceId', viewer.workspaceId).eq('deletedAt', undefined)).take(SCAN),
      ])
    : await Promise.all([
        ctx.db.query('automations').withIndex('by_workspaceId_userId_archivedAt', i =>
          i.eq('workspaceId', viewer.workspaceId).eq('userId', viewer.userId).eq('archivedAt', undefined)).order('desc').take(SCAN),
        ctx.db.query('automations').withIndex('by_workspaceId_scope_archivedAt', i =>
          i.eq('workspaceId', viewer.workspaceId).eq('scope', 'workspace').eq('archivedAt', undefined)).order('desc').take(SCAN),
      ])
  return (await readable(ctx, viewer, own, shared)).map(row => ({ id: row._id, name: row.name, description: row.description }))
}

async function skills(ctx: Ctx, viewer: Viewer, q: string) {
  const [own, shared] = q
    ? await Promise.all([
        ctx.db.query('skills').withSearchIndex('search_name', s => s.search('name', q).eq('userId', viewer.userId).eq('workspaceId', viewer.workspaceId)).take(SCAN),
        ctx.db.query('skills').withSearchIndex('search_name', s => s.search('name', q).eq('workspaceId', viewer.workspaceId)).take(SCAN),
      ])
    : await Promise.all([
        ctx.db.query('skills').withIndex('by_workspaceId_userId_archivedAt', i =>
          i.eq('workspaceId', viewer.workspaceId).eq('userId', viewer.userId).eq('archivedAt', undefined)).order('desc').take(SCAN),
        ctx.db.query('skills').withIndex('by_workspaceId_scope_archivedAt', i =>
          i.eq('workspaceId', viewer.workspaceId).eq('scope', 'workspace').eq('archivedAt', undefined)).order('desc').take(SCAN),
      ])
  const enabled = (row: Doc<'skills'>) => row.enabled !== false
  return (await readable(ctx, viewer, own.filter(enabled), shared.filter(enabled)))
    .map(row => ({ id: row._id, name: row.name, description: row.description }))
}

async function mcpServers(ctx: Ctx, viewer: Viewer, q: string) {
  const [own, shared] = q
    ? await Promise.all([
        ctx.db.query('mcpServers').withSearchIndex('search_name', s => s.search('name', q).eq('userId', viewer.userId).eq('workspaceId', viewer.workspaceId)).take(SCAN),
        ctx.db.query('mcpServers').withSearchIndex('search_name', s => s.search('name', q).eq('workspaceId', viewer.workspaceId)).take(SCAN),
      ])
    : await Promise.all([
        ctx.db.query('mcpServers').withIndex('by_workspaceId_userId_archivedAt', i =>
          i.eq('workspaceId', viewer.workspaceId).eq('userId', viewer.userId).eq('archivedAt', undefined)).order('desc').take(SCAN),
        ctx.db.query('mcpServers').withIndex('by_workspaceId_scope_archivedAt', i =>
          i.eq('workspaceId', viewer.workspaceId).eq('scope', 'workspace').eq('archivedAt', undefined)).order('desc').take(SCAN),
      ])
  // Only names and descriptions: a server's address and credentials never appear in mentions.
  return (await readable(ctx, viewer, own, shared)).map(row => ({ id: row._id, name: row.name, description: row.description }))
}

/**
 * @-mentions, Cmd-K and the context pickers, natively. With a query, each category is an indexed search; without one,
 * the newest items. Each category needs the viewer's capability for it (a missing one yields an empty list), archived
 * and deleted items never appear, other members' items only when shared with the workspace and readable, and chats
 * follow the chat list's rules. At most ten per category. Null without workspace access.
 */
export const mentions = query({
  args: { workspaceId: v.string(), query: v.string() },
  handler: async (ctx, args) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    } catch {
      return null
    }
    const q = args.query.trim().slice(0, 200)
    const [canChats, canFiles, canAutomations, canSkills, canMcp, canConnectors] = await Promise.all([
      allowed(ctx, viewer, 'conversations.read'),
      allowed(ctx, viewer, 'files.read'),
      allowed(ctx, viewer, 'automations.use'),
      allowed(ctx, viewer, 'skills.use'),
      allowed(ctx, viewer, 'mcp.use'),
      allowed(ctx, viewer, 'integrations.use'),
    ])
    const [chatRows, fileRows, automationRows, skillRows, mcpRows] = await Promise.all([
      canChats ? chats(ctx, viewer, q) : [],
      canFiles ? files(ctx, viewer, q) : [],
      canAutomations ? automations(ctx, viewer, q) : [],
      canSkills ? skills(ctx, viewer, q) : [],
      canMcp ? mcpServers(ctx, viewer, q) : [],
    ])
    return {
      query: q,
      chats: chatRows,
      files: fileRows,
      automations: automationRows,
      skills: skillRows,
      mcpServers: mcpRows,
      /** Connectors come from the integration provider over HTTP; this says whether to show them. */
      connectorsAllowed: canConnectors,
    }
  },
})
