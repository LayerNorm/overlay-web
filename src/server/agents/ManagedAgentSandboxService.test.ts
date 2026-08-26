import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentEnvironment } from '@overlay/workspace-contracts'
import type { SandboxCommandRequest, SandboxInstance, SandboxRuntime } from '@overlay/sandbox-runtime'
import { ManagedAgentSandboxService } from './ManagedAgentSandboxService'

test('managed provisioning uses normal enrollment, hides provider details, and records a lease', async () => {
  const previousImage = process.env.OVERLAY_AGENT_HOST_IMAGE
  process.env.OVERLAY_AGENT_HOST_IMAGE = 'overlay-agent-host:test'
  const environment: AgentEnvironment = {
    id: 'environment-1', workspaceId: 'workspace-1', kind: 'overlay_cloud', name: 'overlay-cloud-enrollme',
    status: 'pending', publicKey: 'device-public-key', capabilities: {}, createdAt: 1, updatedAt: 1,
  }
  const commands: SandboxCommandRequest[] = []
  const leases: Array<Record<string, unknown>> = []
  const audits: Array<Record<string, unknown>> = []
  try {
    const service = new ManagedAgentSandboxService({
      runtime: fakeRuntime(commands),
      controlPlane: {
        createEnrollmentSession: async () => ({ code: 'enrollment-code', expiresAt: 100, enrollmentSessionId: 'enrollment-session' }),
      } as never,
      repository: {
        listEnvironments: async () => [environment],
        createSandboxLease: async (input: Record<string, unknown>) => {
          leases.push(input)
          return { ...input, createdAt: 1, updatedAt: 1 }
        },
      } as never,
      audit: { record: async (input: Record<string, unknown>) => { audits.push(input) } } as never,
      sleep: async () => {},
    })
    const result = await service.provision({
      actorUserId: 'user-1', workspaceId: 'workspace-1', serverUrl: 'https://getoverlay.io', adapterId: 'codex',
    })
    assert.equal(result.setup.label, 'Overlay Cloud')
    assert.equal(result.setup.approvedRoot, '/workspace')
    assert.equal(result.setup.adapterId, 'codex')
    assert.equal('publicKey' in result.environment, false)
    assert.equal('provider' in result, false)
    assert.equal(commands[0]?.args?.includes('overlay_cloud'), true)
    assert.equal(commands[0]?.args?.includes('codex'), true)
    assert.equal(commands[0]?.args?.includes('claude-code'), false)
    assert.equal(leases[0]?.provider, 'vercel')
    assert.equal(leases[0]?.providerReference, 'provider-reference')
    assert.equal(audits[0]?.action, 'agent_environment.managed_provisioned')
  } finally {
    if (previousImage === undefined) delete process.env.OVERLAY_AGENT_HOST_IMAGE
    else process.env.OVERLAY_AGENT_HOST_IMAGE = previousImage
  }
})

function fakeRuntime(commands: SandboxCommandRequest[]): SandboxRuntime {
  const sandbox: SandboxInstance = {
    provider: 'vercel', reference: 'provider-reference', name: 'overlay-cloud-enrollme',
    capabilities: {
      commandStreaming: true, files: true, environmentVariables: true, ports: true,
      snapshots: true, persistence: true, networkPolicy: true, credentialBrokering: true,
      networkPolicyUpdates: true,
      hardTimeout: true, idleStop: false, usage: true,
    },
    status: async () => 'running', workingDirectory: async () => '/workspace',
    resume: async () => {}, stop: async () => {}, delete: async () => {},
    runCommand: async (request) => {
      commands.push(request)
      return {
        id: 'host-command', events: async function* () {}, cancel: async () => {},
        wait: async () => ({ commandId: 'host-command', exitCode: 0, stdout: '', stderr: '', startedAt: 1, endedAt: 2 }),
      }
    },
    writeFiles: async () => {}, readFile: async () => null, listFiles: async () => [],
    updateEnvironment: async () => {}, updateNetworkPolicy: async () => {},
    port: async (port) => ({ port, url: 'https://example.test', access: 'private' }),
    snapshot: async () => ({ id: 'snapshot', createdAt: 1 }), usage: async () => ({}),
    rawProviderDiagnosticHandle: () => null,
  }
  return {
    provider: 'vercel', capabilities: sandbox.capabilities,
    create: async () => sandbox, reconnect: async () => sandbox, restore: async () => sandbox,
    deleteSnapshot: async () => {},
  }
}
