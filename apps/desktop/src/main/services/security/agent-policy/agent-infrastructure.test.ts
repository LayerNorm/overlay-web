import { describe, expect, it, vi } from 'vitest'
import {
  AgentInfrastructure,
  DenyOnlyAgentBrowserProvider,
  DenyOnlyAgentIsolationProvider,
  DenyOnlyHostCapabilityBroker,
  PermissionedDirectHostExecutionProvider,
  type AgentBrowserProvider,
  type AgentIsolationProvider,
  type DirectHostExecutionProvider,
  type HostCapabilityBroker
} from './agent-infrastructure'

describe('AgentInfrastructure', () => {
  it('keeps future isolation providers denied while exposing the explicit host-risk provider', async () => {
    const isolation = new DenyOnlyAgentIsolationProvider()
    const broker = new DenyOnlyHostCapabilityBroker()
    const browser = new DenyOnlyAgentBrowserProvider()
    const directHost = new PermissionedDirectHostExecutionProvider('darwin')
    const infrastructure = new AgentInfrastructure(isolation, broker, browser, directHost)

    expect(infrastructure.readiness()).toEqual({
      hostProcessReady: true,
      microvmReady: false,
      hostBrokerReady: false,
      agentBrowserReady: false
    })
    await expect(
      isolation.createTask({
        taskId: 'task_1234567890123456',
        principalId: 'user_123',
        serverDeploymentId: 'deployment_123',
        networkMode: 'none',
        hostFilesystemMode: 'none',
        inheritedEnvironment: 'none',
        limits: {
          cpuCount: 1,
          memoryBytes: 1024,
          writableDiskBytes: 1024,
          processCount: 1,
          fileCount: 1,
          outputBytes: 1024,
          operationTimeoutMs: 1_000,
          taskTimeoutMs: 2_000
        }
      })
    ).rejects.toThrow('agent_infrastructure_unavailable')
    await expect(
      broker.execute(
        {
          taskId: 'task_1234567890123456',
          principalId: 'user_123',
          serverDeploymentId: 'deployment_123'
        },
        { type: 'application.launch', bundleId: 'com.example.Safe' }
      )
    ).resolves.toEqual({
      success: false,
      errorCode: 'agent_infrastructure_unavailable'
    })
  })

  it('fails closed outside the supported macOS desktop target', () => {
    expect(new PermissionedDirectHostExecutionProvider('darwin').ready).toBe(true)
    expect(new PermissionedDirectHostExecutionProvider('linux').ready).toBe(false)
    expect(new PermissionedDirectHostExecutionProvider('win32').ready).toBe(false)
  })

  it('cancels every provider and destroys disposable isolation state', async () => {
    const isolation = provider<AgentIsolationProvider>('isolation')
    const broker = provider<HostCapabilityBroker>('broker')
    const browser = provider<AgentBrowserProvider>('browser')
    const directHost = provider<DirectHostExecutionProvider>('direct-host')
    const infrastructure = new AgentInfrastructure(isolation, broker, browser, directHost)

    await infrastructure.cancelTask('task_1234567890123456')

    expect(isolation.cancelTask).toHaveBeenCalledWith('task_1234567890123456')
    expect(isolation.destroyTask).toHaveBeenCalledWith('task_1234567890123456')
    expect(broker.cancelTask).toHaveBeenCalledWith('task_1234567890123456')
    expect(browser.cancelTask).toHaveBeenCalledWith('task_1234567890123456')
    expect(directHost.cancelTask).toHaveBeenCalledWith('task_1234567890123456')
  })

  it('ignores malformed cancellation identifiers', async () => {
    const isolation = provider<AgentIsolationProvider>('isolation')
    const broker = provider<HostCapabilityBroker>('broker')
    const browser = provider<AgentBrowserProvider>('browser')
    const directHost = provider<DirectHostExecutionProvider>('direct-host')
    const infrastructure = new AgentInfrastructure(isolation, broker, browser, directHost)

    await infrastructure.cancelTask('../all')

    expect(isolation.cancelTask).not.toHaveBeenCalled()
    expect(isolation.destroyTask).not.toHaveBeenCalled()
    expect(broker.cancelTask).not.toHaveBeenCalled()
    expect(browser.cancelTask).not.toHaveBeenCalled()
    expect(directHost.cancelTask).not.toHaveBeenCalled()
  })
})

function provider<T>(id: string): T {
  return {
    providerId: id,
    brokerId: id,
    ready: true,
    isolation: 'none',
    createTask: vi.fn(),
    execute: vi.fn(),
    cancelTask: vi.fn(),
    destroyTask: vi.fn(),
    reconcileAbandonedTasks: vi.fn()
  } as unknown as T
}
