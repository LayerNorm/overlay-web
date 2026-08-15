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

      const client = new ComposioSlackClient()
      const channels = await client.listAllChannels(connectedAccountId)

      const mapped = channels.map((ch: SlackChannelResponse) => ({
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
        },
      )
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }
      return NextResponse.json(job)
    }

    // Default: action=jobs — list import jobs for the workspace
    const jobs = await convex.query<SlackImportJobResponse[]>(
      'imports/slackJobs:listJobs',
      {
        workspaceId,
        userId,
        accessToken: context.auth.accessToken,
        limit: 20,
      },
    ) ?? []

    return NextResponse.json({ jobs })
  } catch (error) {
    logger.error('[SlackImport] GET failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Slack import data' },
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

    // Start the backfill worker in the background.
    // We don't await it — the client subscribes to Convex for progress updates.
    const worker = new SlackBackfillWorker()
    void worker.processJob({
      _id: jobRow._id,
      userId: jobRow.userId,
      workspaceId: jobRow.workspaceId,
      connectedAccountId: jobRow.connectedAccountId,
      selectedChannelIds: jobRow.selectedChannelIds,
      createdAt: jobRow.createdAt,
    }).catch((err) => {
      logger.error(`[SlackImport] Background worker failed for job ${jobId}:`, err)
    })

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
