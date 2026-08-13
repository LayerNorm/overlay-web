'use node'

import { Daytona, type Sandbox } from '@daytona/sdk'
import { v } from 'convex/values'
import { internalAction, type ActionCtx } from '../../_generated/server'
import { internal } from '../../_generated/api'
import {
  detectDaytonaResourceProfileId,
  type DaytonaWorkspaceState,
  type DaytonaWorkspaceTier,
} from '../../../src/shared/ai/sandbox/daytona-pricing'

const OVERLAY_WORKSPACE_LABELS = {
  overlay: 'true',
  'overlay.kind': 'workspace',
} as const

const WORKSPACE_MOUNT_PATH = '/home/daytona/workspace'
const LIST_PAGE_LIMIT = 100

type StoredWorkspace = {
  _id: string
  userId: string
  sandboxId: string
  sandboxName: string
  volumeId: string
  volumeName: string
  tier: DaytonaWorkspaceTier
  state: DaytonaWorkspaceState
  resourceProfile: DaytonaWorkspaceTier
  mountPath: string
  lastMeteredAt?: number
  lastKnownStartedAt?: number
  lastKnownStoppedAt?: number
  createdAt: number
  updatedAt: number
}

type Entitlements = {
  tier: 'free' | 'pro' | 'max'
  creditsUsed: number
  creditsTotal: number
}

type ReconcileSummary = {
  scanned: number
  metered: number
  stoppedForCredits: number
  adopted: number
  missing: number
  errors: number
}

type VolumeMetadata = {
  volumeId: string
  volumeName: string
  mountPath: string
}

let daytonaClient: Daytona | null = null

function getDaytonaClient(): Daytona {
  if (daytonaClient) return daytonaClient

  const apiKey = process.env.DAYTONA_API_KEY?.trim()
  const apiUrl = process.env.DAYTONA_API_URL?.trim()

  if (!apiKey) {
    throw new Error('DAYTONA_API_KEY is not configured.')
  }
  if (!apiUrl) {
    throw new Error('DAYTONA_API_URL is not configured.')
  }

  daytonaClient = new Daytona({ apiKey, apiUrl })
  return daytonaClient
}

function isPaidTier(value: string | undefined | null): value is DaytonaWorkspaceTier {
  return value === 'pro' || value === 'max'
}

function sanitizeDaytonaName(value: string, maxLength = 55): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  return (normalized || 'overlay-workspace').slice(0, maxLength)
}

function getWorkspaceVolumeName(userId: string): string {
  return sanitizeDaytonaName(`overlay-user-${userId}-workspace`)
}

function normalizeSandboxState(state: Sandbox['state'] | undefined): DaytonaWorkspaceState {
  switch (state) {
    case 'started':
      return 'started'
    case 'stopped':
      return 'stopped'
    case 'archived':
      return 'archived'
    case 'destroyed':
      return 'missing'
    case 'starting':
    case 'stopping':
    case 'creating':
    case 'restoring':
    case 'resizing':
    case 'pending_build':
      return 'provisioning'
    case 'error':
    case 'build_failed':
      return 'error'
    default:
      return 'provisioning'
  }
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readSandboxLabel(sandbox: Sandbox, key: string): string | null {
  const labels = (sandbox as unknown as { labels?: Record<string, string> }).labels
  return labels && typeof labels[key] === 'string' ? labels[key]!.trim() : null
}

function resolveActualResourceProfile(
  sandbox: Sandbox,
  fallback: DaytonaWorkspaceTier,
): DaytonaWorkspaceTier {
  return detectDaytonaResourceProfileId({
    cpu: sandbox.cpu,
    memoryGiB: sandbox.memory,
    diskGiB: sandbox.disk,
  }) ?? fallback
}

function getMountedVolumeMetadata(
  sandbox: Sandbox,
  userId: string,
  storedWorkspace?: StoredWorkspace | null,
): VolumeMetadata {
  const volumes = Array.isArray((sandbox as unknown as { volumes?: unknown[] }).volumes)
    ? ((sandbox as unknown as { volumes?: unknown[] }).volumes as Array<Record<string, unknown>>)
    : []

  const selectedVolume =
    volumes.find((entry) => readString(entry.mountPath) === WORKSPACE_MOUNT_PATH) ??
    volumes[0] ??
    {}

  const fallbackVolumeName = storedWorkspace?.volumeName || getWorkspaceVolumeName(userId)

  return {
    volumeId:
      readString(selectedVolume.volumeId) ||
      readString(selectedVolume.id) ||
      readString(selectedVolume.name) ||
      storedWorkspace?.volumeId ||
      fallbackVolumeName,
    volumeName:
      readString(selectedVolume.volumeName) ||
      readString(selectedVolume.name) ||
      storedWorkspace?.volumeName ||
      fallbackVolumeName,
    mountPath:
      readString(selectedVolume.mountPath) ||
      readString(selectedVolume.path) ||
      storedWorkspace?.mountPath ||
      WORKSPACE_MOUNT_PATH,
  }
}

async function listOverlayWorkspaces(): Promise<Sandbox[]> {
  const out: Sandbox[] = []
  for await (const sandbox of getDaytonaClient().list({
    labels: OVERLAY_WORKSPACE_LABELS,
    limit: LIST_PAGE_LIMIT,
  })) {
    out.push(sandbox)
  }

  return out
}

async function syncWorkspace(
  ctx: ActionCtx,
  params: {
    existingWorkspace?: StoredWorkspace | null
    userId: string
    tier: DaytonaWorkspaceTier
    sandbox: Sandbox
    state: DaytonaWorkspaceState
    volume: VolumeMetadata
    lastMeteredAt?: number
    lastKnownStartedAt?: number
    lastKnownStoppedAt?: number
  },
): Promise<StoredWorkspace | null> {
  const result = await ctx.runMutation(internal.ai.sandbox.daytona.reconcileWorkspaceByServer, {
    userId: params.userId,
    sandboxId: params.sandbox.id,
    sandboxName: params.sandbox.name,
    volumeId: params.volume.volumeId,
    volumeName: params.volume.volumeName,
    tier: params.tier,
    state: params.state,
    resourceProfile: resolveActualResourceProfile(params.sandbox, params.tier),
    mountPath: params.volume.mountPath,
    lastMeteredAt: params.lastMeteredAt,
    lastKnownStartedAt: params.lastKnownStartedAt,
    lastKnownStoppedAt: params.lastKnownStoppedAt,
    expectedUpdatedAt: params.existingWorkspace?.updatedAt,
  })

  return result?.success ? (result.workspace as StoredWorkspace) : null
}

function workspaceNeedsSync(
  workspace: StoredWorkspace,
  params: {
    sandbox: Sandbox
    state: DaytonaWorkspaceState
    tier: DaytonaWorkspaceTier
    volume: VolumeMetadata
    lastMeteredAt?: number
    lastKnownStartedAt?: number
    lastKnownStoppedAt?: number
  },
): boolean {
  return workspace.sandboxId !== params.sandbox.id
    || workspace.sandboxName !== params.sandbox.name
    || workspace.volumeId !== params.volume.volumeId
    || workspace.volumeName !== params.volume.volumeName
    || workspace.tier !== params.tier
    || workspace.state !== params.state
    || workspace.resourceProfile !== resolveActualResourceProfile(params.sandbox, params.tier)
    || workspace.mountPath !== params.volume.mountPath
    || workspace.lastMeteredAt !== params.lastMeteredAt
    || workspace.lastKnownStartedAt !== params.lastKnownStartedAt
    || workspace.lastKnownStoppedAt !== params.lastKnownStoppedAt
}

async function accrueRuntimeWindow(
  ctx: ActionCtx,
  workspace: StoredWorkspace,
  sandbox: Sandbox,
  startedAt: number,
  endedAt: number,
) {
  if (endedAt <= startedAt) {
    return {
      success: false as const,
      skipped: 'empty_window' as const,
    }
  }

  return await ctx.runMutation(internal.ai.sandbox.daytona.accrueUsageInternal, {
    userId: workspace.userId,
    sandboxId: sandbox.id,
    tier: workspace.tier,
    resourceProfile: resolveActualResourceProfile(sandbox, workspace.resourceProfile),
    startedAt,
    endedAt,
    cpu: sandbox.cpu,
    memoryGiB: sandbox.memory,
    diskGiB: sandbox.disk,
    expectedLastMeteredAt: workspace.lastMeteredAt,
    reason: 'reconcile',
  })
}

async function getEntitlements(
  ctx: ActionCtx,
  userId: string,
  cache: Map<string, Entitlements>,
): Promise<Entitlements> {
  const cached = cache.get(userId)
  if (cached) return cached

  const entitlements = await ctx.runQuery(internal.platform.usage.getEntitlementsInternal, { userId }) as Entitlements
  cache.set(userId, entitlements)
  return entitlements
}

export const runMinuteTick = internalAction({
  args: {},
  returns: v.object({
    scanned: v.number(),
    metered: v.number(),
    stoppedForCredits: v.number(),
    adopted: v.number(),
    missing: v.number(),
    errors: v.number(),
  }),
  handler: async (ctx): Promise<ReconcileSummary> => {
    const summary: ReconcileSummary = {
      scanned: 0,
      metered: 0,
      stoppedForCredits: 0,
      adopted: 0,
      missing: 0,
      errors: 0,
    }

    const now = Date.now()
    const plan = await ctx.runQuery(internal.ai.sandbox.daytona.getReconciliationPlanInternal, { now })
    if (!plan.shouldRun) return summary
    const entitlementsCache = new Map<string, Entitlements>()
    const storedWorkspaces = await ctx.runQuery(
      internal.ai.sandbox.daytona.listAllWorkspacesInternal,
      { fullSweep: plan.fullSweep },
    ) as StoredWorkspace[]
    const storedBySandboxId = new Map(storedWorkspaces.map((workspace) => [workspace.sandboxId, workspace]))
    const storedByUserId = new Map(storedWorkspaces.map((workspace) => [workspace.userId, workspace]))
    const seenLiveSandboxIds = new Set<string>()
    const processedUserIds = new Set<string>()

    const allLiveSandboxes = await listOverlayWorkspaces()
    const liveSandboxes = plan.fullSweep
      ? allLiveSandboxes
      : allLiveSandboxes.filter((sandbox) => (
          storedBySandboxId.has(sandbox.id)
          || ['started', 'provisioning', 'error'].includes(normalizeSandboxState(sandbox.state))
        ))

    for (const listedSandbox of liveSandboxes) {
      summary.scanned += 1
      try {
        const sandbox =
          typeof (listedSandbox as unknown as { refreshData?: unknown }).refreshData === 'function'
            ? listedSandbox
            : await getDaytonaClient().get(listedSandbox.id)

        seenLiveSandboxIds.add(sandbox.id)

        let workspace = storedBySandboxId.get(sandbox.id) ?? null
        const labeledUserId = readSandboxLabel(sandbox, 'overlay.userId')
        const userId = workspace?.userId ?? labeledUserId
        const labeledTier = readSandboxLabel(sandbox, 'overlay.tier')
        const tier = workspace?.tier ?? (isPaidTier(labeledTier) ? labeledTier : null)

        if (!userId || !tier) {
          summary.errors += 1
          console.error('[DaytonaReconcile] Missing workspace labels for sandbox', {
            sandboxId: sandbox.id,
            labeledUserId,
            labeledTier,
          })
          continue
        }

        if (!workspace) {
          workspace = storedByUserId.get(userId) ?? null
        }

        await sandbox.refreshData()

        if (
          sandbox.state === 'error' &&
          (sandbox as unknown as { recoverable?: boolean }).recoverable === true &&
          typeof (sandbox as unknown as { recover?: () => Promise<void> }).recover === 'function'
        ) {
          try {
            await (sandbox as unknown as { recover: () => Promise<void> }).recover()
            await sandbox.refreshData()
          } catch (error) {
            summary.errors += 1
            console.error('[DaytonaReconcile] Failed to recover sandbox', {
              sandboxId: sandbox.id,
              userId,
              error,
            })
          }
        }

        let normalizedState = normalizeSandboxState(sandbox.state)
        const updatedAt = parseTimestamp((sandbox as unknown as { updatedAt?: unknown }).updatedAt)
        const volume = getMountedVolumeMetadata(sandbox, userId, workspace)

        if (!workspace) {
          workspace = await syncWorkspace(ctx, {
            userId,
            tier,
            sandbox,
            state: normalizedState,
            volume,
            lastMeteredAt: normalizedState === 'started' ? now : undefined,
            lastKnownStartedAt: normalizedState === 'started' ? now : undefined,
            lastKnownStoppedAt:
              normalizedState === 'stopped' || normalizedState === 'archived'
                ? (updatedAt ?? now)
                : undefined,
          })
          if (workspace) {
            summary.adopted += 1
            storedByUserId.set(userId, workspace)
            storedBySandboxId.set(workspace.sandboxId, workspace)
          }
        }

        if (!workspace) {
          summary.errors += 1
          console.error('[DaytonaReconcile] Failed to adopt workspace', {
            sandboxId: sandbox.id,
            userId,
          })
          continue
        }

        processedUserIds.add(userId)

        if (normalizedState === 'started') {
          const entitlements = await getEntitlements(ctx, userId, entitlementsCache)
          const accessRevoked = entitlements.tier === 'free'
          const creditsExhausted =
            entitlements.creditsTotal > 0 &&
            entitlements.creditsUsed >= entitlements.creditsTotal * 100
          if (accessRevoked || creditsExhausted) {
            if (typeof workspace.lastMeteredAt === 'number' && now > workspace.lastMeteredAt) {
              const metered = await accrueRuntimeWindow(ctx, workspace, sandbox, workspace.lastMeteredAt, now)
              if (metered?.success) {
                summary.metered += 1
                workspace = {
                  ...workspace,
                  lastMeteredAt: now,
                  updatedAt: typeof metered.updatedAt === 'number' ? metered.updatedAt : workspace.updatedAt,
                }
              }
            }

            await sandbox.stop(60)
            await sandbox.refreshData()
            normalizedState = normalizeSandboxState(sandbox.state)
            summary.stoppedForCredits += 1
          } else if (typeof workspace.lastMeteredAt === 'number' && now > workspace.lastMeteredAt) {
            const metered = await accrueRuntimeWindow(ctx, workspace, sandbox, workspace.lastMeteredAt, now)
            if (metered?.success) {
              summary.metered += 1
              workspace = {
                ...workspace,
                lastMeteredAt: now,
                updatedAt: typeof metered.updatedAt === 'number' ? metered.updatedAt : workspace.updatedAt,
              }
            }
          }
        } else if (
          (normalizedState === 'stopped' || normalizedState === 'archived') &&
          workspace.state === 'started' &&
          typeof workspace.lastMeteredAt === 'number' &&
          typeof updatedAt === 'number' &&
          updatedAt > workspace.lastMeteredAt
        ) {
          const metered = await accrueRuntimeWindow(ctx, workspace, sandbox, workspace.lastMeteredAt, updatedAt)
          if (metered?.success) {
            summary.metered += 1
            workspace = {
              ...workspace,
              lastMeteredAt: updatedAt,
              updatedAt: typeof metered.updatedAt === 'number' ? metered.updatedAt : workspace.updatedAt,
            }
          }
        }

        const syncState = {
          sandbox,
          state: normalizedState,
          tier,
          volume,
          lastMeteredAt:
            normalizedState === 'started'
              ? (workspace.lastMeteredAt ?? now)
              : workspace.lastMeteredAt,
          lastKnownStartedAt:
            normalizedState === 'started'
              ? (workspace.lastKnownStartedAt ?? now)
              : workspace.lastKnownStartedAt,
          lastKnownStoppedAt:
            normalizedState === 'stopped' || normalizedState === 'archived'
              ? (updatedAt ?? now)
              : workspace.lastKnownStoppedAt,
        }
        const syncedWorkspace = workspaceNeedsSync(workspace, syncState)
          ? await syncWorkspace(ctx, {
              existingWorkspace: workspace,
              userId,
              ...syncState,
            })
          : workspace

        if (syncedWorkspace) {
          storedByUserId.set(userId, syncedWorkspace)
          storedBySandboxId.set(syncedWorkspace.sandboxId, syncedWorkspace)
        }
      } catch (error) {
        summary.errors += 1
        console.error('[DaytonaReconcile] Failed to reconcile workspace', {
          sandboxId: listedSandbox.id,
          error,
        })
      }
    }

    for (const workspace of storedWorkspaces) {
      if (processedUserIds.has(workspace.userId) || seenLiveSandboxIds.has(workspace.sandboxId)) {
        continue
      }
      if (workspace.state === 'missing') continue

      try {
        const markedMissing = await ctx.runMutation(internal.ai.sandbox.daytona.reconcileWorkspaceByServer, {
          userId: workspace.userId,
          sandboxId: workspace.sandboxId,
          sandboxName: workspace.sandboxName,
          volumeId: workspace.volumeId,
          volumeName: workspace.volumeName,
          tier: workspace.tier,
          state: 'missing',
          resourceProfile: workspace.resourceProfile,
          mountPath: workspace.mountPath,
          lastMeteredAt: workspace.lastMeteredAt,
          lastKnownStartedAt: workspace.lastKnownStartedAt,
          lastKnownStoppedAt: workspace.lastKnownStoppedAt,
          expectedUpdatedAt: workspace.updatedAt,
        })

        if (markedMissing?.success) {
          summary.missing += 1
        }
      } catch (error) {
        summary.errors += 1
        console.error('[DaytonaReconcile] Failed to mark missing workspace', {
          sandboxId: workspace.sandboxId,
          userId: workspace.userId,
          error,
        })
      }
    }

    return summary
  },
})
