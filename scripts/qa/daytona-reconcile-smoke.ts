import {
  callConvex,
  getInternalApiSecret,
  loadLocalEnv,
  readArg,
} from '../lib/convex-admin-utils'

type Entitlements = {
  tier: 'free' | 'pro' | 'max'
  creditsUsed: number
  creditsTotal: number
}

type WorkspaceRecord = {
  userId: string
  sandboxId: string
  state: 'provisioning' | 'started' | 'stopped' | 'archived' | 'error' | 'missing'
  lastMeteredAt?: number
}

const DEFAULT_BASE_URL = process.env.DAYTONA_SMOKE_BASE_URL?.trim() || 'http://localhost:3000'
const DEFAULT_WAIT_MS = 75_000
const DEFAULT_OUTPUT = 'outputs/daytona-reconcile-smoke.txt'

function requireUserId(): string {
  const value =
    readArg('user-id') ||
    process.env.DAYTONA_SMOKE_USER_ID?.trim() ||
    process.env.TEST_USER_ID?.trim()

  if (!value) {
    throw new Error('Provide --user-id or DAYTONA_SMOKE_USER_ID')
  }

  return value
}

function getTarget(): 'dev' | 'prod' {
  const raw = (readArg('target') || 'dev').trim().toLowerCase()
  return raw === 'prod' ? 'prod' : 'dev'
}

async function getEntitlements(target: 'dev' | 'prod', userId: string, serverSecret: string) {
  return await callConvex<Entitlements>(target, 'query', 'platform/usage:getEntitlementsByServer', {
    userId,
    serverSecret,
  })
}

async function getWorkspace(target: 'dev' | 'prod', userId: string, serverSecret: string) {
  return await callConvex<WorkspaceRecord | null>(target, 'query', 'ai/sandbox/daytona:getWorkspaceByUserId', {
    userId,
    serverSecret,
  })
}

async function ensureRunningWorkspace(baseUrl: string, userId: string, serverSecret: string, outputPath: string) {
  const res = await fetch(`${baseUrl}/api/v1/daytona/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-api-secret': serverSecret,
    },
    body: JSON.stringify({
      userId,
      serverSecret,
      task: 'Keep the persistent Daytona workspace running for reconcile metering verification.',
      runtime: 'node',
      command: `printf 'daytona reconcile smoke\n' > "$OVERLAY_OUTPUT_DIR/daytona-reconcile-smoke.txt"`,
      expectedOutputs: [outputPath],
    }),
  })

  const payload = await res.json().catch(() => ({}))
  if (!res.ok || payload?.success !== true) {
    throw new Error(payload?.message || payload?.error || `Workspace bootstrap failed with HTTP ${res.status}`)
  }
}

async function main() {
  loadLocalEnv()

  const userId = requireUserId()
  const target = getTarget()
  const baseUrl = readArg('base-url') || DEFAULT_BASE_URL
  const serverSecret = getInternalApiSecret()
  const waitMs = Number.parseInt(readArg('wait-ms') || `${DEFAULT_WAIT_MS}`, 10)
  const outputPath = readArg('output-path') || DEFAULT_OUTPUT
  const expectExhausted = (readArg('expect-exhausted') || '').trim().toLowerCase() === 'true'

  console.log('[daytona reconcile smoke] bootstrapping workspace', {
    target,
    baseUrl,
    userId,
    waitMs,
  })

  await ensureRunningWorkspace(baseUrl, userId, serverSecret, outputPath)

  const baselineEntitlements = await getEntitlements(target, userId, serverSecret)
  const baselineWorkspace = await getWorkspace(target, userId, serverSecret)

  console.log('[daytona reconcile smoke] baseline', {
    creditsUsed: baselineEntitlements.creditsUsed,
    workspaceState: baselineWorkspace?.state,
    lastMeteredAt: baselineWorkspace?.lastMeteredAt,
  })

  await new Promise((resolve) => setTimeout(resolve, waitMs))

  const afterEntitlements = await getEntitlements(target, userId, serverSecret)
  const afterWorkspace = await getWorkspace(target, userId, serverSecret)

  console.log('[daytona reconcile smoke] after wait', {
    creditsUsed: afterEntitlements.creditsUsed,
    workspaceState: afterWorkspace?.state,
    lastMeteredAt: afterWorkspace?.lastMeteredAt,
  })

  if (afterEntitlements.creditsUsed <= baselineEntitlements.creditsUsed) {
    throw new Error('Expected creditsUsed to increase after the reconcile window.')
  }

  if (
    typeof baselineWorkspace?.lastMeteredAt === 'number' &&
    typeof afterWorkspace?.lastMeteredAt === 'number' &&
    afterWorkspace.lastMeteredAt <= baselineWorkspace.lastMeteredAt
  ) {
    throw new Error('Expected workspace.lastMeteredAt to advance after reconciliation.')
  }

  if (expectExhausted && afterWorkspace?.state === 'started') {
    throw new Error('Expected the workspace to stop after credit exhaustion, but it is still started.')
  }

  console.log('[daytona reconcile smoke] passed')
}

void main().catch((error) => {
  console.error('[daytona reconcile smoke] failed', error)
  process.exit(1)
})
