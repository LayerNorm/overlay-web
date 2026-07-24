import { describe, expect, it, vi } from 'vitest'
import type { ToolSet } from 'ai'
import type { AgentPolicyContext } from './agent-policy-engine'
import { AgentApprovalCoordinator } from './approval-coordinator'
import { wrapToolSetWithPolicy } from './tool-policy-wrapper'

function policyContext(
  taskGrants: AgentPolicyContext['taskGrants'],
  overrides: Partial<AgentPolicyContext> = {}
): AgentPolicyContext {
  return {
    authenticated: true,
    principalId: 'user_123',
    serverDeploymentId: 'deployment_123',
    surface: 'browser',
    taskId: 'task_1234567890123456',
    permissionMode: 'ask_for_approval',
    provenance: ['model_generated', 'webpage'],
    capabilities: new Set(['browser_mutation', 'terminal']),
    taskGrants,
    infrastructure: {
      hostProcessReady: true,
      microvmReady: false,
      hostBrokerReady: false,
      agentBrowserReady: true
    },
    ...overrides
  }
}

function toolSet(name: string, execute: (input: unknown, options: unknown) => unknown): ToolSet {
  return {
    [name]: {
      description: name,
      inputSchema: {},
      execute
    }
  } as unknown as ToolSet
}

describe('tool policy wrapper', () => {
  it('fails closed before an unregistered tool can execute', () => {
    const execute = vi.fn()
    expect(() =>
      wrapToolSetWithPolicy(toolSet('unknown_tool', execute), {
        coordinator: new AgentApprovalCoordinator(),
        presenter: {
          async present() {
            return 'allow_once'
          }
        },
        createContext: (grants) => policyContext(grants),
        audit: vi.fn()
      })
    ).toThrow('unregistered_agent_tools:unknown_tool')
    expect(execute).not.toHaveBeenCalled()
  })

  it('denies execution tools while direct host execution is unavailable', async () => {
    const execute = vi.fn()
    const wrapped = wrapToolSetWithPolicy(toolSet('terminal_run', execute), {
      coordinator: new AgentApprovalCoordinator(),
      presenter: {
        async present() {
          return 'allow_once'
        }
      },
      createContext: (grants) =>
        policyContext(grants, {
          infrastructure: {
            hostProcessReady: false,
            microvmReady: false,
            hostBrokerReady: false,
            agentBrowserReady: false
          }
        }),
      audit: vi.fn()
    })
    await expect(
      (wrapped.terminal_run as { execute: (input: unknown, options: unknown) => unknown }).execute(
        { command: 'id' },
        {}
      )
    ).resolves.toEqual({
      success: false,
      error: 'agent_policy_denied',
      reason: 'host_execution_unavailable'
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('executes the frozen canonical action that was displayed and approved', async () => {
    const execute = vi.fn((input: unknown) => ({
      frozen: Object.isFrozen(input),
      input
    }))
    const original = { target: 'Submit', nested: { value: 1 } }
    const wrapped = wrapToolSetWithPolicy(toolSet('browser_click', execute), {
      coordinator: new AgentApprovalCoordinator(),
      presenter: {
        async present(request) {
          expect(request.display).toEqual(original)
          return 'allow_once'
        }
      },
      createContext: (grants) => policyContext(grants),
      audit: vi.fn()
    })
    await expect(
      (
        wrapped.browser_click as {
          execute: (input: unknown, options: unknown) => Promise<unknown>
        }
      ).execute(original, {})
    ).resolves.toEqual({
      frozen: true,
      input: { nested: { value: 1 }, target: 'Submit' }
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[0]).not.toBe(original)
  })

  it('skips the presenter only for full-access direct-host operations on chat', async () => {
    const execute = vi.fn(() => ({ success: true }))
    const present = vi.fn(async () => 'deny' as const)
    const wrapped = wrapToolSetWithPolicy(toolSet('terminal_run', execute), {
      coordinator: new AgentApprovalCoordinator(),
      presenter: { present },
      createContext: (grants) =>
        policyContext(grants, {
          surface: 'chat',
          permissionMode: 'full_access'
        }),
      audit: vi.fn()
    })

    await expect(
      (wrapped.terminal_run as { execute: (input: unknown, options: unknown) => unknown }).execute(
        { command: 'pwd' },
        {}
      )
    ).resolves.toEqual({ success: true })
    expect(present).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not execute when arguments change during approval', async () => {
    const execute = vi.fn()
    const original = { target: 'Safe button' }
    const wrapped = wrapToolSetWithPolicy(toolSet('browser_click', execute), {
      coordinator: new AgentApprovalCoordinator(),
      presenter: {
        async present() {
          original.target = 'Dangerous button'
          return 'allow_once'
        }
      },
      createContext: (grants) => policyContext(grants),
      audit: vi.fn()
    })
    await expect(
      (
        wrapped.browser_click as {
          execute: (input: unknown, options: unknown) => Promise<unknown>
        }
      ).execute(original, {})
    ).resolves.toEqual({
      success: false,
      error: 'agent_approval_denied'
    })
    expect(execute).not.toHaveBeenCalled()
  })
})
