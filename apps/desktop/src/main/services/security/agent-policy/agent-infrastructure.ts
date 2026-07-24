import { agentBrowserService } from '../../agent-browser-service'

export interface AgentInfrastructureReadiness {
  readonly hostProcessReady: boolean
  readonly microvmReady: boolean
  readonly hostBrokerReady: boolean
  readonly agentBrowserReady: boolean
}

export interface AgentTaskLimits {
  readonly cpuCount: number
  readonly memoryBytes: number
  readonly writableDiskBytes: number
  readonly processCount: number
  readonly fileCount: number
  readonly outputBytes: number
  readonly operationTimeoutMs: number
  readonly taskTimeoutMs: number
}

export interface AgentTaskDescriptor {
  readonly taskId: string
  readonly principalId: string
  readonly serverDeploymentId: string
  readonly limits: AgentTaskLimits
  readonly networkMode: 'none'
  readonly hostFilesystemMode: 'none'
  readonly inheritedEnvironment: 'none'
}

export interface IsolatedProcessRequest {
  readonly executable: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly environment: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly outputLimitBytes: number
}

export interface IsolatedProcessResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

/**
 * Contract for a reviewed, disposable execution boundary. Implementations used
 * by official builds must pass provider conformance and artifact-signing gates.
 */
export interface AgentIsolationProvider {
  readonly providerId: string
  readonly ready: boolean
  createTask(descriptor: AgentTaskDescriptor): Promise<void>
  execute(taskId: string, request: IsolatedProcessRequest): Promise<IsolatedProcessResult>
  cancelTask(taskId: string): Promise<void>
  destroyTask(taskId: string): Promise<void>
  reconcileAbandonedTasks(): Promise<void>
}

export type HostCapabilityOperation =
  | {
      readonly type: 'application.search'
      readonly query: string
      readonly limit: number
    }
  | {
      readonly type: 'application.launch'
      readonly bundleId: string
    }
  | {
      readonly type: 'contacts.search'
      readonly query: string
      readonly limit: number
    }
  | {
      readonly type: 'message.send'
      readonly recipient: string
      readonly text: string
    }
  | {
      readonly type: 'reminder.create'
      readonly title: string
      readonly dueAt?: string
      readonly listName?: string
    }
  | {
      readonly type: 'reminder.list'
      readonly listName?: string
      readonly limit: number
    }
  | {
      readonly type: 'timer.start'
      readonly durationSeconds: number
      readonly label?: string
    }
  | {
      readonly type: 'accessibility.listApplications'
    }
  | {
      readonly type: 'accessibility.readTree'
      readonly pid: number
      readonly bundleId: string
      readonly maxDepth: number
      readonly maxNodes: number
    }
  | {
      readonly type: 'accessibility.activateElement'
      readonly pid: number
      readonly bundleId: string
      readonly elementId: string
      readonly expectedRole: string
      readonly expectedTitle?: string
    }
  | {
      readonly type: 'shortcut.list'
      readonly limit: number
    }
  | {
      readonly type: 'shortcut.inspect'
      readonly shortcutId: string
    }
  | {
      readonly type: 'shortcut.run'
      readonly shortcutId: string
      readonly input?: string
    }
  | {
      readonly type: 'integration.execute'
      readonly connectionId: string
      readonly toolkit: string
      readonly action: string
      readonly mutation: boolean
      readonly arguments: Readonly<Record<string, unknown>>
    }

export interface HostCapabilityResult {
  readonly success: boolean
  readonly value?: unknown
  readonly errorCode?: string
}

/**
 * Host automation accepts only typed operations. Arbitrary shell commands,
 * AppleScript source, executable paths, and script strings are deliberately
 * absent from this contract.
 */
export interface HostCapabilityBroker {
  readonly brokerId: string
  readonly ready: boolean
  execute(
    task: Pick<AgentTaskDescriptor, 'taskId' | 'principalId' | 'serverDeploymentId'>,
    operation: HostCapabilityOperation
  ): Promise<HostCapabilityResult>
  cancelTask(taskId: string): Promise<void>
}

export interface AgentBrowserProvider {
  readonly providerId: string
  readonly ready: boolean
  cancelTask(taskId: string): Promise<void>
}

export interface DirectHostExecutionProvider {
  readonly providerId: string
  readonly ready: boolean
  readonly isolation: 'none'
  cancelTask(taskId: string): Promise<void>
}

const INFRASTRUCTURE_UNAVAILABLE = 'agent_infrastructure_unavailable'

export class DenyOnlyAgentIsolationProvider implements AgentIsolationProvider {
  readonly providerId = 'deny-only'
  readonly ready = false

  async createTask(_descriptor: AgentTaskDescriptor): Promise<void> {
    throw new Error(INFRASTRUCTURE_UNAVAILABLE)
  }

  async execute(_taskId: string, _request: IsolatedProcessRequest): Promise<IsolatedProcessResult> {
    throw new Error(INFRASTRUCTURE_UNAVAILABLE)
  }

  async cancelTask(taskId: string): Promise<void> {
    void taskId
  }

  async destroyTask(taskId: string): Promise<void> {
    void taskId
  }

  async reconcileAbandonedTasks(): Promise<void> {
    return
  }
}

export class DenyOnlyHostCapabilityBroker implements HostCapabilityBroker {
  readonly brokerId = 'deny-only'
  readonly ready = false

  async execute(
    _task: Pick<AgentTaskDescriptor, 'taskId' | 'principalId' | 'serverDeploymentId'>,
    _operation: HostCapabilityOperation
  ): Promise<HostCapabilityResult> {
    return { success: false, errorCode: INFRASTRUCTURE_UNAVAILABLE }
  }

  async cancelTask(taskId: string): Promise<void> {
    void taskId
  }
}

export class DenyOnlyAgentBrowserProvider implements AgentBrowserProvider {
  readonly providerId = 'deny-only'
  readonly ready = false

  async cancelTask(taskId: string): Promise<void> {
    void taskId
  }
}

export class EphemeralAgentBrowserProvider implements AgentBrowserProvider {
  readonly providerId = 'ephemeral-task-browser'
  readonly ready = true

  async cancelTask(taskId: string): Promise<void> {
    await agentBrowserService.destroyTask(taskId)
  }
}

/**
 * Explicit legacy provider selected by the owner while microVM isolation is
 * deferred. It is a policy marker, not a sandbox.
 */
export class PermissionedDirectHostExecutionProvider implements DirectHostExecutionProvider {
  readonly providerId = 'permissioned-direct-host'
  readonly ready: boolean
  readonly isolation = 'none' as const

  constructor(platform: NodeJS.Platform = process.platform) {
    this.ready = platform === 'darwin'
  }

  async cancelTask(taskId: string): Promise<void> {
    void taskId
  }
}

export class AgentInfrastructure {
  constructor(
    private readonly isolation: AgentIsolationProvider,
    private readonly hostBroker: HostCapabilityBroker,
    private readonly browser: AgentBrowserProvider,
    private readonly directHost: DirectHostExecutionProvider
  ) {}

  readiness(): AgentInfrastructureReadiness {
    return Object.freeze({
      hostProcessReady: this.directHost.ready === true,
      microvmReady: this.isolation.ready === true,
      hostBrokerReady: this.hostBroker.ready === true,
      agentBrowserReady: this.browser.ready === true
    })
  }

  async cancelTask(taskId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(taskId)) return
    await Promise.allSettled([
      this.isolation.cancelTask(taskId),
      this.isolation.destroyTask(taskId),
      this.hostBroker.cancelTask(taskId),
      this.browser.cancelTask(taskId),
      this.directHost.cancelTask(taskId)
    ])
  }
}

export const agentInfrastructure = new AgentInfrastructure(
  new DenyOnlyAgentIsolationProvider(),
  new DenyOnlyHostCapabilityBroker(),
  new EphemeralAgentBrowserProvider(),
  new PermissionedDirectHostExecutionProvider()
)
