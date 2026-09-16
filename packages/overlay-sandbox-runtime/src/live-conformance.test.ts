import test from 'node:test'
import { strict as assert } from 'node:assert'
import { BoxSandboxRuntime } from './box'
import { runSandboxConformance } from './conformance'
import { DaytonaSandboxRuntime } from './daytona'
import { createOverlayHarnessSandboxProvider } from './harness-bridge'
import { VercelSandboxRuntime } from './vercel'
import type { SandboxCreateRequest, SandboxRuntime } from './contracts'

const live = process.env.OVERLAY_SANDBOX_LIVE_CONFORMANCE === '1'

const providers: Array<{
  name: string
  runtime: () => SandboxRuntime
  request: (name: string) => SandboxCreateRequest
  verifyNetworkEnforcement: boolean
}> = [
  {
    name: 'vercel',
    runtime: () => new VercelSandboxRuntime({ credentials: vercelCredentials() }),
    request: (name) => baseRequest(name),
    verifyNetworkEnforcement: true,
  },
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

/**
 * The harness bridge (`SandboxRuntime` → `HarnessV1SandboxProvider`) is what
 * managed HarnessAgents actually run on for non-Vercel providers. Exercise
 * its session surface live per provider: spawn/run, files, port endpoints
 * (including private-preview headers), policy mutation, and lifecycle.
 * Box is excluded — it is not offered for harnesses.
 */
for (const name of ['vercel', 'daytona'] as const) {
  test(`live ${name} harness-bridge session`, {
    skip: !live || !providerAvailable(name),
    timeout: 10 * 60_000,
  }, async () => {
    const runtime = name === 'vercel'
      ? new VercelSandboxRuntime({ credentials: vercelCredentials() })
      : new DaytonaSandboxRuntime({ config: daytonaConfig() })
    const provider = createOverlayHarnessSandboxProvider({
      runtime,
      session: {
        ports: [3000],
        networkPolicy: { mode: 'allowlist', domains: ['getoverlay.io'] },
        idleTimeoutMs: 2 * 60_000,
        hardTimeoutMs: 10 * 60_000,
      },
    })
    const sessionId = `live-bridge-${Date.now()}`
    const session = await provider.createSession({ sessionId })
    try {
      const restrictedRun = await session.restricted().run({ command: 'printf restricted' })
      assert.equal(restrictedRun.exitCode, 0)
      assert.equal(restrictedRun.stdout, 'restricted')
      const run = await session.run({ command: 'printf bridged' })
      assert.equal(run.exitCode, 0)
      assert.equal(run.stdout, 'bridged')
      await session.writeTextFile({ path: `${session.defaultWorkingDirectory}/bridge.txt`, content: 'overlay' })
      assert.equal(await session.readTextFile({ path: `${session.defaultWorkingDirectory}/bridge.txt` }), 'overlay')
      const endpoint = await session.getPortEndpoint({ port: 3000 })
      assert.match(endpoint.url, /^https?:\/\//)
      // Daytona private previews must surface their token as endpoint headers.
      if (name === 'daytona') assert.ok(endpoint.headers?.['x-daytona-preview-token'])
      // Stop, then reattach by sessionId — the resume path managed turns use
      // between durable slices.
      await session.stop()
      const resumed = await provider.resumeSession?.({ sessionId })
      assert.ok(resumed)
      const afterResume = await resumed.run({ command: 'printf resumed' })
      assert.equal(afterResume.stdout, 'resumed')
      await resumed.destroy()
    } finally {
      await session.destroy().catch(() => undefined)
    }
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
  return Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID)
}

function vercelCredentials() {
  const token = process.env.VERCEL_TOKEN
  const teamId = process.env.VERCEL_TEAM_ID
  const projectId = process.env.VERCEL_PROJECT_ID
  return token && teamId && projectId ? { token, teamId, projectId } : undefined
}

function daytonaConfig() {
  return { apiKey: process.env.DAYTONA_API_KEY, apiUrl: process.env.DAYTONA_API_URL }
}
