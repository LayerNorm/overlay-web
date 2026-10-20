import 'server-only'

import {
  type DesktopStreamTicket,
  type SandboxInstance,
} from '@overlay/sandbox-runtime'
import type {
  Computer,
  ComputerOwnerType,
  ComputerSize,
} from '@overlay/workspace-contracts'
import type { ComputerRepository } from './ComputerRepository'
import type { ComputerLifecycleService } from './ComputerLifecycleService'

export type { Computer, ComputerOwnerType, ComputerSize, ComputerStatus } from '@overlay/workspace-contracts'
export type { ComputerRepository } from './ComputerRepository'

/**
 * Computer domain service — owns the lifecycle of persistent cloud desktops.
 *
 * A computer is a durable Overlay entity; the provider machine behind it is
 * disposable. Ownership is the binding: one computer per (ownerType, ownerId).
 * The adapter that operates on an existing computer is resolved from the
 * row's `provider`, never from global config, so mixed-provider workspaces
 * work by construction.
 */
export type ComputerActor = {
  userId: string
  workspaceId: string
  /** Caller's workspace principal id — required for creator-only agent access checks. */
  principalId?: string
  workspaceRole?: 'owner' | 'member'
}

export type ComputerLimits = {
  maxPerWorkspace?: number
  maxPersonalPerUser?: number
  allowedSizes?: readonly ComputerSize[]
}

export type ComputerOwnerAccess =
  | { ownerType: 'user' }
  | { ownerType: 'agent'; visibility: 'workspace' | 'creator'; createdByPrincipalId: string }

export class ComputerServiceError extends Error {
  constructor(
    readonly code: 'not_found' | 'forbidden' | 'paid_plan_required' | 'insufficient_credit' | 'quota_exceeded' | 'size_not_allowed' | 'provider_unavailable' | 'provider_error',
    message: string,
    readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ComputerServiceError'
  }
}

export class ComputerService {
  constructor(private readonly dependencies: {
    repository: ComputerRepository
    assertCanRun(input: { workspaceId: string; userId: string; agentId?: string }): Promise<void>
    /** Resolve an agent owner's visibility and creator principal for access checks. */
    agentOwner?: (workspaceId: string, agentId: string) => Promise<{ visibility: 'workspace' | 'creator'; createdByPrincipalId: string } | null>
    limits?: ((input: { workspaceId: string; ownerType: ComputerOwnerType }) => Promise<ComputerLimits | undefined> | ComputerLimits | undefined) | ComputerLimits
    lifecycle: Pick<ComputerLifecycleService, 'provision' | 'openDesktop' | 'stop' | 'withOwnerOperation'>
  }) {}

  /**
   * Idempotent per-owner provisioning: a second call for the same owner
   * returns the existing computer rather than a second, billable machine.
   */
  async provision(args: {
    actor: ComputerActor
    workspaceId: string
    ownerType: ComputerOwnerType
    ownerId: string
    size?: ComputerSize
    name?: string
  }): Promise<Computer> {
    this.assertWorkspace(args.actor, args.workspaceId)
    const ownerAccess = await this.ownerAccess(args.workspaceId, args.ownerType, args.ownerId)
    if (!this.canAccess(args.actor, args.ownerType, args.ownerId, ownerAccess)) {
      throw new ComputerServiceError('forbidden', 'You cannot manage this computer', 403)
    }
    await this.admit(args.actor, args.workspaceId, args.ownerType, args.ownerId)
    const existing = await this.dependencies.repository.findByOwner(args.workspaceId, args.ownerType, args.ownerId)

    const limitsOption = this.dependencies.limits
    const limits = typeof limitsOption === 'function'
      ? await limitsOption({ workspaceId: args.workspaceId, ownerType: args.ownerType })
      : limitsOption
    const size = args.size ?? 'default'
    if (limits?.allowedSizes && !limits.allowedSizes.includes(size)) {
      throw new ComputerServiceError('size_not_allowed', `Computer size ${size} is not allowed`, 403)
    }
    const computers = await this.dependencies.repository.listByWorkspace(args.workspaceId)
    if (!existing && limits?.maxPerWorkspace !== undefined && computers.length >= limits.maxPerWorkspace) {
      throw new ComputerServiceError('quota_exceeded', 'This workspace has reached its computer limit', 429)
    }
    if (!existing && args.ownerType === 'user' && limits?.maxPersonalPerUser !== undefined) {
      const personal = computers.filter((computer) => computer.ownerType === 'user' && computer.ownerId === args.ownerId)
      if (personal.length >= limits.maxPersonalPerUser) {
        throw new ComputerServiceError('quota_exceeded', 'You already have a computer', 429)
      }
    }

    return await this.dependencies.lifecycle.provision({
      actorUserId: args.actor.userId,
      workspaceId: args.workspaceId,
      ownerType: args.ownerType,
      ownerId: args.ownerId,
      size,
      name: args.name,
    })
  }

  /** Issue a live desktop stream ticket. The URL is a bearer secret — callers must not log it. */
  async openDesktop(args: {
    actor: ComputerActor
    computerId: string
    mode?: 'webrtc' | 'vnc'
  }): Promise<DesktopStreamTicket> {
    const computer = await this.getForActor({ actor: args.actor, computerId: args.computerId })
    await this.admit(args.actor, computer.workspaceId, computer.ownerType, computer.ownerId)
    return await this.dependencies.lifecycle.openDesktop(computer, args.actor.userId, args.mode)
  }

  async stop(args: { actor: ComputerActor; computerId: string }): Promise<Computer> {
    const computer = await this.getForActor({ actor: args.actor, computerId: args.computerId })
    await this.dependencies.lifecycle.stop(computer, args.actor.userId)
    return await this.dependencies.repository.get(computer.id) ?? computer
  }

  async start(args: { actor: ComputerActor; computerId: string }): Promise<Computer> {
    const computer = await this.getForActor({ actor: args.actor, computerId: args.computerId })
    await this.admit(args.actor, computer.workspaceId, computer.ownerType, computer.ownerId)
    await this.dependencies.lifecycle.withOwnerOperation({
      actorUserId: args.actor.userId, workspaceId: computer.workspaceId,
      ownerType: computer.ownerType, ownerId: computer.ownerId, operation: async () => undefined,
    })
    return await this.dependencies.repository.get(computer.id) ?? computer
  }

  async destroy(args: { actor: ComputerActor; computerId: string }): Promise<void> {
    const computer = await this.getForActor({ actor: args.actor, computerId: args.computerId })
    await this.dependencies.lifecycle.stop(computer, args.actor.userId, true)
  }

  /** Destroy the computer bound to an owner, if any. No-op when unbound. */
  async destroyForOwner(args: {
    actor: ComputerActor
    workspaceId: string
    ownerType: ComputerOwnerType
    ownerId: string
  }): Promise<void> {
    this.assertWorkspace(args.actor, args.workspaceId)
    const computer = await this.dependencies.repository.findByOwner(
      args.workspaceId,
      args.ownerType,
      args.ownerId,
    )
    if (!computer) return
    await this.destroy({ actor: args.actor, computerId: computer.id })
  }

  async getForOwner(args: {
    actor: ComputerActor
    workspaceId: string
    ownerType: ComputerOwnerType
    ownerId: string
  }): Promise<Computer> {
    this.assertWorkspace(args.actor, args.workspaceId)
    const computer = await this.dependencies.repository.findByOwner(args.workspaceId, args.ownerType, args.ownerId)
    if (!computer) throw new ComputerServiceError('not_found', 'No computer is bound to this owner', 404)
    const ownerAccess = await this.ownerAccess(computer.workspaceId, computer.ownerType, computer.ownerId)
    if (!this.canAccess(args.actor, computer.ownerType, computer.ownerId, ownerAccess)) {
      throw new ComputerServiceError('forbidden', 'You cannot use this computer', 403)
    }
    if (!computer.providerRef || computer.status === 'error') {
      throw new ComputerServiceError('provider_error', 'The computer is still provisioning or failed to provision', 409)
    }
    return computer
  }

  async withOwnerOperation<T>(args: {
    actor: ComputerActor
    workspaceId: string
    ownerType: ComputerOwnerType
    ownerId: string
    actionDeadlineMs?: number
    operation: (computer: Computer, instance: SandboxInstance) => Promise<T>
  }): Promise<T> {
    const computer = await this.getForOwner(args)
    await this.admit(args.actor, computer.workspaceId, computer.ownerType, computer.ownerId)
    return await this.dependencies.lifecycle.withOwnerOperation({
      actorUserId: args.actor.userId, workspaceId: args.workspaceId,
      ownerType: args.ownerType, ownerId: args.ownerId, actionDeadlineMs: args.actionDeadlineMs,
      operation: args.operation,
    })
  }

  /** Read one computer for an authorized actor — no provider reconnect. */
  async getForActor(args: { actor: ComputerActor; computerId: string }): Promise<Computer> {
    const computer = await this.dependencies.repository.get(args.computerId)
    if (!computer) throw new ComputerServiceError('not_found', 'Computer not found', 404)
    this.assertWorkspace(args.actor, computer.workspaceId)
    const ownerAccess = await this.ownerAccess(computer.workspaceId, computer.ownerType, computer.ownerId)
    if (!this.canAccess(args.actor, computer.ownerType, computer.ownerId, ownerAccess)) {
      throw new ComputerServiceError('forbidden', 'You cannot manage this computer', 403)
    }
    return computer
  }

  async listForWorkspace(args: { actor: ComputerActor; workspaceId: string }): Promise<Computer[]> {
    this.assertWorkspace(args.actor, args.workspaceId)
    const computers = await this.dependencies.repository.listByWorkspace(args.workspaceId)
    const ownerAccesses = await Promise.all(computers.map((computer) =>
      this.ownerAccess(computer.workspaceId, computer.ownerType, computer.ownerId)))
    return computers.filter((computer, i) =>
      this.canAccess(args.actor, computer.ownerType, computer.ownerId, ownerAccesses[i]))
  }

  private assertWorkspace(actor: ComputerActor, workspaceId: string): void {
    if (!actor.workspaceId || actor.workspaceId !== workspaceId) {
      throw new ComputerServiceError('forbidden', 'This computer belongs to a different workspace', 403)
    }
  }

  private admit(actor: ComputerActor, workspaceId: string, ownerType: ComputerOwnerType, ownerId: string) {
    return this.dependencies.assertCanRun({ workspaceId, userId: actor.userId, ...(ownerType === 'agent' ? { agentId: ownerId } : {}) })
  }

  private async ownerAccess(
    workspaceId: string,
    ownerType: ComputerOwnerType,
    ownerId: string,
  ): Promise<ComputerOwnerAccess | null> {
    if (ownerType === 'user') return { ownerType: 'user' }
    const agent = await this.dependencies.agentOwner?.(workspaceId, ownerId)
    return agent ? { ownerType: 'agent', ...agent } : null
  }

  /** Access rules: personal computers are owner-only; workspace-visible agents'
   * computers are open to the whole workspace; creator-only agents' computers
   * are creator + workspace owner. A computer whose owner agent no longer
   * resolves (archived/deleted) falls to the workspace owner so the machine
   * can still be stopped or destroyed instead of billing forever. */
  private canAccess(
    actor: ComputerActor,
    ownerType: ComputerOwnerType,
    ownerId: string,
    ownerAccess: ComputerOwnerAccess | null,
  ): boolean {
    if (ownerType === 'user') return ownerId === actor.userId
    if (!ownerAccess || ownerAccess.ownerType !== 'agent') return actor.workspaceRole === 'owner'
    if (ownerAccess.visibility === 'workspace') return true
    return ownerAccess.createdByPrincipalId === actor.principalId || actor.workspaceRole === 'owner'
  }

}
