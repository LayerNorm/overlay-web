import 'server-only'

import {
  isDesktopSandboxInstance,
  type DesktopStreamTicket,
  type SandboxResources,
  type SandboxRuntime,
} from '@overlay/sandbox-runtime'

/**
 * Computer domain service — owns the lifecycle of persistent cloud desktops.
 *
 * A computer is a durable Overlay entity; the provider machine behind it is
 * disposable. Ownership is the binding: one computer per (ownerType, ownerId).
 * The adapter that operates on an existing computer is resolved from the
 * row's `provider`, never from global config, so mixed-provider workspaces
 * work by construction.
 */
export type ComputerSize = 'small' | 'default' | 'large'
export type ComputerStatus = 'provisioning' | 'ready' | 'stopped' | 'error'
export type ComputerOwnerType = 'agent' | 'user'

export type Computer = {
  id: string
  workspaceId: string
  ownerType: ComputerOwnerType
  ownerId: string
  provider: string
  /** Provider-side machine reference (e.g. a box id). */
  providerRef: string | null
  size: ComputerSize
  status: ComputerStatus
  name: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
  lastActiveAt: number | null
}

export interface ComputerRepository {
  create(row: Computer): Promise<Computer>
  get(id: string): Promise<Computer | null>
  findByOwner(workspaceId: string, ownerType: ComputerOwnerType, ownerId: string): Promise<Computer | null>
  listByWorkspace(workspaceId: string): Promise<Computer[]>
  update(id: string, patch: Partial<Computer>): Promise<Computer>
  delete(id: string): Promise<void>
}

export type ComputerActor = {
  userId: string
  workspaceRole?: 'owner' | 'member'
}

export type ComputerLimits = {
  maxPerWorkspace?: number
  maxPersonalPerUser?: number
  allowedSizes?: readonly ComputerSize[]
}

export type ComputerOwnerAccess =
  | { ownerType: 'user' }
  | { ownerType: 'agent'; visibility: 'workspace' | 'creator'; createdBy: string }

export class ComputerServiceError extends Error {
  constructor(
    readonly code: 'not_found' | 'forbidden' | 'quota_exceeded' | 'size_not_allowed' | 'provider_unavailable' | 'provider_error',
    message: string,
    readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ComputerServiceError'
  }
}

const SIZE_RESOURCES: Record<ComputerSize, SandboxResources> = {
  small: { vcpus: 2, memoryGiB: 4, diskGiB: 40 },
  default: { vcpus: 4, memoryGiB: 8, diskGiB: 80 },
  large: { vcpus: 8, memoryGiB: 16, diskGiB: 100 },
}

const DESKTOP_TICKET_POLL_MS = 3_000
const DESKTOP_TICKET_DEADLINE_MS = 45_000
const DEFAULT_HARD_TIMEOUT_MS = 2 * 60 * 60_000

export class ComputerService {
  constructor(private readonly dependencies: {
    repository: ComputerRepository
    /** Resolve the runtime a computer row lives on — keyed by row.provider. */
    runtimeFor(provider: string): SandboxRuntime | undefined
    /** Resolve an agent owner's visibility for access checks. */
    agentOwner?: (workspaceId: string, agentId: string) => Promise<{ visibility: 'workspace' | 'creator'; createdBy: string } | null>
    limits?: (input: { workspaceId: string; ownerType: ComputerOwnerType }) => Promise<ComputerLimits | undefined> | ComputerLimits | undefined
    now?: () => number
    newId?: () => string
    sleep?: (ms: number) => Promise<void>
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
    const ownerAccess = await this.ownerAccess(args.workspaceId, args.ownerType, args.ownerId)
    if (!this.canAccess(args.actor, args.ownerType, args.ownerId, ownerAccess)) {
      throw new ComputerServiceError('forbidden', 'You cannot manage this computer', 403)
    }
    const existing = await this.dependencies.repository.findByOwner(args.workspaceId, args.ownerType, args.ownerId)
    if (existing && existing.status !== 'error') return existing

    const limitsOption = this.dependencies.limits
    const limits = typeof limitsOption === 'function'
      ? await limitsOption({ workspaceId: args.workspaceId, ownerType: args.ownerType })
      : limitsOption
    const size = args.size ?? 'default'
    if (limits?.allowedSizes && !limits.allowedSizes.includes(size)) {
      throw new ComputerServiceError('size_not_allowed', `Computer size ${size} is not allowed`, 403)
    }
    const computers = await this.dependencies.repository.listByWorkspace(args.workspaceId)
    if (limits?.maxPerWorkspace !== undefined && computers.length >= limits.maxPerWorkspace) {
      throw new ComputerServiceError('quota_exceeded', 'This workspace has reached its computer limit', 429)
    }
    if (args.ownerType === 'user' && limits?.maxPersonalPerUser !== undefined) {
      const personal = computers.filter((computer) => computer.ownerType === 'user' && computer.ownerId === args.ownerId)
      if (personal.length >= limits.maxPersonalPerUser) {
        throw new ComputerServiceError('quota_exceeded', 'You already have a computer', 429)
      }
    }

    const runtime = this.runtimeFor('box')
    const now = this.now()
    const computer = await this.dependencies.repository.create({
      id: this.newId(),
      workspaceId: args.workspaceId,
      ownerType: args.ownerType,
      ownerId: args.ownerId,
      provider: 'box',
      providerRef: null,
      size,
      status: 'provisioning',
      name: args.name ?? null,
      createdBy: args.actor.userId,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: null,
    })
    try {
      const instance = await runtime.create({
        name: computer.name ?? `computer-${computer.id}`,
        persistent: true,
        environment: {
          OVERLAY_WORKSPACE_ID: computer.workspaceId,
          OVERLAY_COMPUTER_ID: computer.id,
          OVERLAY_OWNER_TYPE: computer.ownerType,
          OVERLAY_OWNER_ID: computer.ownerId,
        },
        networkPolicy: { mode: 'allow_all' },
        idleTimeoutMs: 0,
        hardTimeoutMs: DEFAULT_HARD_TIMEOUT_MS,
        resources: SIZE_RESOURCES[size],
      })
      return await this.dependencies.repository.update(computer.id, {
        providerRef: instance.reference,
        status: 'ready',
        updatedAt: this.now(),
        lastActiveAt: this.now(),
      })
    } catch (error) {
      await this.dependencies.repository.update(computer.id, { status: 'error', updatedAt: this.now() })
      throw new ComputerServiceError('provider_error', 'The computer could not be provisioned', 502, { cause: error })
    }
  }

  /** Issue a live desktop stream ticket. The URL is a bearer secret — callers must not log it. */
  async openDesktop(args: {
    actor: ComputerActor
    computerId: string
    mode?: 'webrtc' | 'vnc'
  }): Promise<DesktopStreamTicket> {
    const { computer, instance } = await this.accessibleInstance(args.actor, args.computerId)
    if (await instance.status() === 'stopped') {
      await instance.resume()
      await this.touch(computer)
    }
    const deadline = this.now() + DESKTOP_TICKET_DEADLINE_MS
    for (;;) {
      const ticket = await instance.desktop({ mode: args.mode })
      if (ticket.ready) {
        await this.touch(computer)
        return ticket
      }
      if (this.now() > deadline) {
        throw new ComputerServiceError('provider_error', 'The desktop stream is still preparing', 504)
      }
      await this.sleep(DESKTOP_TICKET_POLL_MS)
    }
  }

  async stop(args: { actor: ComputerActor; computerId: string }): Promise<Computer> {
    const { computer, instance } = await this.accessibleInstance(args.actor, args.computerId)
    await instance.stop()
    return this.dependencies.repository.update(computer.id, { status: 'stopped', updatedAt: this.now() })
  }

  async start(args: { actor: ComputerActor; computerId: string }): Promise<Computer> {
    const { computer, instance } = await this.accessibleInstance(args.actor, args.computerId)
    await instance.resume()
    return this.dependencies.repository.update(computer.id, { status: 'ready', updatedAt: this.now(), lastActiveAt: this.now() })
  }

  async destroy(args: { actor: ComputerActor; computerId: string }): Promise<void> {
    const { computer, instance } = await this.accessibleInstance(args.actor, args.computerId)
    await instance.delete().catch((_error) => undefined)
    await this.dependencies.repository.delete(computer.id)
  }

  async listForWorkspace(args: { actor: ComputerActor; workspaceId: string }): Promise<Computer[]> {
    const computers = await this.dependencies.repository.listByWorkspace(args.workspaceId)
    const visible: Computer[] = []
    for (const computer of computers) {
      const ownerAccess = await this.ownerAccess(computer.workspaceId, computer.ownerType, computer.ownerId)
      if (this.canAccess(args.actor, computer.ownerType, computer.ownerId, ownerAccess)) visible.push(computer)
    }
    return visible
  }

  private async accessibleInstance(actor: ComputerActor, computerId: string) {
    const computer = await this.dependencies.repository.get(computerId)
    if (!computer) throw new ComputerServiceError('not_found', 'Computer not found', 404)
    const ownerAccess = await this.ownerAccess(computer.workspaceId, computer.ownerType, computer.ownerId)
    if (!this.canAccess(actor, computer.ownerType, computer.ownerId, ownerAccess)) {
      throw new ComputerServiceError('forbidden', 'You cannot manage this computer', 403)
    }
    if (!computer.providerRef) {
      throw new ComputerServiceError('provider_error', 'The computer is still provisioning', 409)
    }
    const runtime = this.runtimeFor(computer.provider)
    const instance = await runtime.reconnect(computer.providerRef)
    if (!isDesktopSandboxInstance(instance)) {
      throw new ComputerServiceError('provider_error', 'This computer has no desktop', 502)
    }
    return { computer, instance }
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
   * are creator + workspace owner. */
  private canAccess(
    actor: ComputerActor,
    ownerType: ComputerOwnerType,
    ownerId: string,
    ownerAccess: ComputerOwnerAccess | null,
  ): boolean {
    if (ownerType === 'user') return ownerId === actor.userId
    if (!ownerAccess || ownerAccess.ownerType !== 'agent') return false
    if (ownerAccess.visibility === 'workspace') return true
    return ownerAccess.createdBy === actor.userId || actor.workspaceRole === 'owner'
  }

  private runtimeFor(provider: string): SandboxRuntime {
    const runtime = this.dependencies.runtimeFor(provider)
    if (!runtime) {
      throw new ComputerServiceError('provider_unavailable', `No ${provider} provider is configured`, 503)
    }
    return runtime
  }

  private async touch(computer: Computer): Promise<void> {
    await this.dependencies.repository.update(computer.id, { lastActiveAt: this.now(), updatedAt: this.now() })
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now()
  }

  private newId(): string {
    return this.dependencies.newId?.() ?? globalThis.crypto.randomUUID()
  }

  private sleep(ms: number): Promise<void> {
    return this.dependencies.sleep?.(ms) ?? new Promise((resolve) => setTimeout(resolve, ms))
  }
}
