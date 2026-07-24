import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentPolicyContext } from './agent-policy-engine'
import { AgentPolicyEngine } from './agent-policy-engine'
import { AgentApprovalCoordinator, type ApprovalPresenter } from './approval-coordinator'

function context(overrides: Partial<AgentPolicyContext> = {}): AgentPolicyContext {
  return {
    authenticated: true,
    principalId: 'user_123',
    serverDeploymentId: 'deployment_123',
    surface: 'browser',
    taskId: 'task_1234567890123456',
    permissionMode: 'ask_for_approval',
    provenance: ['model_generated', 'webpage'],
    capabilities: new Set(['browser_read', 'browser_mutation']),
    taskGrants: new Set(),
    infrastructure: {
      hostProcessReady: true,
      microvmReady: false,
      hostBrokerReady: false,
      agentBrowserReady: true
    },
    ...overrides
  }
}

describe('AgentApprovalCoordinator', () => {
  const engine = new AgentPolicyEngine()

  afterEach(() => {
    vi.useRealTimers()
  })

  it('binds an allow-once response to the exact action', async () => {
    const coordinator = new AgentApprovalCoordinator()
    const policyContext = context()
    const decision = engine.evaluate('browser_click', policyContext)
    const presenter: ApprovalPresenter = {
      async present(request) {
        expect(request.display).toEqual({ target: 'Submit' })
        return 'allow_once'
      }
    }
    await expect(
      coordinator.authorize(policyContext, decision, { target: 'Submit' }, presenter, {
        now: 1_000
      })
    ).resolves.toEqual({ target: 'Submit' })
  })

  it('creates only typed, identity-bound task grants', async () => {
    const coordinator = new AgentApprovalCoordinator()
    const policyContext = context({
      capabilities: new Set(['memory_write'])
    })
    const decision = engine.evaluate('memory_add', policyContext)
    await expect(
      coordinator.authorize(
        policyContext,
        decision,
        { content: 'Remember this preference' },
        {
          async present() {
            return 'allow_task'
          }
        },
        { now: 1_000, taskGrantTtlMs: 30_000 }
      )
    ).resolves.toEqual({ content: 'Remember this preference' })

    expect([...coordinator.getTaskGrants(policyContext, 2_000)]).toEqual(['memory_write'])
    expect(
      coordinator.getTaskGrants({ ...policyContext, principalId: 'user_attacker' }, 2_000).size
    ).toBe(0)
  })

  it('does not convert contextual approval into a reusable task grant', async () => {
    const coordinator = new AgentApprovalCoordinator()
    const policyContext = context()
    const decision = engine.evaluate('browser_type', policyContext)
    await expect(
      coordinator.authorize(
        policyContext,
        decision,
        { target: 'Email', text: 'private@example.com' },
        {
          async present() {
            return 'allow_task'
          }
        },
        { now: 1_000 }
      )
    ).resolves.toBeNull()
    expect(coordinator.getTaskGrants(policyContext, 2_000).size).toBe(0)
  })

  it('rejects argument mutation while the approval dialog is open', async () => {
    const coordinator = new AgentApprovalCoordinator()
    const policyContext = context()
    const decision = engine.evaluate('browser_click', policyContext)
    const args = { target: 'Safe button' }
    await expect(
      coordinator.authorize(
        policyContext,
        decision,
        args,
        {
          async present() {
            args.target = 'Dangerous button'
            return 'allow_once'
          }
        },
        { now: 1_000 }
      )
    ).resolves.toBeNull()
  })

  it('rejects an approval response received after its real expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const coordinator = new AgentApprovalCoordinator()
    const policyContext = context()
    const decision = engine.evaluate('browser_click', policyContext)
    await expect(
      coordinator.authorize(
        policyContext,
        decision,
        { target: 'Submit' },
        {
          async present() {
            vi.setSystemTime(3 * 60_000)
            return 'allow_once'
          }
        }
      )
    ).resolves.toBeNull()
  })

  it('serializes approvals per task and revokes grants explicitly', async () => {
    const coordinator = new AgentApprovalCoordinator()
    const policyContext = context()
    const decision = engine.evaluate('browser_click', policyContext)
    let release: (() => void) | undefined
    const first = coordinator.authorize(
      policyContext,
      decision,
      { target: 'First' },
      {
        present: () =>
          new Promise((resolve) => {
            release = () => resolve('deny')
          })
      },
      { now: 1_000 }
    )
    await Promise.resolve()
    await expect(
      coordinator.authorize(
        policyContext,
        decision,
        { target: 'Second' },
        {
          async present() {
            return 'allow_once'
          }
        },
        { now: 1_000 }
      )
    ).resolves.toBeNull()
    release?.()
    await expect(first).resolves.toBeNull()

    coordinator.revokeTask(policyContext.taskId)
    expect(coordinator.getTaskGrants(policyContext).size).toBe(0)
  })
})
