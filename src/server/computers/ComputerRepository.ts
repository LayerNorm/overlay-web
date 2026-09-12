import 'server-only'

import type { Computer, ComputerOwnerType } from '@overlay/workspace-contracts'

export interface ComputerRepository {
  create(row: Computer): Promise<Computer>
  get(id: string): Promise<Computer | null>
  findByOwner(workspaceId: string, ownerType: ComputerOwnerType, ownerId: string): Promise<Computer | null>
  listByWorkspace(workspaceId: string): Promise<Computer[]>
  update(id: string, patch: Partial<Computer>): Promise<Computer>
  delete(id: string): Promise<void>
}
