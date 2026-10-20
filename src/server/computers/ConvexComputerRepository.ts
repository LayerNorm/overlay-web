import 'server-only'

import type { AgentSandboxLease, Computer, ComputerOwnerType } from '@overlay/workspace-contracts'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Doc } from '../../../convex/_generated/dataModel'
import type { ComputerRepository } from './ComputerRepository'

type ComputerDoc = Doc<'computers'>

export class ConvexComputerRepository implements ComputerRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async create(row: Computer): Promise<Computer> {
    const id = await convex.mutation<string>('computers/computers:create', {
      serverSecret: this.serverSecret,
      id: row.id,
      workspaceId: row.workspaceId,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      provider: row.provider,
      providerRef: row.providerRef ?? undefined,
      size: row.size,
      status: row.status,
      name: row.name ?? undefined,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastActiveAt: row.lastActiveAt ?? undefined,
    }, { throwOnError: true })
    if (!id) throw new Error('Failed to create computer')
    const computer = await this.get(id)
    if (!computer) throw new Error('Failed to create computer')
    return computer
  }

  async createWithLease(row: Computer, lease: Omit<AgentSandboxLease, 'createdAt' | 'updatedAt'> & { now: number }): Promise<{ computer: Computer; created: boolean }> {
    const result = await convex.mutation<{ id: string; created: boolean }>('computers/computers:createWithLease', {
      serverSecret: this.serverSecret,
      id: row.id,
      workspaceId: row.workspaceId,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      provider: row.provider,
      providerRef: row.providerRef ?? undefined,
      size: row.size,
      status: row.status,
      name: row.name ?? undefined,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastActiveAt: row.lastActiveAt ?? undefined,
      lease: {
        leaseId: lease.id,
        workspaceId: lease.workspaceId,
        computerId: lease.computerId,
        environmentId: lease.environmentId,
        runId: lease.runId,
        provider: lease.provider,
        providerReference: lease.providerReference,
        status: lease.status,
        reservationId: lease.reservationId,
        reservedUntil: lease.reservedUntil,
        runtimeStartedAt: lease.runtimeStartedAt,
        runtimeEndedAt: lease.runtimeEndedAt,
        usage: lease.usage,
        cleanupAttempts: lease.cleanupAttempts,
        cleanupAfter: lease.cleanupAfter,
        nextMeterAt: lease.nextMeterAt,
        meterClaimToken: lease.meterClaimToken,
        meterClaimUntil: lease.meterClaimUntil,
        now: lease.now,
      },
    }, { throwOnError: true })
    if (!result) throw new Error('Failed to create computer')
    const computer = await this.get(result.id)
    if (!computer) throw new Error('Failed to create computer')
    return { computer, created: result.created }
  }

  async get(id: string): Promise<Computer | null> {
    const doc = await convex.query<ComputerDoc | null>('computers/computers:get', {
      id,
      serverSecret: this.serverSecret,
    })
    return doc ? mapComputerDoc(doc) : null
  }

  async findByOwner(
    workspaceId: string,
    ownerType: ComputerOwnerType,
    ownerId: string,
  ): Promise<Computer | null> {
    const doc = await convex.query<ComputerDoc | null>('computers/computers:findByOwner', {
      workspaceId,
      ownerType,
      ownerId,
      serverSecret: this.serverSecret,
    })
    return doc ? mapComputerDoc(doc) : null
  }

  async listByWorkspace(workspaceId: string): Promise<Computer[]> {
    const docs = await convex.query<ComputerDoc[]>('computers/computers:listByWorkspace', {
      workspaceId,
      serverSecret: this.serverSecret,
    })
    return (docs ?? []).map(mapComputerDoc)
  }

  async update(id: string, patch: Partial<Computer>): Promise<Computer> {
    await convex.mutation('computers/computers:update', {
      id,
      serverSecret: this.serverSecret,
      provider: patch.provider,
      providerRef: patch.providerRef,
      size: patch.size,
      status: patch.status,
      name: patch.name,
      updatedAt: patch.updatedAt,
      lastActiveAt: patch.lastActiveAt,
    }, { throwOnError: true })
    const computer = await this.get(id)
    if (!computer) throw new Error('Failed to update computer')
    return computer
  }

  async delete(id: string): Promise<void> {
    await convex.mutation('computers/computers:remove', {
      id,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async bindProviderReference(args: {
    computerId: string
    workspaceId: string
    leaseId: string
    reference: string
    allocationKey: string
    maintenanceToken: string
  }): Promise<{ computer: Computer; canContinue: boolean } | null> {
    const result = await convex.mutation<{ id: string; canContinue: boolean } | null>('computers/computers:bindProviderReference', {
      serverSecret: this.serverSecret,
      ...args,
    }, { throwOnError: true })
    const computer = result ? await this.get(result.id) : null
    return computer && result ? { computer, canContinue: result.canContinue } : null
  }
}

function mapComputerDoc(doc: ComputerDoc): Computer {
  return {
    id: doc.id,
    workspaceId: doc.workspaceId,
    ownerType: doc.ownerType,
    ownerId: doc.ownerId,
    provider: doc.provider,
    providerRef: doc.providerRef ?? null,
    size: doc.size,
    status: doc.status,
    name: doc.name ?? null,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastActiveAt: doc.lastActiveAt ?? null,
  }
}
