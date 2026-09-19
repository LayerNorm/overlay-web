import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentEnvironment } from '@overlay/workspace-contracts'
import type { SandboxCommandRequest, SandboxCreateRequest, SandboxInstance, SandboxRuntime } from '@overlay/sandbox-runtime'
import {
  ManagedAgentSandboxService,
  ManagedAgentSandboxError,
  managedSandboxRuntimeFromEnv,
} from './ManagedAgentSandboxService'

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

test('harness provisioning skips enrollment, writes an approved overlay_cloud environment, and opens the bridge port', async () => {
  const previous = {
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
  }
  process.env.VERCEL_TOKEN = 'token'
  process.env.VERCEL_TEAM_ID = 'team'
  process.env.VERCEL_PROJECT_ID = 'project'
  const commands: SandboxCommandRequest[] = []
  const creates: SandboxCreateRequest[] = []
  const environments: Array<Record<string, unknown>> = []
  const leases: Array<Record<string, unknown>> = []
  const audits: Array<Record<string, unknown>> = []
  try {
    const service = new ManagedAgentSandboxService({
      runtime: fakeRuntime(commands, creates),
      controlPlane: {
        createEnrollmentSession: async () => { throw new Error('enrollment must not run for harness mode') },
      } as never,
      repository: {
        createEnvironment: async (input: Record<string, unknown>) => {
          environments.push(input)
          return { ...input, createdAt: input.now, updatedAt: input.now }
        },
        createSandboxLease: async (input: Record<string, unknown>) => {
          leases.push(input)
          return { ...input, createdAt: 1, updatedAt: 1 }
        },
      } as never,
      audit: { record: async (input: Record<string, unknown>) => { audits.push(input) } } as never,
      sleep: async () => {},
    })
    const result = await service.provision({
      actorUserId: 'user-1', workspaceId: 'workspace-1', serverUrl: 'https://getoverlay.io',
      mode: 'harness', harnessId: 'claude-code',
    })
    assert.equal(result.setup.mode, 'harness')
    assert.equal(result.setup.harnessId, 'claude-code')
    assert.equal(result.setup.provider, 'vercel')
    assert.equal(commands.length, 0, 'harness mode must not boot an agent host')
    assert.deepEqual(creates[0]?.ports, [4000], 'bridge harness must expose its sandbox port')
    assert.equal(creates[0]?.networkPolicy?.mode, 'allowlist')
    assert.equal(creates[0]?.networkPolicy?.domains.includes('api.anthropic.com'), true)
    assert.equal(creates[0]?.networkPolicy?.deniedCidrs?.includes('169.254.0.0/16'), true)
    const environment = environments[0]
    assert.equal(environment?.kind, 'overlay_cloud')
    assert.equal(environment?.status, 'online')
    assert.equal(typeof environment?.approvedAt, 'number')
    assert.equal((environment?.approvedAt as number) > 0, true)
    assert.equal(environment?.approvedByUserId, 'user-1')
    assert.deepEqual(
      (environment?.capabilities as { adapters?: Array<Record<string, unknown>> })?.adapters,
      [{ id: 'claude-code', protocol: 'harness' }],
    )
    assert.deepEqual(environment?.filesystemGrant, { mode: 'selected_roots', roots: ['/workspace'] })
    assert.equal(leases[0]?.providerReference, 'provider-reference')
    assert.equal((audits[0]?.metadata as Record<string, unknown>)?.harnessId, 'claude-code')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('agent-host provisioning on box skips the image, allows all egress, and bootstraps via npx', async () => {
  const previousImage = process.env.OVERLAY_AGENT_HOST_IMAGE
  delete process.env.OVERLAY_AGENT_HOST_IMAGE
  const environment: AgentEnvironment = {
    id: 'environment-1', workspaceId: 'workspace-1', kind: 'overlay_cloud', name: 'overlay-cloud-enrollme',
    status: 'pending', publicKey: 'device-public-key', capabilities: {}, createdAt: 1, updatedAt: 1,
  }
  const commands: SandboxCommandRequest[] = []
  const creates: SandboxCreateRequest[] = []
  const leases: Array<Record<string, unknown>> = []
  try {
    const service = new ManagedAgentSandboxService({
      runtime: fakeRuntime(commands, creates, 'box'),
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
      audit: { record: async () => {} } as never,
      sleep: async () => {},
    })
    const result = await service.provision({
      actorUserId: 'user-1', workspaceId: 'workspace-1', serverUrl: 'https://getoverlay.io', adapterId: 'codex',
    })
    assert.equal(result.setup.label, 'Overlay Cloud')
    // No image requirement, no egress allowlist — box carries no secrets.
    assert.equal(creates[0]?.image, undefined)
    assert.equal(creates[0]?.networkPolicy?.mode, 'allow_all')
    // The host installs via npx and keeps the same connect args.
    assert.equal(commands[0]?.command, 'npx')
    assert.equal(commands[0]?.args?.[0], '-y')
    assert.equal(commands[0]?.args?.[1], '@layernorm/overlay-agent-host')
    assert.equal(commands[0]?.args?.includes('connect'), true)
    assert.equal(commands[0]?.args?.includes('enrollment-code'), true)
    assert.equal(leases[0]?.provider, 'box')
  } finally {
    if (previousImage === undefined) delete process.env.OVERLAY_AGENT_HOST_IMAGE
    else process.env.OVERLAY_AGENT_HOST_IMAGE = previousImage
  }
})

test('managedSandboxRuntimeFromEnv resolves box by default when BOX_API_KEY is set', () => {
  const previous = {
    BOX_API_KEY: process.env.BOX_API_KEY,
    OVERLAY_MANAGED_SANDBOX_PROVIDER: process.env.OVERLAY_MANAGED_SANDBOX_PROVIDER,
  }
  try {
    delete process.env.OVERLAY_MANAGED_SANDBOX_PROVIDER
    process.env.BOX_API_KEY = 'box-key'
    assert.equal(managedSandboxRuntimeFromEnv().provider, 'box')
    // The env override still wins, and box can be pinned explicitly.
    process.env.OVERLAY_MANAGED_SANDBOX_PROVIDER = 'vercel'
    delete process.env.BOX_API_KEY
    assert.equal(managedSandboxRuntimeFromEnv().provider, 'vercel')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('managedSandboxRuntimeFromEnv fails loudly when box lacks credentials', () => {
  const previous = process.env.BOX_API_KEY
  delete process.env.BOX_API_KEY
  try {
    assert.throws(
      () => managedSandboxRuntimeFromEnv('box'),
      (error: unknown) => error instanceof ManagedAgentSandboxError && error.code === 'managed_sandbox_provider_invalid',
    )
  } finally {
    if (previous === undefined) delete process.env.BOX_API_KEY
    else process.env.BOX_API_KEY = previous
  }
})

test('harness provisioning rejects unsupported harnesses and providers loudly', async () => {
  const service = new ManagedAgentSandboxService({
    runtime: fakeRuntime([], []),
    controlPlane: {} as never,
    repository: {} as never,
    audit: { record: async () => {} } as never,
    sleep: async () => {},
  })
  await assert.rejects(
    () => service.provision({
      actorUserId: 'user-1', workspaceId: 'workspace-1', serverUrl: 'https://getoverlay.io',
      mode: 'harness', harnessId: 'not-a-harness' as never,
    }),
    (error: unknown) => error instanceof ManagedAgentSandboxError && error.code === 'harness_invalid',
  )
  await assert.rejects(
    () => service.provision({
      actorUserId: 'user-1', workspaceId: 'workspace-1', serverUrl: 'https://getoverlay.io',
      mode: 'harness', harnessId: 'codex', provider: 'box',
    }),
    (error: unknown) => error instanceof ManagedAgentSandboxError && error.code === 'managed_sandbox_provider_invalid',
  )
})

function fakeRuntime(commands: SandboxCommandRequest[], creates?: SandboxCreateRequest[], provider = 'vercel'): SandboxRuntime {
  const sandbox: SandboxInstance = {
    provider: provider as SandboxInstance['provider'], reference: 'provider-reference', name: 'overlay-cloud-enrollme',
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
    provider: provider as SandboxRuntime['provider'], capabilities: sandbox.capabilities,
    create: async (request) => {
      creates?.push(request)
      return sandbox
    },
    reconnect: async () => sandbox, restore: async () => sandbox,
    deleteSnapshot: async () => {},
  }
}
