import type { ToolSet } from 'ai'
import { agentPolicyEngine, type AgentPolicyContext } from './agent-policy-engine'
import {
  agentApprovalCoordinator,
  type AgentApprovalCoordinator,
  type ApprovalPresenter
} from './approval-coordinator'
import { assertEveryToolIsRegistered } from './tool-registry'

type ExecutableTool = {
  execute?: (input: unknown, options: unknown) => unknown
}

export interface ToolPolicyRuntime {
  readonly coordinator?: AgentApprovalCoordinator
  readonly presenter: ApprovalPresenter
  createContext(taskGrants: AgentPolicyContext['taskGrants']): AgentPolicyContext
  audit(toolName: string, outcome: 'allow' | 'deny', reason: string): void
}

export function wrapToolSetWithPolicy(tools: ToolSet, runtime: ToolPolicyRuntime): ToolSet {
  const toolNames = Object.keys(tools)
  assertEveryToolIsRegistered(toolNames)
  const coordinator = runtime.coordinator ?? agentApprovalCoordinator

  for (const [toolName, definition] of Object.entries(tools)) {
    const originalExecute = (definition as ExecutableTool).execute
    if (typeof originalExecute !== 'function') continue

    tools[toolName] = {
      ...definition,
      execute: async (input: unknown, executionOptions: unknown) => {
        const baseContext = runtime.createContext(new Set())
        const activeTaskGrants = coordinator.getTaskGrants(baseContext)
        const context = runtime.createContext(activeTaskGrants)
        const decision = agentPolicyEngine.evaluate(toolName, context)
        if (decision.outcome === 'deny') {
          runtime.audit(toolName, 'deny', decision.reason)
          return {
            success: false,
            error: 'agent_policy_denied',
            reason: decision.reason
          }
        }
        if (decision.outcome === 'require_approval') {
          const canonicalArguments = toCanonicalArguments(input)
          const approvedArguments = await coordinator.authorize(
            context,
            decision,
            canonicalArguments,
            runtime.presenter
          )
          if (!approvedArguments) {
            runtime.audit(toolName, 'deny', 'approval_denied')
            return {
              success: false,
              error: 'agent_approval_denied'
            }
          }
          runtime.audit(toolName, 'allow', decision.outcome)
          return originalExecute(approvedArguments, executionOptions)
        }
        runtime.audit(toolName, 'allow', decision.outcome)
        return originalExecute(input, executionOptions)
      }
    } as typeof definition
  }
  return tools
}

function toCanonicalArguments(input: unknown): Readonly<Record<string, unknown>> {
  if (
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null)
  ) {
    return input as Record<string, unknown>
  }
  return { value: input }
}
