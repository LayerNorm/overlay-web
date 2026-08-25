import test from 'node:test'
import { runSandboxConformance } from './conformance'
import { DaytonaSandboxRuntime } from './daytona'
import { VercelSandboxRuntime } from './vercel'
import type { SandboxRuntime } from './contracts'

const live = process.env.OVERLAY_SANDBOX_LIVE_CONFORMANCE === '1'

for (const [provider, runtime] of [
  ['vercel', () => new VercelSandboxRuntime({ credentials: vercelCredentials() })],
  ['daytona', () => new DaytonaSandboxRuntime({ config: daytonaConfig() })],
] as const) {
  test(`live ${provider} sandbox conformance`, { skip: !live, timeout: 15 * 60_000 }, async () => {
    const value: SandboxRuntime = runtime()
    await runSandboxConformance(value, {
      name: `overlay-live-${provider}-${Date.now()}`,
      persistent: true,
      idleTimeoutMs: 2 * 60_000,
      hardTimeoutMs: 10 * 60_000,
      ports: [3000],
      networkPolicy: { mode: 'allowlist', domains: ['getoverlay.io'] },
      metadata: { overlay: 'conformance', provider },
    }, { verifyNetworkEnforcement: true })
  })
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
