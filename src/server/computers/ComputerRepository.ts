import 'server-only'

import type { Computer, ComputerOwnerType } from '@overlay/workspace-contracts'
import type { AgentSandboxLease } from '@overlay/workspace-contracts'

export type ComputerLeaseSeed = Omit<AgentSandboxLease, 'createdAt' | 'updatedAt'> & { now: number }

export interface ComputerRepository {
  create(row: Computer): Promise<Computer>
  createWithLease(row: Computer, lease: ComputerLeaseSeed): Promise<{ computer: Computer; created: boolean }>
  get(id: string): Promise<Computer | null>
  findByOwner(workspaceId: string, ownerType: ComputerOwnerType, ownerId: string): Promise<Computer | null>
  listByWorkspace(workspaceId: string): Promise<Computer[]>
  update(id: string, patch: Partial<Computer>): Promise<Computer>
  delete(id: string): Promise<void>
  bindProviderReference(args: {
    computerId: string
    workspaceId: string
    leaseId: string
    reference: string
    allocationKey: string
    maintenanceToken: string
  }): Promise<{ computer: Computer; canContinue: boolean } | null>
}
