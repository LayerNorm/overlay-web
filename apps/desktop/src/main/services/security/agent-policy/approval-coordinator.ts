import type { AgentPolicyContext, AgentPolicyDecision } from './agent-policy-engine'
import { AgentApprovalStore, type ApprovalRequest } from './approval-store'
import type { AgentCapability } from './tool-registry'

export type ApprovalResponse = 'deny' | 'allow_once' | 'allow_task'

export interface ApprovalPresenter {
  present(request: ApprovalRequest, decision: AgentPolicyDecision): Promise<ApprovalResponse>
}

type TaskGrant = {
  capability: AgentCapability
  expiresAt: number
  principalId: string
  serverDeploymentId: string
}

const DEFAULT_TASK_GRANT_TTL_MS = 30 * 60_000
const MAX_TASK_GRANT_TTL_MS = 2 * 60 * 60_000

export class AgentApprovalCoordinator {
  private readonly store: AgentApprovalStore
  private readonly taskGrants = new Map<string, Map<AgentCapability, TaskGrant>>()
  private readonly pendingTasks = new Set<string>()

  constructor(store = new AgentApprovalStore()) {
    this.store = store
  }

  getTaskGrants(context: AgentPolicyContext, now = Date.now()): ReadonlySet<AgentCapability> {
    const grants = this.taskGrants.get(context.taskId)
    if (!grants) return new Set()
    const active = new Set<AgentCapability>()
    for (const [capability, grant] of grants) {
      if (
        grant.expiresAt <= now ||
        grant.principalId !== context.principalId ||
        grant.serverDeploymentId !== context.serverDeploymentId
      ) {
        grants.delete(capability)
      } else {
        active.add(capability)
      }
    }
    if (grants.size === 0) this.taskGrants.delete(context.taskId)
    return active
  }

  async authorize(
    context: AgentPolicyContext,
    decision: AgentPolicyDecision,
    canonicalArguments: Readonly<Record<string, unknown>>,
    presenter: ApprovalPresenter,
    options: { now?: number; taskGrantTtlMs?: number } = {}
  ): Promise<Readonly<Record<string, unknown>> | null> {
    if (decision.outcome === 'allow') return canonicalArguments
    if (decision.outcome === 'deny') return null
    if (!context.principalId || !context.serverDeploymentId) return null
    if (this.pendingTasks.has(context.taskId)) return null

    const issuedAt = options.now ?? Date.now()
    const binding = {
      taskId: context.taskId,
      principalId: context.principalId,
      serverDeploymentId: context.serverDeploymentId
    }
    const request = this.store.create(binding, decision.registration.name, canonicalArguments, {
      now: issuedAt
    })
    this.pendingTasks.add(context.taskId)
    try {
      const response = await presenter.present(request, decision)
      const approvalTime = options.now ?? Date.now()
      if (response === 'deny') {
        this.store.revoke(request.id)
        return null
      }
      if (response === 'allow_task') {
        if (decision.approval !== 'task_grant' || !decision.registration.capability) {
          this.store.revoke(request.id)
          return null
        }
        this.addTaskGrant(
          context,
          decision.registration.capability,
          approvalTime,
          options.taskGrantTtlMs
        )
      }
      if (!this.store.approve(request.id, approvalTime)) return null
      const consumed = this.store.consume(
        request.id,
        binding,
        decision.registration.name,
        canonicalArguments,
        approvalTime
      )
      return consumed ? request.display : null
    } finally {
      this.store.revoke(request.id)
      this.pendingTasks.delete(context.taskId)
    }
  }

  revokeTask(taskId: string): void {
    this.taskGrants.delete(taskId)
  }

  revokeAll(): void {
    this.taskGrants.clear()
    this.store.revokeAll()
    this.pendingTasks.clear()
  }

  private addTaskGrant(
    context: AgentPolicyContext,
    capability: AgentCapability,
    now: number,
    requestedTtlMs = DEFAULT_TASK_GRANT_TTL_MS
  ): void {
    const ttlMs = Math.min(Math.max(requestedTtlMs, 1_000), MAX_TASK_GRANT_TTL_MS)
    let grants = this.taskGrants.get(context.taskId)
    if (!grants) {
      grants = new Map()
      this.taskGrants.set(context.taskId, grants)
    }
    grants.set(capability, {
      capability,
      expiresAt: now + ttlMs,
      principalId: context.principalId!,
      serverDeploymentId: context.serverDeploymentId!
    })
  }
}

export const agentApprovalCoordinator = new AgentApprovalCoordinator()
