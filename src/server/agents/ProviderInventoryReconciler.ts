import 'server-only'

import type { SandboxInventoryItem, SandboxProviderId, SandboxRuntime } from '@overlay/sandbox-runtime'
import { lazyConvex } from '@/server/database/lazy-convex'
import { logger } from '@/server/observability/logger'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ManagedSandboxError, managedSandboxRuntimeFromEnv } from './managed-sandbox-runtime'

type ReconcileOptions = {
  maxPages?: number
  pageSize?: number
  graceMs?: number
}

type UnownedInventoryItem = {
  reference: string
  state: string
  ageMinutes: number
  monthCostCents?: number
}

type ReconcileResult = { disabled: true } | {
  scanned: number
  live: number
  unowned: UnownedInventoryItem[]
  truncated: boolean
}

type ProviderInventoryReconcilerDependencies = {
  runtime?: () => SandboxRuntime
  listKnownReferences?: (args: { provider: SandboxProviderId; references: string[] }) => Promise<string[]>
  now?: () => number
  warn?: (message: string, properties: Record<string, unknown>) => void
}

function isLiveState(state: string): boolean {
  return !['paused', 'archived', 'stopped', 'deleted', 'cancelled', 'error'].includes(state.trim().toLowerCase())
}

function boundedInteger(value: number, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(1, Math.floor(value)))
}

function candidateFromItem(item: SandboxInventoryItem, now: number, graceMs: number): UnownedInventoryItem | null {
  if (item.createdAt === undefined || !Number.isFinite(item.createdAt)) return null
  const ageMs = now - item.createdAt
  if (ageMs < graceMs) return null
  return {
    reference: item.reference,
    state: item.state,
    ageMinutes: Math.floor(ageMs / 60_000),
    ...(typeof item.monthCostCents === 'number' && Number.isFinite(item.monthCostCents)
      ? { monthCostCents: item.monthCostCents }
      : {}),
  }
}

async function scanInventory(
  listInventory: NonNullable<SandboxRuntime['listInventory']>,
  maxPages: number,
  pageSize: number,
  graceMs: number,
  now: number,
) {
  const candidates = new Map<string, UnownedInventoryItem>()
  let scanned = 0
  let live = 0
  let cursor: string | undefined
  let truncated = false

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const page = await listInventory({ limit: pageSize, ...(cursor ? { cursor } : {}) })
    scanned += page.items.length
    for (const item of page.items) {
      if (!isLiveState(item.state)) continue
      live++
      const candidate = candidateFromItem(item, now, graceMs)
      if (candidate) candidates.set(candidate.reference, candidate)
    }
    cursor = page.nextCursor
    if (!cursor) break
    if (pageNumber + 1 === maxPages) truncated = true
  }

  return { candidates, scanned, live, truncated }
}

async function queryKnownReferences(args: { provider: SandboxProviderId; references: string[] }): Promise<string[]> {
  const known = await lazyConvex.query<string[]>('agents/providerInventory:listKnownProviderReferencesByServer', {
    serverSecret: getInternalApiSecret(),
    ...args,
  }, { throwOnError: true })
  if (!known) throw new Error('provider_inventory_ownership_lookup_unavailable')
  return known
}

async function findKnownReferences(
  provider: SandboxProviderId,
  references: string[],
  lookup: ProviderInventoryReconcilerDependencies['listKnownReferences'],
): Promise<Set<string>> {
  const found = new Set<string>()
  if (!lookup) return found
  for (let index = 0; index < references.length; index += 200) {
    const known = await lookup({ provider, references: references.slice(index, index + 200) })
    for (const reference of known) found.add(reference)
  }
  return found
}

export class ProviderInventoryReconciler {
  constructor(private readonly dependencies: ProviderInventoryReconcilerDependencies = {}) {}

  async reconcile({
    maxPages = 2,
    pageSize = 200,
    graceMs = 15 * 60_000,
  }: ReconcileOptions = {}): Promise<ReconcileResult> {
    let runtime: SandboxRuntime
    try {
      runtime = (this.dependencies.runtime ?? managedSandboxRuntimeFromEnv)()
    } catch (error) {
      if (error instanceof ManagedSandboxError && error.code === 'managed_sandbox_provider_invalid') {
        return { disabled: true }
      }
      throw error
    }
    const listInventory = runtime.listInventory?.bind(runtime)
    if (!listInventory) return { disabled: true }

    const pageLimit = boundedInteger(maxPages, 2, 10)
    const itemLimit = boundedInteger(pageSize, 200, 200)
    const gracePeriod = Number.isFinite(graceMs) ? Math.max(0, graceMs) : 15 * 60_000
    const now = (this.dependencies.now ?? Date.now)()
    const scan = await scanInventory(listInventory, pageLimit, itemLimit, gracePeriod, now)
    const listKnownReferences = this.dependencies.listKnownReferences ?? queryKnownReferences
    const found = await findKnownReferences(runtime.provider, [...scan.candidates.keys()], listKnownReferences)
    const unowned = [...scan.candidates.values()].filter((item) => !found.has(item.reference))
    if (unowned.length > 0) {
      (this.dependencies.warn ?? logger.warn)('[sandbox-inventory] unowned provider machines', {
        provider: runtime.provider,
        count: unowned.length,
        references: unowned.map((item) => item.reference),
      })
    }

    return { scanned: scan.scanned, live: scan.live, unowned, truncated: scan.truncated }
  }
}
