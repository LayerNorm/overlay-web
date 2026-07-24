import {
  getToolRegistration,
  type AgentCapability,
  type AgentSurface,
  type ToolRegistration
} from './tool-registry'
import {
  isChatToolPermissionMode,
  type ChatToolPermissionMode
} from '../../../../types/agent-permissions'

export const PROVENANCE_LABELS = [
  'user_input',
  'webpage',
  'document',
  'memory',
  'retrieved_file',
  'tool_output',
  'integration_output',
  'model_generated'
] as const
export type ProvenanceLabel = (typeof PROVENANCE_LABELS)[number]

export interface AgentPolicyContext {
  readonly authenticated: boolean
  readonly principalId?: string
  readonly serverDeploymentId?: string
  readonly surface: AgentSurface
  readonly taskId: string
  readonly permissionMode: ChatToolPermissionMode
  readonly provenance: readonly ProvenanceLabel[]
  readonly capabilities: ReadonlySet<AgentCapability>
  readonly taskGrants: ReadonlySet<AgentCapability>
  readonly infrastructure: {
    readonly hostProcessReady: boolean
    readonly microvmReady: boolean
    readonly hostBrokerReady: boolean
    readonly agentBrowserReady: boolean
  }
}

export type AgentPolicyDecision =
  | {
      readonly outcome: 'deny'
      readonly reason:
        | 'unknown_tool'
        | 'authentication_required'
        | 'invalid_task_context'
        | 'surface_forbidden'
        | 'capability_missing'
        | 'host_execution_unavailable'
        | 'isolation_unavailable'
        | 'host_broker_unavailable'
        | 'agent_browser_unavailable'
    }
  | {
      readonly outcome: 'allow'
      readonly registration: ToolRegistration
    }
  | {
      readonly outcome: 'require_approval'
      readonly approval: 'task_grant' | 'contextual'
      readonly registration: ToolRegistration
    }

export class AgentPolicyEngine {
  evaluate(toolName: string, context: AgentPolicyContext): AgentPolicyDecision {
    const registration = getToolRegistration(toolName)
    if (!registration) return { outcome: 'deny', reason: 'unknown_tool' }
    if (!isValidTaskContext(context)) {
      return { outcome: 'deny', reason: 'invalid_task_context' }
    }
    if (registration.requiresAuthentication && !context.authenticated) {
      return { outcome: 'deny', reason: 'authentication_required' }
    }
    if (!registration.allowedSurfaces.includes(context.surface)) {
      return { outcome: 'deny', reason: 'surface_forbidden' }
    }
    if (registration.capability && !context.capabilities.has(registration.capability)) {
      return { outcome: 'deny', reason: 'capability_missing' }
    }
    if (
      registration.executionTarget === 'host_process' &&
      !context.infrastructure.hostProcessReady
    ) {
      return { outcome: 'deny', reason: 'host_execution_unavailable' }
    }
    if (registration.executionTarget === 'microvm' && !context.infrastructure.microvmReady) {
      return { outcome: 'deny', reason: 'isolation_unavailable' }
    }
    if (registration.executionTarget === 'host_broker' && !context.infrastructure.hostBrokerReady) {
      return { outcome: 'deny', reason: 'host_broker_unavailable' }
    }
    if (
      registration.executionTarget === 'agent_browser' &&
      !context.infrastructure.agentBrowserReady
    ) {
      return { outcome: 'deny', reason: 'agent_browser_unavailable' }
    }

    if (
      context.permissionMode === 'full_access' &&
      context.surface === 'chat' &&
      (registration.executionTarget === 'host_process' ||
        registration.executionTarget === 'agent_browser')
    ) {
      return { outcome: 'allow', registration }
    }

    // While isolation is deferred, every direct host operation gets a fresh,
    // exact-action approval in the default mode. Task-wide grants never become
    // an implicit unrestricted shell/filesystem permission.
    if (registration.executionTarget === 'host_process') {
      return {
        outcome: 'require_approval',
        approval: 'contextual',
        registration
      }
    }

    if (registration.approval === 'task_grant') {
      if (!registration.capability || !context.taskGrants.has(registration.capability)) {
        return {
          outcome: 'require_approval',
          approval: 'task_grant',
          registration
        }
      }
    } else if (registration.approval === 'contextual') {
      return {
        outcome: 'require_approval',
        approval: 'contextual',
        registration
      }
    }

    return { outcome: 'allow', registration }
  }
}

function isValidTaskContext(context: AgentPolicyContext): boolean {
  if (
    !context ||
    typeof context.taskId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(context.taskId)
  ) {
    return false
  }
  if (!isChatToolPermissionMode(context.permissionMode)) return false
  if (
    context.authenticated &&
    (typeof context.principalId !== 'string' ||
      context.principalId.length < 3 ||
      context.principalId.length > 512 ||
      typeof context.serverDeploymentId !== 'string' ||
      context.serverDeploymentId.length < 1 ||
      context.serverDeploymentId.length > 512)
  ) {
    return false
  }
  return (
    Array.isArray(context.provenance) &&
    context.provenance.length > 0 &&
    context.provenance.every((label) => (PROVENANCE_LABELS as readonly string[]).includes(label))
  )
}

export const agentPolicyEngine = new AgentPolicyEngine()
