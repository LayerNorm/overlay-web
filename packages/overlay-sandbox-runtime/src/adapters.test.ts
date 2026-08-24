import assert from 'node:assert/strict'
import test from 'node:test'
import type { Daytona, Sandbox as DaytonaSandbox } from '@daytona/sdk'
import type { Sandbox, Snapshot } from '@vercel/sandbox'
import { DaytonaSandboxRuntime } from './daytona'
import type { SandboxCreateRequest } from './contracts'
import { VercelSandboxRuntime, type VercelSandboxSdk } from './vercel'

test('Vercel adapter maps the Overlay policy to the official SDK without leaking SDK values', async () => {
  let createParams: Parameters<VercelSandboxSdk['create']>[0] | undefined
  const sandbox = {
    name: 'overlay-vercel',
    status: 'running',
    [Symbol.asyncDispose]: async () => {},
  } as unknown as Sandbox & AsyncDisposable
  const sdk: VercelSandboxSdk = {
    create: async (params) => { createParams = params; return sandbox },
    get: async () => sandbox,
    getSnapshot: async () => ({ delete: async () => {} }) as unknown as Snapshot,
  }
  const instance = await new VercelSandboxRuntime({ sdk }).create(request('overlay-vercel'))

  assert.equal(instance.provider, 'vercel')
  assert.equal(instance.reference, 'overlay-vercel')
  assert.deepEqual(createParams, {
    name: 'overlay-vercel',
    persistent: true,
    timeout: 600_000,
    ports: [3000],
    resources: { vcpus: 2 },
    networkPolicy: { allow: ['getoverlay.io'], subnets: { allow: undefined, deny: ['10.0.0.0/8'] } },
    env: { OVERLAY_TEST: '1' },
    tags: { workspace: 'workspace-1' },
    keepLastSnapshots: { count: 3, deleteEvicted: true },
    image: 'registry.example/overlay-host:phase-6',
  })
})

test('Daytona adapter maps the same Overlay policy to Daytona behind the same contract', async () => {
  let createParams: Record<string, unknown> | undefined
  let createOptions: Record<string, unknown> | undefined
  const sandbox = { id: 'daytona-1', name: 'overlay-daytona' } as unknown as DaytonaSandbox
  const client = {
    create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
      createParams = params
      createOptions = options
      return sandbox
    },
  } as unknown as Daytona
  const instance = await new DaytonaSandboxRuntime({ client }).create(request('overlay-daytona'))

  assert.equal(instance.provider, 'daytona')
  assert.equal(instance.reference, 'daytona-1')
  assert.deepEqual(createOptions, { timeout: 90 })
  assert.deepEqual(createParams, {
    name: 'overlay-daytona',
    envVars: { OVERLAY_TEST: '1' },
    labels: { workspace: 'workspace-1' },
    ephemeral: false,
    autoStopInterval: 2,
    autoDeleteInterval: -1,
    ttlMinutes: 10,
    networkBlockAll: false,
    domainAllowList: 'getoverlay.io',
    networkAllowList: undefined,
    image: 'registry.example/overlay-host:phase-6',
    resources: { cpu: 2, memory: 4, disk: 20 },
  })
})

function request(name: string): SandboxCreateRequest {
  return {
    name,
    image: 'registry.example/overlay-host:phase-6',
    persistent: true,
    environment: { OVERLAY_TEST: '1' },
    ports: [3000],
    networkPolicy: { mode: 'allowlist', domains: ['getoverlay.io'], deniedCidrs: ['10.0.0.0/8'] },
    idleTimeoutMs: 120_000,
    hardTimeoutMs: 600_000,
    resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
    metadata: { workspace: 'workspace-1' },
  }
}
