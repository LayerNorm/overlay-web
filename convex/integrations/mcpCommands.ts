import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, mutation, type MutationCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import type { Doc, Id } from '../_generated/dataModel'

const COMMAND_TIMEOUT_MS = 5 * 60_000

const commandKind = v.union(v.literal('test'), v.literal('connect'), v.literal('disconnect'))

async function requireOwnedWorkspaceServer(
  ctx: Pick<MutationCtx, 'db'>,
  args: { mcpServerId: Id<'mcpServers'>; userId: string; workspaceId: string },
): Promise<Doc<'mcpServers'>> {
  const server = await ctx.db.get(args.mcpServerId)
  if (!server || server.userId !== args.userId || server.workspaceId !== args.workspaceId) {
    throw new Error('MCP_SERVER_ACCESS_DENIED')
  }
  const workspace = await ctx.db.query('workspaces')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
    .unique()
  if (!workspace || workspace.status !== 'active' || workspace.archivedAt !== undefined) {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', args.workspaceId).eq('userId', args.userId))
    .unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt !== undefined) {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId))
    .unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
  return server
}

const commandArgs = {
  serverSecret: v.string(),
  userId: v.string(),
  workspaceId: v.string(),
  mcpServerId: v.id('mcpServers'),
}

/** Begin a server-owned external operation and schedule crash cleanup. */
export const begin = mutation({
  args: { ...commandArgs, commandId: v.string(), kind: commandKind },
  returns: v.string(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const server = await requireOwnedWorkspaceServer(ctx, args)
    const now = Date.now()
    const previous = server.commandState
    if (previous?.status === 'pending' && now - previous.startedAt < COMMAND_TIMEOUT_MS) {
      throw new Error('MCP_COMMAND_IN_PROGRESS')
    }
    await ctx.db.patch(server._id, {
      commandState: {
        id: args.commandId,
        kind: args.kind,
        status: 'pending',
        startedAt: now,
      },
    })
    await ctx.scheduler.runAfter(COMMAND_TIMEOUT_MS, internal.integrations.mcpCommands.expire, {
      mcpServerId: server._id,
      commandId: args.commandId,
    })
    return args.commandId
  },
})

/** Finish only the command that still owns the pending slot. */
export const finish = mutation({
  args: {
    ...commandArgs,
    commandId: v.string(),
    status: v.union(v.literal('succeeded'), v.literal('failed')),
    toolCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const server = await requireOwnedWorkspaceServer(ctx, args)
    const command = server.commandState
    if (!command || command.id !== args.commandId || command.status !== 'pending') {
      throw new Error('MCP_COMMAND_STALE')
    }
    const finishedAt = Date.now()
    if (finishedAt - command.startedAt >= COMMAND_TIMEOUT_MS) throw new Error('MCP_COMMAND_EXPIRED')
    if (args.toolCount !== undefined && (!Number.isInteger(args.toolCount) || args.toolCount < 0 || args.toolCount > 10_000)) {
      throw new Error('INVALID_MCP_COMMAND_RESULT')
    }
    await ctx.db.patch(server._id, {
      commandState: {
        ...command,
        status: args.status,
        finishedAt,
        ...(args.toolCount !== undefined ? { toolCount: args.toolCount } : {}),
      },
    })
    return null
  },
})

/** Scheduled cleanup is tied to a command id so an old timer cannot finish a newer operation. */
export const expire = internalMutation({
  args: { mcpServerId: v.id('mcpServers'), commandId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const server = await ctx.db.get(args.mcpServerId)
    const command = server?.commandState
    if (!server || !command || command.id !== args.commandId || command.status !== 'pending') return null
    const finishedAt = Date.now()
    if (finishedAt - command.startedAt < COMMAND_TIMEOUT_MS) return null
    await ctx.db.patch(server._id, {
      commandState: { ...command, status: 'failed', finishedAt },
    })
    return null
  },
})
