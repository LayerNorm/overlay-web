import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'

const SLACK_PROVIDER_KEY = 'slackbot'
const MAX_JOBS = 20

/**
 * The Slack import panel's state, live, for an active member: whether the viewer's own Slack connector is connected
 * in this workspace (so finishing OAuth in another tab shows at once) and the workspace's recent import jobs with
 * their progress, written by the import runner as it goes. Connector account references never leave Convex.
 */
export const status = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, workspaceId)
    } catch {
      return null
    }
    const connectors = await ctx.db.query('workspaceConnectors')
      .withIndex('by_workspaceId_userId_providerKey', q =>
        q.eq('workspaceId', workspaceId).eq('userId', viewer.userId).eq('providerKey', SLACK_PROVIDER_KEY))
      .collect()
    // The viewer's own personal Slack connector, as the import route resolves it.
    const connected = connectors.some(row => row.archivedAt === undefined && row.scope !== 'workspace')
    const jobs = await ctx.db.query('slackImportJobs')
      .withIndex('by_workspaceId_createdAt', q => q.eq('workspaceId', workspaceId))
      .order('desc')
      .take(MAX_JOBS)
    return {
      connected,
      jobs: jobs.map(job => ({
        _id: job._id as string,
        status: job.status,
        selectedChannelIds: job.selectedChannelIds,
        ...(job.totalChannels !== undefined ? { totalChannels: job.totalChannels } : {}),
        ...(job.processedChannels !== undefined ? { processedChannels: job.processedChannels } : {}),
        ...(job.totalMessages !== undefined ? { totalMessages: job.totalMessages } : {}),
        ...(job.coverage ? { coverage: job.coverage } : {}),
        ...(job.error ? { error: job.error } : {}),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        ...(job.completedAt !== undefined ? { completedAt: job.completedAt } : {}),
      })),
    }
  },
})
