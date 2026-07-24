import { describe, expect, it } from 'vitest'
import { AgentPolicyEngine, type AgentPolicyContext } from './agent-policy-engine'
import {
  assertEveryToolIsRegistered,
  getToolRegistration,
  listStaticToolRegistrations
} from './tool-registry'

function context(overrides: Partial<AgentPolicyContext> = {}): AgentPolicyContext {
  return {
    authenticated: true,
    principalId: 'user_123',
    serverDeploymentId: 'deployment_123',
    surface: 'chat',
    taskId: 'task_1234567890123456',
    permissionMode: 'ask_for_approval',
    provenance: ['model_generated'],
    capabilities: new Set([
      'memory_read',
      'memory_write',
      'network_read',
      'browser_read',
      'browser_mutation',
      'os_automation',
      'terminal',
      'filesystem_read',
      'filesystem_write',
      'runtime_execution',
      'package_installation',
      'integration_read',
      'integration_mutation',
      'coding'
    ]),
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

describe('AgentPolicyEngine', () => {
  const engine = new AgentPolicyEngine()

  it('fails closed for unknown tools and invalid task context', () => {
    expect(engine.evaluate('not_registered', context())).toEqual({
      outcome: 'deny',
      reason: 'unknown_tool'
    })
    expect(engine.evaluate('get_current_time', context({ taskId: 'short' }))).toEqual({
      outcome: 'deny',
      reason: 'invalid_task_context'
    })
  })

  it('allows pure tools and denies missing authentication, surface, and capabilities', () => {
    expect(engine.evaluate('get_current_time', context({ authenticated: false }))).toMatchObject({
      outcome: 'allow'
    })
    expect(engine.evaluate('memory_search', context({ authenticated: false }))).toEqual({
      outcome: 'deny',
      reason: 'authentication_required'
    })
    expect(engine.evaluate('finish', context())).toEqual({
      outcome: 'deny',
      reason: 'surface_forbidden'
    })
    expect(engine.evaluate('memory_search', context({ capabilities: new Set() }))).toEqual({
      outcome: 'deny',
      reason: 'capability_missing'
    })
  })

  it('will not authorize direct host tools when the permissioned provider is unavailable', () => {
    const unavailable = context({
      infrastructure: {
        hostProcessReady: false,
        microvmReady: false,
        hostBrokerReady: false,
        agentBrowserReady: false
      }
    })
    for (const toolName of ['terminal_run', 'imessage_send']) {
      expect(engine.evaluate(toolName, unavailable)).toEqual({
        outcome: 'deny',
        reason: 'host_execution_unavailable'
      })
    }
    expect(engine.evaluate('browser_click', unavailable)).toEqual({
      outcome: 'deny',
      reason: 'agent_browser_unavailable'
    })
  })

  it('requires fresh host approval and a scoped grant for isolated browser reads', () => {
    expect(engine.evaluate('terminal_run', context())).toMatchObject({
      outcome: 'require_approval',
      approval: 'contextual'
    })
    expect(engine.evaluate('browser_get_page_content', context())).toMatchObject({
      outcome: 'require_approval',
      approval: 'task_grant'
    })
  })

  it('allows registered host and isolated-browser operations without prompts only in full access mode', () => {
    expect(
      engine.evaluate('terminal_run', context({ permissionMode: 'full_access' }))
    ).toMatchObject({ outcome: 'allow' })
    expect(
      engine.evaluate('browser_type', context({ permissionMode: 'full_access' }))
    ).toMatchObject({ outcome: 'allow' })
  })

  it('does not let full access bypass identity, capability, surface, or provider gates', () => {
    expect(
      engine.evaluate(
        'memory_search',
        context({ authenticated: false, permissionMode: 'full_access' })
      )
    ).toEqual({ outcome: 'deny', reason: 'authentication_required' })
    expect(
      engine.evaluate(
        'terminal_run',
        context({ capabilities: new Set(), permissionMode: 'full_access' })
      )
    ).toEqual({ outcome: 'deny', reason: 'capability_missing' })
    expect(engine.evaluate('finish', context({ permissionMode: 'full_access' }))).toEqual({
      outcome: 'deny',
      reason: 'surface_forbidden'
    })
    expect(
      engine.evaluate(
        'terminal_run',
        context({
          permissionMode: 'full_access',
          infrastructure: {
            hostProcessReady: false,
            microvmReady: false,
            hostBrokerReady: false,
            agentBrowserReady: false
          }
        })
      )
    ).toEqual({ outcome: 'deny', reason: 'host_execution_unavailable' })
  })

  it('limits full access approval bypass to permission-controlled operations on desktop chat', () => {
    expect(
      engine.evaluate(
        'terminal_run',
        context({
          surface: 'browser',
          permissionMode: 'full_access'
        })
      )
    ).toMatchObject({
      outcome: 'require_approval',
      approval: 'contextual'
    })

    expect(
      engine.evaluate(
        'memory_add',
        context({
          surface: 'chat',
          permissionMode: 'full_access'
        })
      )
    ).toMatchObject({
      outcome: 'require_approval',
      approval: 'task_grant'
    })
  })

  it('classifies dynamic Composio tools as mutations requiring brokered approval', () => {
    expect(getToolRegistration('COMPOSIO_MULTI_EXECUTE_TOOL')).toMatchObject({
      securityClass: 'integration_mutation',
      executionTarget: 'host_process',
      approval: 'contextual'
    })
  })

  it('contains no duplicate or missing static registrations', () => {
    const names = listStaticToolRegistrations().map(({ name }) => name)
    expect(new Set(names).size).toBe(names.length)
    expect(() => assertEveryToolIsRegistered(names)).not.toThrow()
  })
})
