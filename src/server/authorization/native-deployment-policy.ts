import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import { deriveOverlayCapabilities } from '@overlay/app-core'
import { loadOverlayConfig, type LoadOverlayConfigOptions } from '@/server/config'
import { deploymentEnv } from '@/server/env/deployment-env'
import { resolveConvexUrl } from '@/server/database/convex-url'
import { withObservabilityProviderCapabilities } from '@/server/capabilities'
import { applyAppDataCapabilitiesToOverlayCapabilities, deriveAppDataCapabilities } from '@/server/app-data/capabilities'
import { connectedAgentRolloutConfigFromEnv, parseConnectedAgentRolloutStage } from '@/shared/agents/connected-agent-rollout'
import {
  NATIVE_POLICY_RESPONSE_MAX_BYTES,
  nativePolicySnapshotSchema,
  type NativePolicySnapshot,
} from '@/shared/authorization/native-deployment-policy'

export async function resolveNativeDeploymentPolicy(options: LoadOverlayConfigOptions = {}): Promise<NativePolicySnapshot> {
  const env = options.env ?? deploymentEnv()
  const config = await loadOverlayConfig({ ...options, env })
  const backend = resolveConvexUrl(env)
  if (!backend.url || backend.invalid) throw new Error('NATIVE_POLICY_UNAVAILABLE')
  const capabilities = applyAppDataCapabilitiesToOverlayCapabilities(
    withObservabilityProviderCapabilities(deriveOverlayCapabilities(config), config),
    deriveAppDataCapabilities(config),
  )
  const rollout = connectedAgentRolloutConfigFromEnv(env)
  const policy = {
    version: 1 as const,
    backendUrl: backend.url,
    features: { ...capabilities, workspaceHandles: env.OVERLAY_WORKSPACE_HANDLE_WRITES_ENABLED === 'true' },
    rollout: {
      stage: parseConnectedAgentRolloutStage(rollout.stage),
      internalWorkspaceIds: rollout.internalWorkspaceIds ?? '',
      invitedWorkspaceIds: rollout.invitedWorkspaceIds ?? '',
    },
  }
  return nativePolicySnapshotSchema.parse({
    ...policy,
    revision: createHash('sha256').update(JSON.stringify(policy)).digest('hex'),
  })
}

const responseHeaders = { 'Cache-Control': 'no-store, max-age=0', Vary: 'x-internal-api-secret' }

export async function nativeDeploymentPolicyResponse(
  request: Request,
  dependencies: {
    secret?: string
    resolve?: () => Promise<NativePolicySnapshot>
    now?: () => number
  } = {},
): Promise<Response> {
  const secret = dependencies.secret ?? deploymentEnv().INTERNAL_API_SECRET?.trim()
  const supplied = request.headers.get('x-internal-api-secret') ?? ''
  const digest = (value: string) => createHash('sha256').update(value).digest()
  if (!secret || !supplied || !timingSafeEqual(digest(secret), digest(supplied))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: responseHeaders })
  }
  const challenge = new URL(request.url).searchParams.get('challenge') ?? ''
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(challenge)) {
    return Response.json({ error: 'Invalid challenge' }, { status: 400, headers: responseHeaders })
  }
  try {
    const snapshot = nativePolicySnapshotSchema.parse(await (dependencies.resolve ?? resolveNativeDeploymentPolicy)())
    const body = JSON.stringify({ challenge, issuedAt: (dependencies.now ?? Date.now)(), snapshot })
    if (new TextEncoder().encode(body).length > NATIVE_POLICY_RESPONSE_MAX_BYTES) throw new Error('POLICY_TOO_LARGE')
    return new Response(body, { headers: { ...responseHeaders, 'Content-Type': 'application/json' } })
  } catch (_error) {
    return Response.json({ error: 'Policy unavailable' }, { status: 503, headers: responseHeaders })
  }
}
