import 'server-only'

import type {
  DaytonaUsageReason,
  DaytonaWorkspaceState,
  DaytonaWorkspaceTier,
} from './daytona-pricing'

export type DaytonaWorkspaceRecord = {
  _id?: string
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

export type DaytonaWorkspaceUpsert = Omit<DaytonaWorkspaceRecord, '_id' | 'createdAt' | 'updatedAt'>

export type DaytonaUsageAccrual = {
  billingAccountId?: string
  deferUsageCharge?: boolean
  userId: string
  sandboxId: string
  tier: DaytonaWorkspaceTier
  resourceProfile: DaytonaWorkspaceTier
  startedAt: number
  endedAt: number
  cpu: number
  memoryGiB: number
  diskGiB: number
  expectedLastMeteredAt?: number
  reason: DaytonaUsageReason
}

export interface DaytonaWorkspaceRepository {
  getByUserId(args: { userId: string }): Promise<DaytonaWorkspaceRecord | null>
  listAll(): Promise<DaytonaWorkspaceRecord[]>
  upsert(args: DaytonaWorkspaceUpsert): Promise<DaytonaWorkspaceRecord>
  reconcile(args: DaytonaWorkspaceUpsert & { expectedUpdatedAt?: number }): Promise<
    | { success: true; workspace: DaytonaWorkspaceRecord }
    | { success: false; skipped: 'stale_workspace' }
  >
  accrueUsage(args: DaytonaUsageAccrual): Promise<
    | { success: true; durationSeconds: number; providerCostUsd: number; costUsd: number; costCents: number }
    | { success: false; skipped: 'missing_workspace' | 'stale_meter_window' }
    | null
  >
}
