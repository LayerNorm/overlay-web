import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { NEW_AGENT_DEFAULT_MODEL_ID } from '../../src/shared/ai/gateway/model-types'

const BYOK_PREFIX = 'byok/'

/**
 * Workspace agents may only run on Overlay's hosted models and the workspace's own providers, never someone's personal
 * key or subscription. This moves every live workspace agent whose model is on a personal (or missing, or another
 * workspace's) connection to the default Overlay model, and lists them so their owners can pick a workspace provider.
 * Creator-only agents are left alone. Idempotent; `dryRun` only counts. Run until `isDone`, passing `continueCursor`.
 */
export const moveWorkspaceAgentsOffPersonalModelsByServer = mutation({
  args: {
    serverSecret: v.string(),
    dryRun: v.boolean(),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { serverSecret, dryRun, cursor, numItems }) => {
    requireServerSecret(serverSecret)
    const page = await ctx.db.query('workspaceAgentDefinitions').paginate({ cursor: cursor ?? null, numItems: numItems ?? 100 })
    const moved: Array<{ agentId: string; workspaceId: string; name: string; from: string }> = []
    for (const agent of page.page) {
      if (agent.deletedAt !== undefined || (agent.visibility ?? 'workspace') !== 'workspace') continue
      if (!agent.modelId?.startsWith(BYOK_PREFIX)) continue
      const connectionId = agent.modelId.slice(BYOK_PREFIX.length).split('/')[0] ?? ''
      const id = ctx.db.normalizeId('userProviderConnections', connectionId)
      const connection = id ? await ctx.db.get(id) : null
      const workspaceConnection = connection && connection.scope === 'workspace' && connection.workspaceId === agent.workspaceId
      if (workspaceConnection) continue
      moved.push({ agentId: agent.agentId, workspaceId: agent.workspaceId, name: agent.name, from: agent.modelId })
      if (!dryRun) await ctx.db.patch(agent._id, { modelId: NEW_AGENT_DEFAULT_MODEL_ID, updatedAt: Date.now() })
    }
    return {
      scanned: page.page.length, moved, isDone: page.isDone, continueCursor: page.isDone ? null : page.continueCursor,
    }
  },
})
