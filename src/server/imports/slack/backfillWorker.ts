import 'server-only'

import { logger } from '@/server/observability/logger'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ComposioSlackClient } from './composioClient'
import type { SlackChannel } from './composioClient'
import { SlackUserCache, normalizeChannel, normalizeMessage, shouldSkipMessage } from './normalizer'
import type { NormalizedChannel } from './normalizer'
import type { Id } from '../../../../convex/_generated/dataModel'

const THREAD_DELAY_MS = 200

interface BackfillJobRow {
  _id: string
  userId: string
  workspaceId: string
  connectedAccountId: string
  selectedChannelIds: string[]
  createdAt: number
}

interface CoverageReport {
  publicChannels: number
  privateChannels: number
  dms: number
  mpims: number
  messagesImported: number
  filesDownloaded: number
  threadsImported: number
}

/**
 * The deterministic backfill worker. This is NOT an LLM agent loop —
 * it's ordinary application code that paginates through Slack's API
 * and writes normalized messages to Convex.
 */
export class SlackBackfillWorker {
  private client: ComposioSlackClient
  private userCache = new SlackUserCache()
  private serverSecret: string

  constructor() {
    this.client = new ComposioSlackClient()
    this.serverSecret = getInternalApiSecret()
  }

  /**
   * Process a single Slack import job end-to-end.
   * Called by the BFF route or a cron-triggered action.
   */
  async processJob(job: BackfillJobRow): Promise<void> {
    const jobId = job._id as Id<'slackImportJobs'>
    logger.info(`[SlackBackfill] Starting job ${jobId} for user ${job.userId}, ${job.selectedChannelIds.length} channels`)

    try {
      // Phase 1: Fetch users and channel metadata for name resolution
      await this.updateStatus(jobId, 'listing_channels')
      await this.fetchUsers(job.connectedAccountId, job.userId)

      // Fetch all channels once (used for metadata lookup per channel)
      const allChannels = await this.client.listAllChannels(job.connectedAccountId, job.userId)
      logger.info(`[SlackBackfill] Fetched ${allChannels.length} channels from Slack`)

      // Phase 2: Import each selected channel
      await this.updateStatus(jobId, 'importing', {
        totalChannels: job.selectedChannelIds.length,
        processedChannels: 0,
        totalMessages: 0,
      })

      const coverage: CoverageReport = {
        publicChannels: 0,
        privateChannels: 0,
        dms: 0,
        mpims: 0,
        messagesImported: 0,
        filesDownloaded: 0,
        threadsImported: 0,
      }

      let processedChannels = 0
      let totalMessages = 0

      for (const channelId of job.selectedChannelIds) {
        // Check if job was cancelled
        const current = await convex.query<{ status: string } | null>(
          'imports/slackJobs:getJob',
          { jobId, userId: job.userId, serverSecret: this.serverSecret },
        )
        if (current?.status === 'cancelled') {
          logger.info(`[SlackBackfill] Job ${jobId} was cancelled, stopping`)
          return
        }

        try {
          const result = await this.importChannel({
            jobId,
            workspaceId: job.workspaceId,
            userId: job.userId,
            connectedAccountId: job.connectedAccountId,
            channelId,
            allChannels,
          })

          // Update coverage
          if (result.channelType === 'public_channel') coverage.publicChannels++
          else if (result.channelType === 'private_channel') coverage.privateChannels++
          else if (result.channelType === 'im') coverage.dms++
          else if (result.channelType === 'mpim') coverage.mpims++

          coverage.messagesImported += result.messagesImported
          coverage.filesDownloaded += result.filesDownloaded
          coverage.threadsImported += result.threadsImported

          totalMessages += result.messagesImported
        } catch (err) {
          logger.error(`[SlackBackfill] Channel ${channelId} failed:`, err)
          // Continue with other channels even if one fails
        }

        processedChannels++
        await this.updateStatus(jobId, 'importing', {
          processedChannels,
          totalMessages,
        })
      }

      // Phase 3: Complete
      await this.updateStatus(jobId, 'completed', { coverage })
      logger.info(
        `[SlackBackfill] Job ${jobId} completed: ${coverage.messagesImported} messages, ` +
        `${coverage.filesDownloaded} files, ${coverage.threadsImported} threads`,
      )
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(`[SlackBackfill] Job ${jobId} failed:`, errorMsg)
      await this.updateStatus(jobId, 'failed', { error: errorMsg })
    }
  }

  /**
   * Fetch and cache all workspace users for name resolution.
   */
  private async fetchUsers(connectedAccountId: string, entityId: string): Promise<void> {
    logger.info(`[SlackBackfill] Fetching workspace users...`)
    const users = await this.client.listAllUsers(connectedAccountId, entityId)
    this.userCache.load(users)
    logger.info(`[SlackBackfill] Cached ${users.length} users`)
  }

  /**
   * Import a single channel: create conversation, fetch messages, fetch threads.
   */
  private async importChannel(args: {
    jobId: Id<'slackImportJobs'>
    workspaceId: string
    userId: string
    connectedAccountId: string
    channelId: string
    allChannels: SlackChannel[]
  }): Promise<{
    messagesImported: number
    filesDownloaded: number
    threadsImported: number
    channelType: NormalizedChannel['sourceType']
  }> {
    const { jobId, workspaceId, userId, connectedAccountId, channelId, allChannels } = args

    // Find channel metadata from the pre-fetched list
    const channel = allChannels.find((c) => c.id === channelId)
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`)
    }
    const channelType = channel.is_mpim ? 'mpim' : channel.is_im ? 'im' : channel.is_private || channel.is_group ? 'private_channel' : 'public_channel'

    // Check if we already have a conversation for this channel (resume support)
    const existing = await convex.query<{ conversationId: string } | null>(
      'imports/slackMappings:findChannelConversation',
      { importJobId: jobId, sourceChannelId: channelId, serverSecret: this.serverSecret },
    )

    let conversationId: Id<'conversations'>

    if (existing?.conversationId) {
      conversationId = existing.conversationId as Id<'conversations'>
      logger.info(`[SlackBackfill] Resuming channel ${channelId} → conversation ${conversationId}`)
    } else {
      const normalized = normalizeChannel(channel, workspaceId, this.userCache)

      if (channelType === 'im' || channelType === 'mpim') {
        // DM/MPIM import is not supported in the first pass: we need the other
        // participants to be active workspace members first, which requires the
        // user-import step to complete and invitees to accept. Skip for now.
        logger.info(`[SlackBackfill] Skipping DM/MPIM ${channelId} (${normalized.title}) — other participants are not workspace members yet`)
        return { messagesImported: 0, filesDownloaded: 0, threadsImported: 0, channelType }
      }

      // Create a proper workspace channel (conversationType='channel') with the
      // importer as the initial moderator. This is Phase A of the Slack import
      // rework: imported channels must appear in the Channels tab, not as
      // personal/direct-message chats.
      const visibility = channel.is_private || channel.is_group ? 'private' : 'public'
      conversationId = await convex.mutation<Id<'conversations'>>(
        'imports/slackImporter:createSlackChannel',
        {
          actorUserId: userId,
          workspaceId,
          title: normalized.title,
          clientId: normalized.clientId,
          visibility,
          serverSecret: this.serverSecret,
        },
        { throwOnError: true },
      ) as Id<'conversations'>

      if (!conversationId) throw new Error('Failed to create conversation')

      logger.info(`[SlackBackfill] Created workspace channel ${conversationId} for ${channelId} (${normalized.title})`)

    }

    // Fetch all messages and import them
    let messagesImported = 0
    let filesDownloaded = 0
    let threadsImported = 0

    await this.client.fetchAllHistory(connectedAccountId, userId, channelId, async (pageMessages) => {
      for (const msg of pageMessages) {
        if (shouldSkipMessage(msg)) continue

        const normalized = normalizeMessage(msg, this.userCache)

        // Check for existing mapping (dedup)
        const existingMapping = await convex.query<{ messageId?: string } | null>(
          'imports/slackMappings:findExisting',
          {
            workspaceId,
            sourceChannelId: channelId,
            sourceMessageTs: normalized.sourceMessageTs,
            serverSecret: this.serverSecret,
          },
        )

        if (existingMapping) {
          // Already imported, skip
          continue
        }

        // Insert the message
        const messageId = await convex.mutation<Id<'conversationMessages'> | null>(
          'chat/conversations:addMessage',
          {
            conversationId,
            userId,
            turnId: normalized.turnId,
            role: normalized.role,
            mode: 'ask',
            content: normalized.content,
            contentType: 'text',
            parts: [],
            skipMemoryExtraction: true,  // don't run memory extraction on imported messages
            serverSecret: this.serverSecret,
          },
        )

        // Record the mapping
        await convex.mutation('imports/slackMappings:insertMapping', {
          importJobId: jobId,
          workspaceId,
          sourceChannelId: channelId,
          sourceMessageTs: normalized.sourceMessageTs,
          conversationId,
          ...(messageId ? { messageId } : {}),
          serverSecret: this.serverSecret,
        })

        messagesImported++

        // Download files
        if (normalized.files.length > 0) {
          for (const file of normalized.files) {
            try {
              await this.client.downloadFile(connectedAccountId, userId, file.sourceFileId)
              filesDownloaded++
            } catch (err) {
              logger.warn(`[SlackBackfill] Failed to download file ${file.sourceFileId}:`, err)
            }
          }
        }

        // Fetch thread replies for thread parents
        if (normalized.isThreadParent && normalized.replyCount > 0) {
          try {
            const replies = await this.fetchAndImportThread({
              connectedAccountId,
              channelId,
              threadTs: normalized.sourceMessageTs,
              conversationId,
              workspaceId,
              userId,
              jobId,
            })
            threadsImported += replies
          } catch (err) {
            logger.warn(`[SlackBackfill] Failed to fetch thread for ts=${normalized.sourceMessageTs}:`, err)
          }
          await delay(THREAD_DELAY_MS)
        }
      }
    })

    logger.info(
      `[SlackBackfill] Channel ${channelId}: ${messagesImported} messages, ` +
      `${filesDownloaded} files, ${threadsImported} thread replies`,
    )

    return { messagesImported, filesDownloaded, threadsImported, channelType }
  }

  /**
   * Fetch thread replies and import them as messages in the same conversation.
   * The first message in the thread response is the parent (already imported),
   * so we skip it.
   */
  private async fetchAndImportThread(args: {
    connectedAccountId: string
    channelId: string
    threadTs: string
    conversationId: Id<'conversations'>
    workspaceId: string
    userId: string
    jobId: Id<'slackImportJobs'>
  }): Promise<number> {
    const { connectedAccountId, channelId, threadTs, conversationId, workspaceId, userId, jobId } = args

    const replies = await this.client.fetchAllThread(connectedAccountId, userId, channelId, threadTs)

    let imported = 0
    // Skip the first message — it's the parent, already imported
    for (let i = 1; i < replies.length; i++) {
      const reply = replies[i]!
      if (shouldSkipMessage(reply)) continue

      const normalized = normalizeMessage(reply, this.userCache)

      // Dedup check
      const existing = await convex.query<{ messageId?: string } | null>(
        'imports/slackMappings:findExisting',
        {
          workspaceId,
          sourceChannelId: channelId,
          sourceMessageTs: normalized.sourceMessageTs,
          serverSecret: this.serverSecret,
        },
      )
      if (existing) continue

      const messageId = await convex.mutation<Id<'conversationMessages'> | null>(
        'chat/conversations:addMessage',
        {
          conversationId,
          userId,
          turnId: normalized.turnId,
          role: normalized.role,
          mode: 'ask',
          content: normalized.content,
          contentType: 'text',
          parts: [],
          skipMemoryExtraction: true,
          serverSecret: this.serverSecret,
        },
      )

      await convex.mutation('imports/slackMappings:insertMapping', {
        importJobId: jobId,
        workspaceId,
        sourceChannelId: channelId,
        sourceMessageTs: normalized.sourceMessageTs,
        conversationId,
        ...(messageId ? { messageId } : {}),
        serverSecret: this.serverSecret,
      })

      imported++
    }

    return imported
  }

  /**
   * Update job status via Convex mutation.
   */
  private async updateStatus(
    jobId: Id<'slackImportJobs'>,
    status: 'queued' | 'listing_channels' | 'importing' | 'completed' | 'failed' | 'cancelled',
    extra?: {
      totalChannels?: number
      processedChannels?: number
      totalMessages?: number
      coverage?: CoverageReport
      error?: string
    },
  ): Promise<void> {
    await convex.mutation('imports/slackJobs:updateJobStatus', {
      jobId,
      status,
      ...(extra?.totalChannels !== undefined ? { totalChannels: extra.totalChannels } : {}),
      ...(extra?.processedChannels !== undefined ? { processedChannels: extra.processedChannels } : {}),
      ...(extra?.totalMessages !== undefined ? { totalMessages: extra.totalMessages } : {}),
      ...(extra?.coverage ? { coverage: extra.coverage } : {}),
      ...(extra?.error ? { error: extra.error } : {}),
      serverSecret: this.serverSecret,
    })
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type { BackfillJobRow, CoverageReport }
