import test from 'node:test'
import { BoxSandboxRuntime } from './box'
import { runSandboxConformance } from './conformance'
import { DaytonaSandboxRuntime } from './daytona'
import type { SandboxCreateRequest, SandboxRuntime } from './contracts'

const live = process.env.OVERLAY_SANDBOX_LIVE_CONFORMANCE === '1'

const providers: Array<{
  name: string
  runtime: () => SandboxRuntime
  request: (name: string) => SandboxCreateRequest
  verifyNetworkEnforcement: boolean
}> = [
  {
    name: 'daytona',
    runtime: () => new DaytonaSandboxRuntime({ config: daytonaConfig() }),
    request: (name) => baseRequest(name),
    verifyNetworkEnforcement: true,
  },
  {
    // Box has no network policy surface — the port reports it unsupported and
    // the request asks for allow_all instead of an allowlist.
    name: 'box',
    runtime: () => new BoxSandboxRuntime({ apiKey: process.env.BOX_API_KEY }),
    request: (name) => ({
      ...baseRequest(name),
      networkPolicy: { mode: 'allow_all' },
      resources: { vcpus: 2, memoryGiB: 4, diskGiB: 40 },
    }),
    verifyNetworkEnforcement: false,
  },
]

for (const provider of providers) {
  test(`live ${provider.name} sandbox conformance`, {
    skip: !live || !providerAvailable(provider.name),
    timeout: 15 * 60_000,
  }, async () => {
    const value = provider.runtime()
    await runSandboxConformance(value, provider.request(`overlay-live-${provider.name}-${Date.now()}`), {
      verifyNetworkEnforcement: provider.verifyNetworkEnforcement,
    })
  })
}

function baseRequest(name: string): SandboxCreateRequest {
  return {
    name,
    persistent: true,
    idleTimeoutMs: 2 * 60_000,
    hardTimeoutMs: 10 * 60_000,
    ports: [3000],
    networkPolicy: { mode: 'allowlist', domains: ['getoverlay.io'] },
    metadata: { overlay: 'conformance' },
  }
}

function providerAvailable(name: string): boolean {
  if (name === 'box') return Boolean(process.env.BOX_API_KEY)
  if (name === 'daytona') return Boolean(process.env.DAYTONA_API_KEY)
  return false
}

function daytonaConfig() {
  return { apiKey: process.env.DAYTONA_API_KEY, apiUrl: process.env.DAYTONA_API_URL }
}
