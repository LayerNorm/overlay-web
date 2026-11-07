import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { visibleRow } from './directory'
import {
  createAgentThread,
  deleteAgentThread,
  listAgentAutomations,
  listAgentThreads,
  listArchivedAgentThreads,
  resolveMainAgentThread,
  setAgentThreadArchived,
} from './agentThreads'

const agentArgs = { workspaceId: v.string(), agentId: v.string() }

/** The signed-in member and the agent, when the member may see it. Invisible agents read as missing. */
async function visibleAgent(ctx: QueryCtx, args: { workspaceId: string; agentId: string }, options: { live?: boolean } = {}) {
  const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
  const row = await ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_agentId', q => q.eq('agentId', args.agentId)).unique()
  const agent = await visibleRow(ctx, row, viewer)
  if (!agent || (options.live && agent.archivedAt)) throw new Error('AGENT_NOT_FOUND')
  return { viewer, agent }
}

async function readable<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof Error && ['UNAUTHENTICATED', 'WORKSPACE_ACCESS_DENIED', 'AGENT_NOT_FOUND'].includes(error.message)) return null
    throw error
  }
}

/** An agent's threads and automations for the signed-in member, live. Null when the agent is not visible. */
export const bundle = query({
  args: agentArgs,
  handler: async (ctx, args) => await readable(async () => {
    const { viewer } = await visibleAgent(ctx, args)
    const owned = { ...args, userId: viewer.userId }
    const [threads, automations] = await Promise.all([listAgentThreads(ctx, owned), listAgentAutomations(ctx, owned)])
    return { threads, automations }
  }),
})

/** Threads the member archived across agents, for Settings → Archived. */
export const archived = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => await readable(async () => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    return await listArchivedAgentThreads(ctx, { workspaceId: args.workspaceId, userId: viewer.userId })
  }),
})

/** Opens the agent's main thread, adopting or creating it once; concurrent calls resolve the same thread. */
export const resolveMain = mutation({
  args: agentArgs,
  handler: async (ctx, args) => {
    const { viewer } = await visibleAgent(ctx, args)
    return await resolveMainAgentThread(ctx, { ...args, userId: viewer.userId })
  },
})

export const create = mutation({
  args: { ...agentArgs, title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { viewer } = await visibleAgent(ctx, args, { live: true })
    return await createAgentThread(ctx, { ...args, userId: viewer.userId })
  },
})

export const setArchived = mutation({
  args: { ...agentArgs, conversationId: v.id('conversations'), archived: v.boolean() },
  handler: async (ctx, args) => {
    const { viewer } = await visibleAgent(ctx, args)
    const conversation = await ctx.db.get(args.conversationId)
    if (conversation?.workspaceId !== args.workspaceId) throw new Error('THREAD_NOT_FOUND')
    await setAgentThreadArchived(ctx, { ...args, userId: viewer.userId })
    return null
  },
})

export const remove = mutation({
  args: { ...agentArgs, conversationId: v.id('conversations') },
  handler: async (ctx, args) => {
    const { viewer } = await visibleAgent(ctx, args)
    const conversation = await ctx.db.get(args.conversationId)
    if (conversation?.workspaceId !== args.workspaceId) throw new Error('THREAD_NOT_FOUND')
    await deleteAgentThread(ctx, { ...args, userId: viewer.userId })
    return null
  },
})
