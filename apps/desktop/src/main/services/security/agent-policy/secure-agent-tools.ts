import type { ToolSet } from 'ai'
import { safeStorageService } from '../safe-storage-service'
import { serverProfileService } from '../server-profile-service'
import { auditLogger } from '../security-service'
import { agentInfrastructure } from './agent-infrastructure'
import type { AgentPolicyContext, ProvenanceLabel } from './agent-policy-engine'
import { nativeAgentApprovalPresenter } from './native-approval-presenter'
import { getToolRegistration, type AgentCapability, type AgentSurface } from './tool-registry'
import { wrapToolSetWithPolicy } from './tool-policy-wrapper'
import type { ChatToolPermissionMode } from '../../../../types/agent-permissions'

export interface SecureAgentToolOptions {
  readonly surface: AgentSurface
  readonly provenance?: readonly ProvenanceLabel[]
  readonly taskId: string
  readonly permissionMode: ChatToolPermissionMode
}

export function secureAgentToolSet(tools: ToolSet, options: SecureAgentToolOptions): ToolSet {
  const toolNames = Object.keys(tools)
  const taskId = options.taskId
  const capabilities = capabilitiesForToolSet(toolNames)

  return wrapToolSetWithPolicy(tools, {
    presenter: nativeAgentApprovalPresenter,
    createContext(taskGrants) {
      return createPolicyContext(options, taskId, capabilities, taskGrants)
    },
    audit(toolName, outcome, reason) {
      auditDecision(toolName, taskId, outcome, reason)
    }
  })
}

function createPolicyContext(
  options: SecureAgentToolOptions,
  taskId: string,
  capabilities: ReadonlySet<AgentCapability>,
  taskGrants: ReadonlySet<AgentCapability>
): AgentPolicyContext {
  const session = safeStorageService.getAuthSessionMetadata()
  const profile = serverProfileService.getActiveProfile()
  return {
    authenticated: session !== null,
    ...(session ? { principalId: session.user.id } : {}),
    ...(session ? { serverDeploymentId: profile.deploymentId } : {}),
    surface: options.surface,
    taskId,
    permissionMode: options.permissionMode,
    provenance:
      options.provenance && options.provenance.length > 0
        ? options.provenance
        : ['model_generated'],
    capabilities,
    taskGrants,
    // Readiness is owned by main-process provider instances. Renderer data,
    // prompts, tool results, and environment variables cannot enable it.
    infrastructure: agentInfrastructure.readiness()
  }
}

function capabilitiesForToolSet(toolNames: readonly string[]): ReadonlySet<AgentCapability> {
  const capabilities = new Set<AgentCapability>()
  for (const toolName of toolNames) {
    const capability = getToolRegistration(toolName)?.capability
    if (capability) capabilities.add(capability)
  }
  return capabilities
}

function auditDecision(
  toolName: string,
  taskId: string,
  outcome: 'allow' | 'deny',
  reason: string
): void {
  auditLogger.log({
    type: 'ipc:sensitive_call',
    action: 'agent:policy_decision',
    details: {
      toolName,
      taskId,
      outcome,
      reason
    },
    success: outcome === 'allow'
  })
}
