import { MAX_HOST_REQUEST_BYTES } from '@layernorm/agent-bridge-protocol'
import type { NextRequest } from 'next/server'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import { ConnectedAgentControlPlaneError } from '@/server/agents'

export async function enforceAgentHostRateLimit(
  request: Request,
  operation: string,
  limit = 300,
) {
  const nextRequest = request as NextRequest
  const ip = getClientIp(nextRequest)
  const credential = request.headers.get('authorization')?.slice(0, 512) ?? ''
  return await enforceRateLimits(nextRequest, [
    { bucket: `agent-host:${operation}:ip`, key: ip, limit: Math.min(limit, 120), windowMs: 60_000 },
    {
      bucket: `agent-host:${operation}:credential`,
      key: hashOperationalIdentifier('agent-host-rate-limit:v1', credential || ip),
      limit,
      windowMs: 60_000,
    },
  ])
}

export async function readAgentHostBody(request: Request): Promise<{
  rawBody: Uint8Array
  parsed: Record<string, unknown>
}> {
  const rawBody = new Uint8Array(await request.arrayBuffer())
  if (rawBody.byteLength > MAX_HOST_REQUEST_BYTES) {
    throw new ConnectedAgentControlPlaneError('Request body is too large', 413, 'request_too_large')
  }
  if (rawBody.byteLength === 0) return { rawBody, parsed: {} }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(rawBody))
  } catch (_error) {
    throw new ConnectedAgentControlPlaneError('Request body must be valid JSON', 400, 'invalid_json')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectedAgentControlPlaneError('Request body must be a JSON object', 400, 'invalid_json')
  }
  return { rawBody, parsed: value as Record<string, unknown> }
}

export function emptyBody() { return new Uint8Array() }
