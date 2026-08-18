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
type AuthorStatus = 'member' | 'invited' | 'not_invited'

export class SlackBackfillWorker {
  private client: ComposioSlackClient
  private userCache = new SlackUserCache()
  private authorStatusByEmail = new Map<string, AuthorStatus>()
  private actorPrincipalId: string | null = null
  private actorEmail: string | null = null
  private actorDisplayName: string | null = null
  private actorSlackUserId: string | null = null
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
      await this.resolveActor(job.workspaceId, job.userId)
      await this.resolveAuthorStatuses(job.workspaceId)

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
   * Resolve, once per job, the authenticated importer's principal and Slack
   * identity so their own imported messages can be attributed to them (first person).
   */
  private async resolveActor(workspaceId: string, actorUserId: string): Promise<void> {
    try {
      const actor = await convex.query<{
        principalId: string
        email?: string
        displayName?: string
      } | null>(
        'imports/slackImporter:getSlackImportActor',
        { workspaceId, actorUserId, serverSecret: this.serverSecret },
      )
      if (actor) {
        this.actorPrincipalId = actor.principalId
        this.actorEmail = actor.email?.toLowerCase().trim() || null
        this.actorDisplayName = actor.displayName?.trim() || null
        this.actorSlackUserId = this.userCache.findUserIdByIdentity({
          email: this.actorEmail,
          displayName: this.actorDisplayName,
        })
      }
    } catch (err) {
      logger.warn('[SlackBackfill] Failed to resolve actor:', err)
    }
  }

  /**
   * Resolve, once per job, whether each Slack author's email maps to an active
   * workspace member, a pending invitation, or nobody. Used to tag every
   * imported message so the UI can show the author's status.
   */
  private async resolveAuthorStatuses(workspaceId: string): Promise<void> {
    const emails = this.userCache.allEmails()
    if (emails.length === 0) return
    try {
      const rows = await convex.query<Array<{ email: string; status: AuthorStatus }>>(
        'imports/slackImporter:resolveAuthorStatuses',
        { workspaceId, emails, serverSecret: this.serverSecret },
      )
      for (const row of rows ?? []) {
        this.authorStatusByEmail.set(row.email, row.status)
      }
      // Always treat the authenticated importer as an active member, even if
      // their Slack email does not appear in the workspace-principal cache.
      if (this.actorEmail) {
        this.authorStatusByEmail.set(this.actorEmail, 'member')
      }
    } catch (err) {
      logger.warn('[SlackBackfill] Failed to resolve author statuses:', err)
    }
  }

  /**
   * Build the imported-author metadata for a normalized message so the message
   * carries its real author's name, email, and workspace-membership status.
   */
  private importedAuthorFields(normalized: {
    sourceUserId: string
    sourceUserName: string
    sourceUserEmail: string | null
  }): {
    importedAuthorName: string
    importedAuthorEmail?: string
    importedAuthorStatus: AuthorStatus
    authorKind?: 'human'
    authorPrincipalId?: string
  } {
    const email = normalized.sourceUserEmail
    const isOwnMessageBySlackId = Boolean(
      normalized.sourceUserId && this.actorSlackUserId
      && normalized.sourceUserId === this.actorSlackUserId,
    )
    const isOwnMessageByEmail = Boolean(email && this.actorEmail && email === this.actorEmail)
    const isOwnMessageByName = Boolean(
      !this.actorSlackUserId
      && this.actorDisplayName
      && normalizeIdentityText(normalized.sourceUserName) === normalizeIdentityText(this.actorDisplayName),
    )
    const isOwnMessage = isOwnMessageBySlackId || isOwnMessageByEmail || isOwnMessageByName
    const status = isOwnMessage
      ? 'member'
      : (email && this.authorStatusByEmail.get(email)) || 'not_invited'
    return {
      importedAuthorName: normalized.sourceUserName,
      ...(email ? { importedAuthorEmail: email } : {}),
      importedAuthorStatus: status,
      ...(isOwnMessage && this.actorPrincipalId
        ? { authorKind: 'human' as const, authorPrincipalId: this.actorPrincipalId }
        : {}),
    }
  }

  /**
   * Re-apply imported-author metadata to a message found during a resumed
   * import. This repairs messages written by older importer revisions without
   * inserting duplicates.
   */
  private async repairImportedMessage(
    conversationId: string,
    userId: string,
    normalized: ReturnType<typeof normalizeMessage>,
  ): Promise<void> {
    await convex.mutation('chat/conversations:addMessage', {
      conversationId: conversationId as Id<'conversations'>,
      userId,
      turnId: normalized.turnId,
      role: normalized.role,
      mode: 'ask',
      content: normalized.content,
      contentType: 'text',
      parts: [],
      skipMemoryExtraction: true,
      ...this.importedAuthorFields(normalized),
      serverSecret: this.serverSecret,
    })
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

    const normalized = normalizeChannel(channel, workspaceId, this.userCache)

    // Create the right conversation type. DMs/MPIMs become conversationType='dm'
    // so they appear under Direct Messages; public/private channels stay as
    // conversationType='channel'. The mutations are idempotent by clientId and
    // heal any previous mis-typed or archived conversation.
    const conversationId: Id<'conversations'> =
      channelType === 'im' || channelType === 'mpim'
        ? (await convex.mutation<Id<'conversations'>>(
            'imports/slackImporter:createSlackDirectMessage',
            {
              actorUserId: userId,
              workspaceId,
              title: normalized.title,
              clientId: normalized.clientId,
              serverSecret: this.serverSecret,
            },
            { throwOnError: true },
          ) as Id<'conversations'>)
        : (await convex.mutation<Id<'conversations'>>(
            'imports/slackImporter:createSlackChannel',
            {
              actorUserId: userId,
              workspaceId,
              title: normalized.title,
              clientId: normalized.clientId,
              visibility:
                channel.is_private || channel.is_group ? 'private' : 'public',
              serverSecret: this.serverSecret,
            },
            { throwOnError: true },
          ) as Id<'conversations'>)

    if (!conversationId) throw new Error('Failed to create conversation')

    logger.info(`[SlackBackfill] Created/resolved conversation ${conversationId} for ${channelId} (${normalized.title})`)

    // Fetch all messages and import them
    let messagesImported = 0
    let filesDownloaded = 0
    let threadsImported = 0

    await this.client.fetchAllHistory(connectedAccountId, userId, channelId, async (pageMessages) => {
      // Slack IM metadata identifies the other participant. If the connected
      // account's profile email differs from the Overlay owner email, infer the
      // authenticated Slack user from the other author in the DM history.
      if (channelType === 'im' && !this.actorSlackUserId && channel.user) {
        const candidate = pageMessages
          .map((message) => message.user)
          .find((sourceUserId) => sourceUserId && sourceUserId !== channel.user && !this.userCache.isBot(sourceUserId))
        if (candidate) this.actorSlackUserId = candidate
      }

      for (const msg of pageMessages) {
        if (shouldSkipMessage(msg)) continue

        const normalized = normalizeMessage(msg, this.userCache)

        // Check for existing mapping (dedup)
        const existingMapping = await convex.query<{ conversationId: string; messageId?: string } | null>(
          'imports/slackMappings:findExisting',
          {
            workspaceId,
            sourceChannelId: channelId,
            sourceMessageTs: normalized.sourceMessageTs,
            serverSecret: this.serverSecret,
          },
        )

        if (existingMapping) {
          // Resume imports also repair author metadata written by an older
          // importer revision, while addMessage keeps the row idempotent.
          await this.repairImportedMessage(existingMapping.conversationId, userId, normalized)
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
            ...this.importedAuthorFields(normalized),
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
              otherSlackUserId: channelType === 'im' ? channel.user : undefined,
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
    otherSlackUserId?: string
  }): Promise<number> {
    const { connectedAccountId, channelId, threadTs, conversationId, workspaceId, userId, jobId, otherSlackUserId } = args

    const replies = await this.client.fetchAllThread(connectedAccountId, userId, channelId, threadTs)
    if (!this.actorSlackUserId && otherSlackUserId) {
      const candidate = replies
        .map((message) => message.user)
        .find((sourceUserId) => sourceUserId && sourceUserId !== otherSlackUserId && !this.userCache.isBot(sourceUserId))
      if (candidate) this.actorSlackUserId = candidate
    }

    let imported = 0
    // Skip the first message — it's the parent, already imported
    for (let i = 1; i < replies.length; i++) {
      const reply = replies[i]!
      if (shouldSkipMessage(reply)) continue

      const normalized = normalizeMessage(reply, this.userCache)

      // Dedup check
      const existing = await convex.query<{ conversationId: string; messageId?: string } | null>(
        'imports/slackMappings:findExisting',
        {
          workspaceId,
          sourceChannelId: channelId,
          sourceMessageTs: normalized.sourceMessageTs,
          serverSecret: this.serverSecret,
        },
      )
      if (existing) {
        await this.repairImportedMessage(existing.conversationId, userId, normalized)
        continue
      }

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
          ...this.importedAuthorFields(normalized),
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

function normalizeIdentityText(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') || ''
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type { BackfillJobRow, CoverageReport }
