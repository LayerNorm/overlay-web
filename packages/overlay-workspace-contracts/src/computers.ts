export const COMPUTER_SIZES = ['small', 'default', 'large'] as const
export type ComputerSize = (typeof COMPUTER_SIZES)[number]

export const COMPUTER_STATUSES = ['provisioning', 'ready', 'stopped', 'error'] as const
export type ComputerStatus = (typeof COMPUTER_STATUSES)[number]

export const COMPUTER_OWNER_TYPES = ['agent', 'user'] as const
export type ComputerOwnerType = (typeof COMPUTER_OWNER_TYPES)[number]

/**
 * A persistent cloud desktop. One computer per (workspaceId, ownerType,
 * ownerId) — the binding is enforced by a unique index on Postgres and by the
 * `by_workspaceId_owner` index check on Convex.
 */
export type Computer = {
  id: string
  workspaceId: string
  ownerType: ComputerOwnerType
  /** Agent definition id or user id, depending on ownerType. */
  ownerId: string
  /** Adapter key that owns the backing machine (e.g. 'box'). */
  provider: string
  /** Provider-side machine reference (e.g. a box id); null while provisioning. */
  providerRef: string | null
  size: ComputerSize
  status: ComputerStatus
  name: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
  lastActiveAt: number | null
}
