import 'server-only'

import type { Sandbox } from '@daytonaio/sdk'
import { getDaytonaClient } from './daytona'
import { detectDaytonaResourceProfileId, type DaytonaWorkspaceState, type DaytonaWorkspaceTier } from './daytona-pricing'
import type { DaytonaWorkspaceRecord, DaytonaWorkspaceRepository } from './DaytonaWorkspaceRepository'

export const DAYTONA_RECONCILE_JOB = 'daytona.reconcile'

const WORKSPACE_LABELS = { overlay: 'true', 'overlay.kind': 'workspace' } as const
const WORKSPACE_MOUNT_PATH = '/home/daytona/workspace'

export type DaytonaReconcileSandbox = {
  cpu: number
  disk: number
  id: string
  labels?: Record<string, string>
  memory: number
  name: string
  state?: string
  updatedAt?: Date | number | string
  volumes?: Array<Record<string, unknown>>
}

export interface DaytonaReconciliationControlPlane {
  listOverlayWorkspaces(): Promise<DaytonaReconcileSandbox[]>
}

export type DaytonaReconciliationSummary = {
  adopted: number
  errors: number
  metered: number
  missing: number
  scanned: number
  stale: number
  updated: number
}

export class PostgresDaytonaReconciliationService {
  constructor(private readonly deps: {
    controlPlane: DaytonaReconciliationControlPlane
    now?: () => number
    repository: DaytonaWorkspaceRepository
  }) {}

  async reconcile(): Promise<DaytonaReconciliationSummary> {
    const summary: DaytonaReconciliationSummary = {
      adopted: 0,
      errors: 0,
      metered: 0,
      missing: 0,
      scanned: 0,
      stale: 0,
      updated: 0,
    }
    const now = this.deps.now?.() ?? Date.now()
    const stored = await this.deps.repository.listAll()
    const bySandboxId = new Map(stored.map((workspace) => [workspace.sandboxId, workspace]))
    const byUserId = new Map(stored.map((workspace) => [workspace.userId, workspace]))
    const seen = new Set<string>()
    const remote = await this.deps.controlPlane.listOverlayWorkspaces()

    for (const sandbox of remote) {
      summary.scanned += 1
      seen.add(sandbox.id)
      try {
        const existing = bySandboxId.get(sandbox.id)
          ?? byUserId.get(readLabel(sandbox, 'overlay.userId') ?? '')
        const userId = existing?.userId ?? readLabel(sandbox, 'overlay.userId')
        const tier = existing?.tier ?? readTier(readLabel(sandbox, 'overlay.tier'))
        if (!userId || !tier) throw new Error('Daytona workspace is missing Overlay ownership labels')
        const state = normalizeState(sandbox.state)
        const volume = volumeMetadata(sandbox, existing)
        const remoteUpdatedAt = timestamp(sandbox.updatedAt)
        const input = {
          userId,
          sandboxId: sandbox.id,
          sandboxName: sandbox.name,
          volumeId: volume.volumeId,
          volumeName: volume.volumeName,
          tier,
          state,
          resourceProfile: detectDaytonaResourceProfileId({
            cpu: sandbox.cpu,
            diskGiB: sandbox.disk,
            memoryGiB: sandbox.memory,
          }) ?? existing?.resourceProfile ?? tier,
          mountPath: volume.mountPath,
          lastMeteredAt: existing?.lastMeteredAt ?? (state === 'started' ? now : undefined),
          lastKnownStartedAt: state === 'started'
            ? (existing?.lastKnownStartedAt ?? remoteUpdatedAt ?? now)
            : existing?.lastKnownStartedAt,
          lastKnownStoppedAt: state === 'stopped' || state === 'archived'
            ? (remoteUpdatedAt ?? now)
            : existing?.lastKnownStoppedAt,
        }
        const reconciled = await this.deps.repository.reconcile({
          ...input,
          expectedUpdatedAt: existing?.updatedAt,
        })
        if (!reconciled.success) {
          summary.stale += 1
          continue
        }
        if (existing) summary.updated += 1
        else summary.adopted += 1
        bySandboxId.set(sandbox.id, reconciled.workspace)
        byUserId.set(userId, reconciled.workspace)

        if (
          state === 'started' &&
          reconciled.workspace.lastMeteredAt !== undefined &&
          now > reconciled.workspace.lastMeteredAt
        ) {
          const metered = await this.deps.repository.accrueUsage({
            cpu: sandbox.cpu,
            diskGiB: sandbox.disk,
            endedAt: now,
            expectedLastMeteredAt: reconciled.workspace.lastMeteredAt,
            memoryGiB: sandbox.memory,
            reason: 'reconcile',
            resourceProfile: reconciled.workspace.resourceProfile,
            sandboxId: sandbox.id,
            startedAt: reconciled.workspace.lastMeteredAt,
            tier: reconciled.workspace.tier,
            userId,
          })
          if (metered?.success) summary.metered += 1
          else if (metered?.skipped === 'stale_meter_window') summary.stale += 1
        }
      } catch (_error) {
        summary.errors += 1
      }
    }

    for (const workspace of stored) {
      if (seen.has(workspace.sandboxId)) continue
      const result = await this.deps.repository.reconcile({
        ...workspace,
        state: 'missing',
        expectedUpdatedAt: workspace.updatedAt,
      })
      if (result.success) summary.missing += 1
      else summary.stale += 1
    }
    return summary
  }
}

export class DaytonaSdkReconciliationControlPlane implements DaytonaReconciliationControlPlane {
  async listOverlayWorkspaces(): Promise<DaytonaReconcileSandbox[]> {
    const rows: Sandbox[] = []
    let page = 1
    while (true) {
      const result = await getDaytonaClient().list(WORKSPACE_LABELS, page, 100)
      rows.push(...result.items)
      if (page >= (result.totalPages ?? page)) break
      page += 1
    }
    await Promise.all(rows.map(async (sandbox) => await sandbox.refreshData()))
    return rows as unknown as DaytonaReconcileSandbox[]
  }
}

function normalizeState(value: string | undefined): DaytonaWorkspaceState {
  if (value === 'started' || value === 'stopped' || value === 'archived' || value === 'error') return value
  if (value === 'destroyed') return 'missing'
  return 'provisioning'
}

function readLabel(sandbox: DaytonaReconcileSandbox, key: string): string | null {
  const value = sandbox.labels?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readTier(value: string | null): DaytonaWorkspaceTier | null {
  return value === 'pro' || value === 'max' ? value : null
}

function timestamp(value: DaytonaReconcileSandbox['updatedAt']): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function volumeMetadata(sandbox: DaytonaReconcileSandbox, existing?: DaytonaWorkspaceRecord) {
  const volume = sandbox.volumes?.find((item) => item.mountPath === WORKSPACE_MOUNT_PATH)
    ?? sandbox.volumes?.[0]
  const volumeName = stringValue(volume?.volumeName)
    ?? stringValue(volume?.name)
    ?? existing?.volumeName
    ?? `overlay-user-${readLabel(sandbox, 'overlay.userId') ?? sandbox.id}-workspace`
  return {
    mountPath: stringValue(volume?.mountPath) ?? existing?.mountPath ?? WORKSPACE_MOUNT_PATH,
    volumeId: stringValue(volume?.volumeId) ?? stringValue(volume?.id) ?? existing?.volumeId ?? volumeName,
    volumeName,
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
