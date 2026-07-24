import { randomBytes } from 'node:crypto'
import { agentApprovalCoordinator, type AgentApprovalCoordinator } from './approval-coordinator'
import { agentInfrastructure, type AgentInfrastructure } from './agent-infrastructure'

export interface AgentTaskSecurityDependencies {
  readonly coordinator: Pick<AgentApprovalCoordinator, 'revokeTask'>
  readonly infrastructure: Pick<AgentInfrastructure, 'cancelTask'>
}

const DEFAULT_DEPENDENCIES: AgentTaskSecurityDependencies = {
  coordinator: agentApprovalCoordinator,
  infrastructure: agentInfrastructure
}

/**
 * Main-process lifecycle owner for one agent task. The identifier is generated
 * independently of renderer stream IDs and is the binding used for approvals,
 * grants, provider processes, and cleanup.
 */
export class AgentTaskSecuritySession {
  readonly taskId: string
  private closePromise: Promise<void> | null = null

  constructor(
    dependencies: AgentTaskSecurityDependencies = DEFAULT_DEPENDENCIES,
    taskId = `task_${randomBytes(18).toString('base64url')}`
  ) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(taskId)) {
      throw new Error('invalid_agent_task_id')
    }
    this.taskId = taskId
    this.dependencies = dependencies
  }

  private readonly dependencies: AgentTaskSecurityDependencies

  async cancel(): Promise<void> {
    await this.close()
  }

  async finish(): Promise<void> {
    await this.close()
  }

  private async close(): Promise<void> {
    if (!this.closePromise) {
      this.closePromise = Promise.resolve().then(async () => {
        this.dependencies.coordinator.revokeTask(this.taskId)
        await this.dependencies.infrastructure.cancelTask(this.taskId)
      })
    }
    await this.closePromise
  }
}
