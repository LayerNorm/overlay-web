import 'server-only'

import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ComposioSlackClient } from '@/server/imports/slack/composioClient'
import { SlackBackfillWorker } from '@/server/imports/slack/backfillWorker'
import type { Id } from '../../../../../../convex/_generated/dataModel'

const SLACK_PROVIDER_KEY = 'slackbot'

interface SlackChannelResponse {
  id: string
  name?: string
  is_channel?: boolean
  is_group?: boolean
  is_im?: boolean
  is_mpim?: boolean
  is_private?: boolean
  num_members?: number
}

interface SlackImportJobResponse {
  _id: string
  status: string
  selectedChannelIds: string[]
  totalChannels?: number
  processedChannels?: number
  totalMessages?: number
  coverage?: {
    publicChannels: number
    privateChannels: number
    dms: number
    mpims: number
    messagesImported: number
    filesDownloaded: number
    threadsImported: number
  }
  error?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
}

/**
 * Resolve the Composio connected_account_id for Slack in the active workspace.
 * Returns null if Slack is not connected.
 */
async function resolveSlackConnectedAccount(
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const workspaceConnectors = getOverlayServerContext().appData.repositories.workspaceConnectors
  const mappings = await workspaceConnectors.listByWorkspace({ workspaceId, userId })
  const slackMapping = mappings.find((m) => m.providerKey === SLACK_PROVIDER_KEY)
  return slackMapping?.connectedAccountId ?? null
}

/**
 * GET /api/v1/imports/slack
 * Query params:
 *   - action=channels&connectedAccountId=...  → list Slack channels
 *   - action=jobs                             → list import jobs for workspace
 *   - action=job&jobId=...                    → get a single job
 */
export async function GET(
  request: NextRequest,
  context: AppApiRouteContext,
) {
  try {
    const { searchParams } = request.nextUrl
    const action = searchParams.get('action') ?? 'jobs'
    const workspaceId = context.workspace.workspace.id
    const userId = context.auth.userId

    if (action === 'channels') {
      // Resolve connected account from workspace connectors if not provided
      const connectedAccountId =
        searchParams.get('connectedAccountId')?.trim() ||
        (await resolveSlackConnectedAccount(workspaceId, userId))

      if (!connectedAccountId) {
        return NextResponse.json(
          { error: 'Slack is not connected. Connect Slack via the integrations page first.' },
          { status: 400 },
        )
      }

      // Use single-page listing (200 channels) to avoid Vercel function timeouts.
      // The Composio API can be slow, and paginating through all channels
      // exceeds the serverless function timeout.
      const client = new ComposioSlackClient()
      const cursor = searchParams.get('cursor')?.trim() || undefined
      const page = await client.listChannels(connectedAccountId, userId, { cursor })

      const mapped = page.items.map((ch: SlackChannelResponse) => ({
        id: ch.id,
        name: ch.name || ch.id,
        type: ch.is_mpim
          ? 'mpim'
          : ch.is_im
            ? 'im'
            : ch.is_private || ch.is_group
              ? 'private_channel'
              : 'public_channel',
        isPrivate: ch.is_private ?? false,
        memberCount: ch.num_members ?? 0,
      }))

      return NextResponse.json({
        channels: mapped,
        total: mapped.length,
        connectedAccountId,
        nextCursor: page.nextCursor,
        hasMore: page.nextCursor !== null,
      })
    }

    if (action === 'job') {
      const jobId = searchParams.get('jobId')
      if (!jobId) {
        return NextResponse.json({ error: 'jobId required' }, { status: 400 })
      }
      const job = await convex.query<SlackImportJobResponse | null>(
        'imports/slackJobs:getJob',
        {
          jobId: jobId as Id<'slackImportJobs'>,
          userId,
          accessToken: context.auth.accessToken,
          serverSecret: getInternalApiSecret(),
        },
      )
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }
      return NextResponse.json(job)
    }

    // Default: action=jobs — list import jobs for the workspace
    // Also checks Slack connection status so the client can use this
    // as a lightweight connection check without calling the integrations catalog.
    const connectedAccountId = await resolveSlackConnectedAccount(workspaceId, userId)
    if (!connectedAccountId) {
      return NextResponse.json(
        { error: 'Slack is not connected. Connect Slack via the integrations page first.' },
        { status: 400 },
      )
    }

    const jobs = await convex.query<SlackImportJobResponse[]>(
      'imports/slackJobs:listJobs',
      {
        workspaceId,
        userId,
        accessToken: context.auth.accessToken,
        serverSecret: getInternalApiSecret(),
        limit: 20,
      },
    ) ?? []

    return NextResponse.json({ jobs, connected: true })
  } catch (error) {
    logger.error('[SlackImport] GET failed:', error)
    const errMsg = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof error === 'object' && error !== null
          ? JSON.stringify(error).substring(0, 500)
          : 'Failed to fetch Slack import data'
    return NextResponse.json(
      { error: errMsg },
      { status: 502 },
    )
  }
}

/**
 * POST /api/v1/imports/slack
 * Body:
 *   - action=start   → { connectedAccountId?, selectedChannelIds } → create job + start worker
 *   - action=cancel  → { jobId } → cancel a running job
 */
export async function POST(
  request: NextRequest,
  context: AppApiRouteContext,
) {
  try {
    const body = await request.json() as {
      action?: string
      connectedAccountId?: string
      selectedChannelIds?: string[]
      jobId?: string
    }
    const action = body.action ?? 'start'
    const workspaceId = context.workspace.workspace.id
    const userId = context.auth.userId

    if (action === 'cancel') {
      const jobId = body.jobId
      if (!jobId) {
        return NextResponse.json({ error: 'jobId required' }, { status: 400 })
      }
      const cancelled = await convex.mutation<boolean>(
        'imports/slackJobs:cancelJob',
        {
          jobId: jobId as Id<'slackImportJobs'>,
          userId,
          accessToken: context.auth.accessToken,
          serverSecret: getInternalApiSecret(),
        },
      )
      if (!cancelled) {
        return NextResponse.json({ error: 'Job not found or already completed' }, { status: 404 })
      }
      return NextResponse.json({ success: true })
    }

    // action === 'start'
    const selectedChannelIds = body.selectedChannelIds
    if (!selectedChannelIds || !Array.isArray(selectedChannelIds) || selectedChannelIds.length === 0) {
      return NextResponse.json({ error: 'selectedChannelIds required (non-empty array)' }, { status: 400 })
    }

    // Resolve connected account
    const connectedAccountId =
      body.connectedAccountId?.trim() ||
      (await resolveSlackConnectedAccount(workspaceId, userId))

    if (!connectedAccountId) {
      return NextResponse.json(
        { error: 'Slack is not connected. Connect Slack via the integrations page first.' },
        { status: 400 },
      )
    }

    // Create the job in Convex
    const serverSecret = getInternalApiSecret()
    const result = await convex.mutation<{ jobId: string }>(
      'imports/slackJobs:createJob',
      {
        userId,
        workspaceId,
        connectedAccountId,
        selectedChannelIds,
        serverSecret,
      },
      { throwOnError: true },
    )

    if (!result?.jobId) {
      throw new Error('Failed to create import job')
    }

    const jobId = result.jobId as Id<'slackImportJobs'>

    // Fetch the full job row for the worker
    const jobRow = await convex.query<{
      _id: string
      userId: string
      workspaceId: string
      connectedAccountId: string
      selectedChannelIds: string[]
      createdAt: number
    } | null>('imports/slackJobs:getJob', {
      jobId,
      userId,
      serverSecret,
    })

    if (!jobRow) {
      throw new Error('Job created but could not be fetched')
    }

    // The backfill worker is processed by a Convex cron job that runs every
    // minute. The cron picks up queued jobs and calls the /process endpoint
    // which runs the full backfill worker with maxDuration=300s.
    // We don't use after() here because the Vercel function may not stay
    // alive long enough for a full backfill. The cron provides reliability.

    logger.info(`[SlackImport] Started import job ${jobId} for workspace ${workspaceId}`)

    return NextResponse.json({
      jobId,
      status: 'queued',
      selectedChannelIds,
      totalChannels: selectedChannelIds.length,
    })
  } catch (error) {
    logger.error('[SlackImport] POST failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start Slack import' },
      { status: 502 },
    )
  }
}

/**
 * Internal POST /api/v1/imports/slack/process
 * Called by the Convex cron action (with x-internal-api-secret) to
 * process a queued or stuck Slack import job. This runs the full
 * backfill worker synchronously — the cron action waits for completion.
 */
export async function POST_process(request: NextRequest) {
  try {
    const internalSecret = request.headers.get('x-internal-api-secret')?.trim()
    const expectedSecret = getInternalApiSecret()
    if (!internalSecret || internalSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as {
      jobId: string
      userId: string
      workspaceId: string
      connectedAccountId: string
      selectedChannelIds: string[]
      createdAt: number
    }

    logger.info(`[SlackImport] Processing job ${body.jobId} (${body.selectedChannelIds.length} channels)`)

    const worker = new SlackBackfillWorker()
    await worker.processJob({
      _id: body.jobId as Id<'slackImportJobs'>,
      userId: body.userId,
      workspaceId: body.workspaceId,
      connectedAccountId: body.connectedAccountId,
      selectedChannelIds: body.selectedChannelIds,
      createdAt: body.createdAt,
    })

    return NextResponse.json({ success: true, jobId: body.jobId })
  } catch (error) {
    logger.error('[SlackImport] Process endpoint failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process Slack import' },
      { status: 502 },
    )
  }
}
